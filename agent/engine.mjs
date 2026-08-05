// The execution engine.
//
//   approved task → isolated worktree → Builder → scope gate → checks →
//   Reviewer → bounded revisions → final report → STOP
//
// The engine stops before commit, push, pull request, merge and deployment,
// always. Its output is a preserved worktree, a diff and a report; a human
// decides what happens to them.
//
// Every model call goes through an injected adapter, and every repository read
// through an injected git object, so agent/engine.test.mjs can exercise the
// whole loop with fakes and temporary repositories — no real Claude, no real
// Codex, no network, no quota.
import { createHash } from "node:crypto";
import { claudeBuilder } from "./adapters/claude.mjs";
import { codexReviewer } from "./adapters/codex.mjs";
import { runChecks as realRunChecks } from "./checks.mjs";
import { executionPreflight, liveGitAt } from "./coordinator.mjs";
import { builderPrompt, revisionPrompt, reviewerPrompt } from "./prompts.mjs";
import {
  finalReportMarkdown,
  makeRunId,
  notify,
  RunStore,
  RUNS_ROOT,
  toCheckpoint,
} from "./runstore.mjs";
import { PAUSING_OUTCOMES } from "./schemas.mjs";
import { checkScope } from "./scope.mjs";
import { changedFiles, createWorkspace, diffPatch } from "./workspace.mjs";

export const MAX_REVISION_ROUNDS = 2;
export const MAX_RETRIES = 3;
/** Cautious default: 15 minutes. Never a tight retry loop. */
export const DEFAULT_RETRY_MS = 15 * 60 * 1000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const signature = (checkResults, findings) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        checks: checkResults.map((c) => ({
          name: c.name,
          failures: (c.newFailures ?? []).map((f) => `${f.file}:${f.line ?? ""}:${f.message}`),
        })),
        findings: (findings ?? []).map((f) => `${f.id}:${f.requiredCorrection}`),
      }),
    )
    .digest("hex");

function options(given = {}) {
  const repoRoot = given.repoRoot ?? process.cwd();
  return {
    repoRoot,
    runsRoot: given.runsRoot ?? RUNS_ROOT,
    // Where approval receipts live. Undefined means the default outside the repo.
    stateDir: given.stateDir,
    builder: given.builder ?? claudeBuilder,
    reviewer: given.reviewer ?? codexReviewer,
    runChecks: given.runChecks ?? realRunChecks,
    git: given.git ?? liveGitAt(repoRoot),
    maxRevisionRounds: given.maxRevisionRounds ?? MAX_REVISION_ROUNDS,
    maxRetries: given.maxRetries ?? MAX_RETRIES,
    retryMs: given.retryMs ?? DEFAULT_RETRY_MS,
    autoResume: given.autoResume ?? true,
    sleep: given.sleep ?? defaultSleep,
    now: given.now ?? (() => new Date()),
    createWorkspace: given.createWorkspace ?? createWorkspace,
    changedFiles: given.changedFiles ?? changedFiles,
    diffPatch: given.diffPatch ?? diffPatch,
  };
}

/* ── Entry points ────────────────────────────────────────────────────────── */

/**
 * Start a new run for an approved task.
 *
 * Refuses everything the preflight refuses, and refuses it BEFORE any model is
 * invoked — an unapproved or out-of-scope task never reaches an adapter.
 */
export async function runTask(taskFile, given = {}) {
  const opts = options(given);
  const startedAt = opts.now().toISOString();

  // The authorizing gate, fresh. A dry run's verdict is worth nothing here.
  const preflight = executionPreflight(taskFile, {
    git: opts.git,
    expectWorktree: false,
    stateDir: opts.stateDir,
    repoRoot: opts.repoRoot,
  });
  const taskId = preflight.task?.taskId ?? "UNKNOWN";
  const store = new RunStore(makeRunId(taskId, startedAt), opts.runsRoot);

  const run = {
    runId: store.runId,
    taskId,
    taskFile,
    startedAt,
    endedAt: null,
    state: "RUNNING",
    stage: "planning",
    lastSuccessfulStage: null,
    baseCommit: preflight.task?.baseCommit ?? null,
    currentCommit: preflight.currentCommit ?? null,
    branch: null,
    worktree: null,
    builderSessionId: null,
    implementationRound: 0,
    revisionRound: 0,
    maxRevisionRounds: opts.maxRevisionRounds,
    retryCount: 0,
    pauseReason: null,
    expectedRetryAt: null,
    filesChanged: [],
    checkResults: [],
    findings: [],
    reviewVerdict: null,
    lastSignature: null,
    executionGates: preflight.gates,
    notifications: [],
    notes: [],
  };

  if (preflight.task) store.saveTaskSnapshot(preflight.task);
  persist(store, run);

  if (preflight.status !== "READY_TO_RUN") {
    run.notes.push(`preflight refused execution: ${preflight.status}`);
    for (const gate of preflight.gates.filter((g) => !g.ok)) {
      run.notes.push(`gate ${gate.name}: ${gate.detail}`);
    }
    notify(run, "blocked", `preflight refused: ${preflight.status}`);
    return finish(store, run, preflight.status, opts);
  }

  // Authorized. Create the isolated workspace — the only Git write the engine
  // ever performs, and it creates exactly one branch and one worktree.
  const task = preflight.task;
  try {
    const workspace = opts.createWorkspace({
      branch: preflight.workspace.branch,
      worktree: preflight.workspace.worktree,
      baseCommit: task.baseCommit,
      cwd: opts.repoRoot,
    });
    run.branch = workspace.branch;
    run.worktree = workspace.worktree;
    if (!workspace.linkedNodeModules) {
      run.notes.push("node_modules could not be linked into the worktree; checks may fail");
    }
  } catch (error) {
    run.notes.push(`workspace creation failed: ${error.message}`);
    return finish(store, run, "FAILED", opts);
  }

  run.lastSuccessfulStage = "planning";
  persist(store, run);

  return loop(store, run, task, opts, { prompt: builderPrompt({ task, repoRoot: opts.repoRoot }) });
}

