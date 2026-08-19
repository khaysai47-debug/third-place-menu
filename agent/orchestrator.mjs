// The V2 orchestration core.
//
//   A task is not one Claude coding attempt. A task is a GOAL that stays alive
//   until its success criteria are proven, it reaches an approval boundary, or
//   it reaches a genuine escalation condition.
//
// The loop below owns that goal. Workers own capabilities and answer in a fixed
// structured shape; the router picks the worker that owns the first failing
// boundary; the progress rule decides whether trying again is learning or
// thrashing; and every step is written to external state before and after it
// runs, so an interruption is a pause with a resume point rather than a loss.
//
// What it will not do, at any budget, under any configuration: commit, push,
// merge, deploy, publish an n8n workflow, change production configuration, or
// perform any other Class B/C action. Those are queued for a human and the loop
// stops. There is no code path here that performs one.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { actionApprovalsDir } from "./action-approval.mjs";
import { configuredConnectors } from "./connectors/index.mjs";
import { relevantLessons } from "./lessons.mjs";
import { evaluateProgress } from "./progress.mjs";
import { assertNoSecretValues } from "./redact.mjs";
import { routeNext } from "./router.mjs";
import { validateTask, validateWorkerResult } from "./schemas.mjs";
import { finalReportMarkdown } from "./taskreport.mjs";
import {
  addEvidence,
  applyVerification,
  createTaskState,
  stop as stopState,
  TaskStateStore,
  taskStateRoot,
} from "./taskstate.mjs";
import { createCodexWorker } from "./workers/codex.mjs";
import { createN8nWorker, createVercelWorker } from "./workers/external.mjs";
import { createRepoWorker } from "./workers/repo.mjs";
import { failed } from "./workers/contract.mjs";

/**
 * Assemble the worker set.
 *
 * Connectors are injected and default to none, which is why the n8n and Vercel
 * workers currently answer `not_available` instead of guessing.
 */
export function defaultWorkers({
  engineOptions = {},
  connectors = null,
  reviewPolicy,
  actionApprovalDir = null,
  env = process.env,
} = {}) {
  const activeConnectors = connectors ?? configuredConnectors({ env });
  return {
    repo: createRepoWorker({ engineOptions }),
    codex: createCodexWorker({ policy: reviewPolicy }),
    n8n: createN8nWorker({
      connector: activeConnectors.n8n ?? null,
      actionApprovalDir,
    }),
    vercel: createVercelWorker({
      connector: activeConnectors.vercel ?? null,
      actionApprovalDir,
    }),
  };
}

export function orchestratorOptions(given = {}) {
  const repoRoot = given.repoRoot ?? process.cwd();
  const env = given.env ?? process.env;
  const engineOptions = {
    repoRoot,
    ...(given.runsRoot ? { runsRoot: given.runsRoot } : {}),
    ...(given.stateDir ? { stateDir: given.stateDir } : {}),
    ...(given.engineOptions ?? {}),
  };
  return {
    repoRoot,
    engineOptions,
    stateRoot: given.stateRoot,
    taskStateRoot:
      given.taskStateRoot ?? taskStateRoot({ stateRoot: given.stateRoot, repoRoot, env }),
    actionApprovalDir:
      given.actionApprovalDir ??
      actionApprovalsDir({ stateDir: given.stateDir, stateRoot: given.stateRoot, repoRoot, env }),
    workers:
      given.workers ??
      defaultWorkers({
        engineOptions,
        connectors: given.connectors ?? null,
        reviewPolicy: given.reviewPolicy,
        actionApprovalDir:
          given.actionApprovalDir ??
          actionApprovalsDir({
            stateDir: given.stateDir,
            stateRoot: given.stateRoot,
            repoRoot,
            env,
          }),
        env,
      }),
    reviewPolicy: given.reviewPolicy,
    now: given.now ?? (() => new Date()),
    lessonsFile: given.lessonsFile,
    force: given.force ?? false,
    env,
  };
}

/**
 * Find a task from a file path or a bare task id.
 *
 * The id form is what makes `status ATLAS-005` and `resume ATLAS-005` work: the
 * stored state remembers which file the goal came from.
 */
export function resolveTask(taskRef, opts) {
  let taskFile = taskRef;

  if (!existsSync(taskFile)) {
    const stateFile = path.join(opts.taskStateRoot, String(taskRef), "state.json");
    if (!existsSync(stateFile)) {
      return { error: `no task file and no stored state for "${taskRef}"` };
    }
    try {
      taskFile = JSON.parse(readFileSync(stateFile, "utf8")).taskFile;
    } catch (error) {
      return { error: `stored state for ${taskRef} is unreadable: ${error.message}` };
    }
    if (!existsSync(taskFile)) {
      return { error: `stored state for ${taskRef} points at a missing task file: ${taskFile}` };
    }
  }

  let task;
  try {
    task = JSON.parse(readFileSync(taskFile, "utf8"));
  } catch (error) {
    return { error: `could not read task ${taskFile}: ${error.message}` };
  }
  const validation = validateTask(task);
  if (!validation.valid) {
    return { error: `task is invalid: ${validation.errors.join("; ")}`, task, taskFile };
  }
  return { task, taskFile, warnings: validation.warnings ?? [] };
}

/** Load persisted state without running anything. Used by status and report. */
export function loadTaskState(taskRef, given = {}) {
  const opts = orchestratorOptions(given);
  const direct = path.join(opts.taskStateRoot, String(taskRef), "state.json");
  if (existsSync(direct)) {
    const store = TaskStateStore.open(String(taskRef), opts.taskStateRoot);
    return { state: store.load(), store, opts };
  }
  const resolved = resolveTask(taskRef, opts);
  if (!resolved.task) return { error: resolved.error, opts };
  const store = TaskStateStore.open(resolved.task.taskId, opts.taskStateRoot);
  return { state: store.load(), store, opts, task: resolved.task, taskFile: resolved.taskFile };
}

/* ── The loop ────────────────────────────────────────────────────────────── */

/**
 * Run (or resume) a goal until it completes, needs a human, or runs out of
 * budget. Idempotent to re-enter: state on disk is the source of truth, and a
 * second `orchestrate` continues rather than restarting.
 */
export async function orchestrate(taskRef, given = {}) {
  const opts = orchestratorOptions(given);
  const resolved = resolveTask(taskRef, opts);
  if (!resolved.task || resolved.error) {
    return { ok: false, error: resolved.error, state: null };
  }
  const { task, taskFile } = resolved;

  const lessons = relevantLessons(task, opts.lessonsFile ? { file: opts.lessonsFile } : {});
  const store = TaskStateStore.open(task.taskId, opts.taskStateRoot);

  let state = store.load();
  if (!state) {
    state = createTaskState({ task, taskFile, now: opts.now(), lessons: lessons.map((l) => l.id) });
  } else {
    state.lessons = lessons.map((l) => l.id);
    state.taskFile = String(taskFile).replace(/\\/g, "/");
    // State written before strategic steps existed counted every pause as a
    // step. Carry that total forward rather than resetting to zero, so the
    // ceiling stays conservative for a goal already in flight.
    state.attempts.steps ??= state.attempts.total ?? 0;
  }

  if (state.status === "completed" && !opts.force) {
    return { ok: true, state, store, lessons, alreadyComplete: true };
  }

  // Re-entering clears the previous stop mark; the router decides again from
  // what is actually proven, not from why we stopped last time.
  state.stopReason = null;
  store.save(state, opts.now());

  for (;;) {
    const decision = routeNext(state, {
      task,
      workers: opts.workers,
      policy: opts.reviewPolicy,
      budget: state.budget,
    });

    if (decision.stop) {
      stopState(state, decision.stop, opts.now());
      state.nextAction = decision.stop.nextAction ?? nextActionFor(state, decision.stop);
      break;
    }

    // Record the INTENT before acting. A process killed mid-step leaves state
    // that says what it was about to do, which is what makes the resume safe.
    state.activeWorker = decision.worker;
    state.status = decision.status;
    state.nextAction = `${decision.worker}.${decision.action} — ${decision.reason}`;
    store.save(state, opts.now());

    const call = {
      action: decision.action,
      task,
      taskFile,
      state,
      ...(decision.args === undefined ? {} : { args: decision.args }),
    };
    let result;
    try {
      if (decision.args !== undefined) assertNoSecretValues(decision.args, "decision.args");
      result = await invoke(opts.workers[decision.worker], call);
    } catch (error) {
      result = failed(
        decision.worker,
        decision.action,
        String(error?.message ?? error).split("\n")[0],
        { terminal: true },
      );
    }

    const verdict = applyResult({ state, store, result, decision, opts });
    if (!verdict.continue) {
      stopState(
        state,
        { status: verdict.status, stopReason: verdict.stopReason, nextAction: null },
        opts.now(),
      );
      state.nextAction = nextActionFor(state, verdict);
      break;
    }
  }

  store.save(state, opts.now());
  store.checkpoint(state);
  const report = finalReportMarkdown(state, { task, lessons });
  const reportPath = store.saveFinalReport(report);
  return { ok: true, state, store, lessons, report, reportPath };
}