/**
 * Continue a paused run. Used both by the automatic resume and by
 * `agent:resume` after the PC or the runner was stopped.
 *
 * Revalidates everything from scratch before doing any work: a checkpoint
 * records where a run stopped, it never authorizes continuing.
 */
export async function resumeRun(runId, given = {}) {
  const opts = options(given);
  const store = RunStore.open(runId, opts.runsRoot);
  const run = store.loadRun();

  if (isTerminal(run.state)) {
    run.notes.push(`refusing to resume a terminal run (${run.state})`);
    persist(store, run);
    return { run, store };
  }

  run.state = "RESUMING";
  notify(run, "resumed", `resuming from stage ${run.stage}`);
  persist(store, run);

  // Full revalidation. The worktree must still be the one we created.
  const preflight = executionPreflight(run.taskFile, {
    git: opts.git,
    expectWorktree: true,
    stateDir: opts.stateDir,
    repoRoot: opts.repoRoot,
  });
  if (preflight.status !== "READY_TO_RUN") {
    run.notes.push(`resume revalidation failed: ${preflight.status}`);
    run.executionGates = preflight.gates;
    notify(run, "blocked", `resume refused: ${preflight.status}`);
    return finish(store, run, preflight.status, opts);
  }

  const task = preflight.task;
  const prompt =
    run.revisionRound > 0
      ? revisionPrompt({
          task,
          findings: run.findings ?? [],
          checkFailures: (run.checkResults ?? []).filter((c) => c.result === "NEW_FAILURE"),
          round: run.revisionRound,
        })
      : builderPrompt({ task, repoRoot: opts.repoRoot });

  return loop(store, run, task, opts, { prompt });
}

/* ── The loop ────────────────────────────────────────────────────────────── */