/** Invoke a worker, and never let a bad result become a routing decision. */
async function invoke(worker, call) {
  let result;
  try {
    result = await worker.act(call);
  } catch (error) {
    return failed(worker.name, call.action, String(error?.message ?? error).split("\n")[0]);
  }
  const validation = validateWorkerResult(result);
  if (!validation.valid) {
    return failed(
      worker.name,
      call.action,
      `worker returned a malformed result: ${validation.errors.join("; ")}`,
    );
  }
  return result;
}

/**
 * Result statuses that represent a genuine attempt at the work: something was
 * investigated, changed, diagnosed, reviewed, or ran into a real wall.
 *
 * Everything NOT in this set is an infrastructure pause — `paused`
 * (auth_required, usage_limit, network, an interrupted builder or reviewer
 * session), `requires_approval` (a gate, not an attempt) and `not_available` (no
 * connector, so nothing was attempted). Those stop the loop exactly as before;
 * what they no longer do is spend the strategic problem-solving budget, because
 * re-authenticating three times is not three attempts at the engineering goal.
 */
const ATTEMPT_STATUSES = new Set(["success", "blocked", "failed"]);

/** Does this result spend one of the goal's `maxTotalSteps` strategic steps? */
export const consumesStrategicStep = (result) => ATTEMPT_STATUSES.has(result.status);

/**
 * Fold one worker result into the goal: counters, evidence, boundaries,
 * criteria, blocker, history — then ask the progress rule what happens next.
 */
export function applyResult({ state, store, result, decision, opts }) {
  const now = opts.now();
  const at = now.toISOString();

  // `total` counts every worker result, so checkpoints and history entries stay
  // uniquely numbered. `steps` is the STRATEGIC budget: only a real ATTEMPT at
  // the work spends one, and the same rule governs a worker's own attempt
  // budget. Stopping at a gate — the task is not approved, the model is rate
  // limited, the connector is missing — is not an attempt at anything, and must
  // not burn the budget the actual work needs. Same rule V1 already applies to
  // pauses and revision rounds.
  state.attempts.total += 1;
  state.attempts.steps ??= 0;
  if (consumesStrategicStep(result)) {
    state.attempts.steps += 1;
    state.attempts.byWorker[decision.worker] = (state.attempts.byWorker[decision.worker] ?? 0) + 1;
  }

  const { added } = addEvidence(state, result.evidence ?? [], now);
  for (const entry of added) store?.saveEvidence(entry);

  for (const boundary of result.verifiedBoundariesAdded ?? []) {
    if (!state.verifiedBoundaries.includes(boundary)) state.verifiedBoundaries.push(boundary);
  }
  applyVerification(state, now);

  // Remember the worktree so the next step RESUMES it instead of starting over.
  if (result.data?.runId) {
    state.activeRun = {
      runId: result.data.runId,
      branch: result.data.branch ?? null,
      worktree: result.data.worktree ?? null,
      filesChanged: result.data.filesChanged ?? [],
      runState: result.data.state ?? null,
      checkResults: result.data.checkResults ?? [],
      summary: result.data.summary ?? null,
    };
  }

  const verdict = evaluateProgress({
    result,
    previousFingerprint: state.lastFingerprint,
    sameFailureCount: state.attempts.sameFailure ?? 0,
    newEvidenceCount: added.length,
    totalSteps: state.attempts.steps,
    budget: state.budget,
  });

  state.lastFingerprint = verdict.fingerprint;
  state.attempts.sameFailure = verdict.sameFailureCount;
  state.currentBlocker = result.blocker
    ? {
        ...result.blocker,
        suggestedNextWorker: result.suggestedNextWorker ?? null,
        suggestedAction: result.data?.suggestedAction ?? null,
        resumable: result.resumable === true,
      }
    : null;
  if (verdict.progressed || result.status === "success") state.lastProgressAt = at;

  if (result.requiresApproval) {
    const pending = result.requiresApproval;
    const already = state.approvalsPending.some((a) =>
      pending.request?.actionHash
        ? a.request?.actionHash === pending.request.actionHash
        : a.worker === pending.worker && a.action === pending.action,
    );
    if (!already) state.approvalsPending.push({ ...pending, queuedAt: at });
  }

  state.history.push({
    step: state.attempts.total,
    at,
    worker: decision.worker,
    action: decision.action,
    status: result.status,
    changed: result.changed === true,
    reason: verdict.reason,
    blocker: result.blocker,
    fingerprint: verdict.fingerprint,
    verified: result.verifiedBoundariesAdded ?? [],
    newEvidence: added.length,
  });

  store?.save(state, now);
  store?.checkpoint(state);
  return verdict;
}