async function loop(store, run, task, opts, { prompt }) {
  let currentPrompt = prompt;

  for (;;) {
    /* 1. Implementation ---------------------------------------------------- */
    run.state = "RUNNING";
    run.stage = run.revisionRound > 0 ? "revision" : "implementation";
    run.implementationRound += 1;
    persist(store, run);

    const built = await invokeWithPauses(store, run, opts, () =>
      opts.builder.build({
        prompt: currentPrompt,
        worktree: run.worktree,
        sessionId: run.builderSessionId,
      }),
    );
    if (built.paused) return built.result;

    const builderResult = built.value;
    store.saveBuilderRound(run.implementationRound, builderResult);
    if (builderResult.sessionId) run.builderSessionId = builderResult.sessionId;

    if (builderResult.outcome === "malformed_output") {
      run.notes.push(`Builder output was malformed: ${builderResult.detail}`);
      return finish(store, run, "FAILED", opts);
    }
    if (builderResult.outcome !== "success") {
      run.notes.push(`Builder ${builderResult.outcome}: ${builderResult.detail}`);
      return finish(store, run, "FAILED", opts);
    }

    run.lastSuccessfulStage = "implementation";
    persist(store, run);

    /* 2. Scope gate -------------------------------------------------------- */
    run.stage = "checks";
    run.filesChanged = opts.changedFiles(run.worktree);
    const scope = checkScope(run.filesChanged, task);
    if (!scope.ok) {
      for (const violation of scope.violations) {
        run.notes.push(`scope violation: ${violation.file} — ${violation.reason}`);
      }
      notify(run, "blocked", `Builder wrote outside the task's scope (${scope.violations.length})`);
      // Not a quality problem to iterate on: the Builder broke a boundary.
      return finish(store, run, "SCOPE_VIOLATION", opts);
    }

    /* 3. Checks ------------------------------------------------------------ */
    run.checkResults = opts.runChecks(task.requiredChecks, run.filesChanged, run.worktree);
    for (const check of run.checkResults) store.saveCheckLog(run.implementationRound, check);
    const failing = run.checkResults.filter((c) => c.result === "NEW_FAILURE");
    persist(store, run);

    if (failing.length > 0) {
      const next = await tryRevision(store, run, task, opts, {
        findings: [],
        checkFailures: failing,
        exhaustedState: "CHECKS_FAILED",
        reason: `${failing.length} check(s) ended in NEW_FAILURE`,
      });
      if (next.done) return next.result;
      currentPrompt = next.prompt;
      continue;
    }

    run.lastSuccessfulStage = "checks";
    persist(store, run);

    /* 4. Independent review ------------------------------------------------ */
    run.stage = "review";
    persist(store, run);

    const diff = opts.diffPatch(run.worktree);
    store.saveDiff(diff);

    const reviewed = await invokeWithPauses(store, run, opts, () =>
      opts.reviewer.review({
        prompt: reviewerPrompt({
          task,
          changedFiles: run.filesChanged,
          diff,
          checkResults: run.checkResults,
          builderSummary: builderResult.report?.summary ?? null,
        }),
        worktree: run.worktree,
      }),
    );
    if (reviewed.paused) return reviewed.result;

    const reviewResult = reviewed.value;
    store.saveReviewerRound(run.implementationRound, reviewResult);

    if (reviewResult.outcome === "malformed_output") {
      // Never guess at an unreadable review, and never let it become a PASS.
      run.notes.push(`Reviewer output was malformed: ${reviewResult.error}`);
      notify(run, "blocked", "reviewer output could not be parsed");
      return finish(store, run, "NEEDS_HUMAN", opts);
    }
    if (reviewResult.outcome !== "success") {
      run.notes.push(`Reviewer ${reviewResult.outcome}: ${reviewResult.error}`);
      return finish(store, run, "FAILED", opts);
    }

    const review = reviewResult.review;
    run.reviewVerdict = review.verdict;
    run.findings = review.findings ?? [];
    run.lastSuccessfulStage = "review";
    persist(store, run);

    if (review.verdict === "PASS") {
      run.notes.push(review.summary ?? "reviewer passed the change");
      // A review that passed with no file changes has nothing for a human to
      // commit; one with a diff does. Different outcomes, different states.
      const state = run.filesChanged.length > 0 ? "READY_FOR_HUMAN_REVIEW" : "PASS";
      notify(run, "completed", `review PASS — ${run.filesChanged.length} file(s) changed`);
      return finish(store, run, state, opts);
    }

    if (review.verdict === "NEEDS_HUMAN") {
      run.notes.push(review.summary ?? "reviewer escalated to a human");
      notify(run, "blocked", "reviewer returned NEEDS_HUMAN");
      return finish(store, run, "NEEDS_HUMAN", opts);
    }

    /* 5. REVISE ------------------------------------------------------------ */
    const next = await tryRevision(store, run, task, opts, {
      findings: run.findings,
      checkFailures: [],
      exhaustedState: "NEEDS_HUMAN",
      reason: `reviewer requested revision (${run.findings.length} finding(s))`,
    });
    if (next.done) return next.result;
    currentPrompt = next.prompt;
  }
}

/**
 * Decide whether another revision round is allowed, and build its prompt.
 *
 * Two guards, both of which end the run rather than spending another round:
 *   * the revision budget is spent
 *   * the same failure came back unchanged — a third identical attempt is not
 *     going to be different, and burning quota to prove that helps nobody
 */
async function tryRevision(
  store,
  run,
  task,
  opts,
  { findings, checkFailures, exhaustedState, reason },
) {
  const sig = signature(checkFailures, findings);
  if (sig === run.lastSignature) {
    run.notes.push(`repeated identical failure — stopping instead of retrying (${reason})`);
    notify(run, "blocked", "repeated identical failure");
    return { done: true, result: await finish(store, run, "NEEDS_HUMAN", opts) };
  }
  run.lastSignature = sig;

  if (run.revisionRound >= opts.maxRevisionRounds) {
    run.notes.push(`revision budget exhausted after ${run.revisionRound} round(s): ${reason}`);
    notify(run, "blocked", `revision limit reached (${opts.maxRevisionRounds})`);
    return { done: true, result: await finish(store, run, exhaustedState, opts) };
  }

  run.revisionRound += 1;
  run.notes.push(`revision round ${run.revisionRound}: ${reason}`);
  persist(store, run);

  return {
    done: false,
    prompt: revisionPrompt({ task, findings, checkFailures, round: run.revisionRound }),
  };
}

/* ── Pause and resume ────────────────────────────────────────────────────── */