/** What the human is being asked to do, in one line. */
function nextActionFor(state, verdict) {
  switch (verdict.status ?? state.status) {
    case "waiting_for_approval": {
      const pending = state.approvalsPending.at(-1);
      return pending
        ? `approve ${pending.worker}.${pending.action} (Class ${pending.actionClass}, ${pending.request?.actionHash ?? "unhashed"}) with \`agent:approve-action\`, then \`agent:resume --task ${state.taskId}\``
        : `approve the pending action, then \`agent:resume --task ${state.taskId}\``;
    }
    case "paused":
      return state.stopReason === "manual_verification_required"
        ? `verify the manual criteria, then \`agent:verify --task ${state.taskId} --criteria <ids> --by "Your Name"\``
        : `resolve "${state.stopReason}", then \`agent:resume --task ${state.taskId}\` — the worktree is preserved at ${state.activeRun?.worktree ?? "(none)"}`;
    case "escalated":
      return `human decision needed on ${state.currentBlocker?.boundary ?? state.stopReason}: ${
        state.currentBlocker?.detail ?? verdict.reason ?? ""
      }`;
    case "completed":
      return state.activeRun?.worktree
        ? `review the diff in ${state.activeRun.worktree} and decide whether to commit — the agent never does`
        : "nothing further";
    default:
      return `investigate ${state.currentBlocker?.boundary ?? "the current blocker"}`;
  }
}

/* ── Human verification ──────────────────────────────────────────────────── */

/**
 * Record that a human proved a criterion the agent cannot prove.
 *
 * This is the honest end of the "controlled verification" model: criteria with
 * no automatic verifier are never marked passed by the agent, so there has to be
 * a way for a person to say "I checked it, it works" — attributed, timestamped
 * and stored as evidence like anything else.
 */
export function verifyCriteria(taskRef, { criteria = [], by, note = "" } = {}, given = {}) {
  const loaded = loadTaskState(taskRef, given);
  if (loaded.error) return { ok: false, error: loaded.error };
  if (!loaded.state) return { ok: false, error: `no orchestration state for ${taskRef}` };
  if (!by || !String(by).trim())
    return { ok: false, error: "--by is required: who verified this?" };

  const state = loaded.state;
  const now = loaded.opts.now();
  const wanted = new Set(criteria);
  const marked = [];
  const unknown = [...wanted].filter((id) => !state.successCriteria.some((c) => c.id === id));
  if (unknown.length) return { ok: false, error: `unknown criterion id(s): ${unknown.join(", ")}` };

  for (const criterion of state.successCriteria) {
    if (!wanted.has(criterion.id) || criterion.status === "verified") continue;
    criterion.status = "verified";
    criterion.verifiedBy = `human:${by}`;
    criterion.verifiedAt = now.toISOString();
    marked.push(criterion.id);
  }

  const { added } = addEvidence(
    state,
    [
      {
        worker: "repo",
        action: "human_verification",
        kind: "verification",
        summary: `${by} verified ${marked.join(", ") || "nothing new"}${note ? ` — ${note}` : ""}`,
      },
    ],
    now,
  );
  for (const entry of added) loaded.store.saveEvidence(entry);
  state.lastProgressAt = now.toISOString();
  loaded.store.save(state, now);
  loaded.store.checkpoint(state);
  return { ok: true, state, marked, store: loaded.store };
}