/**
 * Wrap a model invocation so a usage limit, auth failure or network failure
 * becomes a recoverable pause rather than a run failure.
 *
 * A pause NEVER touches implementationRound or revisionRound — the model did
 * not fail at the work, it could not be reached. Only retryCount moves.
 */
async function invokeWithPauses(store, run, opts, invoke) {
  for (;;) {
    const value = await invoke();
    const pauseState = PAUSING_OUTCOMES[value.outcome];
    if (!pauseState) return { paused: false, value };

    run.state = pauseState;
    run.pauseReason = pauseKey(value.outcome);
    run.retryCount += 1;
    const detail = value.detail ?? value.error ?? value.outcome;
    notify(run, "paused", `${pauseState}: ${detail}`);
    persist(store, run);

    // Auth needs a human to log in; retrying on a timer just wastes the budget.
    const humanOnly = value.outcome === "auth_failure";
    const budgetLeft = run.retryCount <= opts.maxRetries;

    if (humanOnly) {
      run.notes.push("authentication pause needs a human; not scheduling an automatic resume");
      return { paused: true, result: await finish(store, run, pauseState, opts) };
    }

    if (!opts.autoResume) {
      // Automatic resume is switched off. The run stays PAUSED and waits for
      // `agent:resume`. A pause is not a failure, so it must not become one
      // just because nobody is scheduling the retry.
      run.notes.push("automatic resume disabled — waiting for `agent:resume`");
      return { paused: true, result: await finish(store, run, pauseState, opts) };
    }

    if (!budgetLeft) {
      run.notes.push(`retry budget exhausted after ${run.retryCount} attempt(s)`);
      return { paused: true, result: await finish(store, run, "NEEDS_HUMAN", opts) };
    }

    // Prefer the provider's own reset time; fall back to a cautious interval.
    const resetAt = value.resetAt ? new Date(value.resetAt) : null;
    const waitMs = resetAt
      ? Math.max(0, resetAt.getTime() - opts.now().getTime()) + 60_000
      : opts.retryMs * run.retryCount;
    run.expectedRetryAt = new Date(opts.now().getTime() + waitMs).toISOString();
    run.state = "RESUME_SCHEDULED";
    notify(run, "resume_scheduled", `retry ${run.retryCount} at ${run.expectedRetryAt}`);
    persist(store, run);

    await opts.sleep(waitMs);

    // Revalidate before touching anything again. Never restart blindly.
    const preflight = executionPreflight(run.taskFile, {
      git: opts.git,
      expectWorktree: true,
      stateDir: opts.stateDir,
      repoRoot: opts.repoRoot,
    });
    if (preflight.status !== "READY_TO_RUN") {
      run.notes.push(`resume revalidation failed: ${preflight.status}`);
      run.executionGates = preflight.gates;
      notify(run, "blocked", `resume refused: ${preflight.status}`);
      return { paused: true, result: await finish(store, run, preflight.status, opts) };
    }

    run.state = "RESUMING";
    run.pauseReason = null;
    run.expectedRetryAt = null;
    notify(run, "resumed", `retry ${run.retryCount}`);
    persist(store, run);
  }
}

const pauseKey = (outcome) =>
  ({ usage_limit: "usage_limit", auth_failure: "auth_required", network_failure: "network_error" })[
    outcome
  ] ?? null;

/* ── Persistence helpers ─────────────────────────────────────────────────── */

const TERMINAL = new Set([
  "PASS",
  "READY_FOR_HUMAN_REVIEW",
  "CHECKS_FAILED",
  "SCOPE_VIOLATION",
  "NEEDS_HUMAN",
  "FAILED",
  "BLOCKED_PERMISSION",
  "INVALID_TASK",
  "BASE_COMMIT_MISMATCH",
  "DIRTY_REPOSITORY",
  "WORKTREE_CONFLICT",
  "BRANCH_EXISTS",
  "READY_FOR_APPROVAL",
  "APPROVAL_MISSING",
  "APPROVAL_INVALID",
  "APPROVAL_STALE",
]);

export const isTerminal = (state) => TERMINAL.has(state);

function persist(store, run) {
  store.saveRun(run);
  store.saveCheckpoint(toCheckpoint(run));
}

async function finish(store, run, state, opts) {
  run.state = state;
  if (isTerminal(state)) {
    run.stage = "complete";
    run.endedAt = opts.now().toISOString();
  }
  // Capture the diff for any run that got as far as having a worktree.
  if (run.worktree) {
    try {
      store.saveDiff(opts.diffPatch(run.worktree));
      run.filesChanged = opts.changedFiles(run.worktree);
    } catch {
      /* worktree may not exist for a refused preflight */
    }
  }
  persist(store, run);
  store.saveFinalReport(finalReportMarkdown(run));
  return { run, store, reportPath: store.file("final-report.md") };
}
