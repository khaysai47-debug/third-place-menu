// V2 orchestration tests. Run with `npm run agent:test:orchestrator`.
//
// Every test drives the orchestrator with FAKE workers over a temporary state
// root. Nothing here invokes Claude or Codex, touches the network, consumes
// quota, creates a worktree, or writes to the Atlas repository. The engine-level
// half of the ATLAS-004 fix (turn budget → pause → resume the same worktree)
// lives in agent/engine.test.mjs, where the real git sandbox already exists.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { loadLessons, relevantLessons, searchLessons } from "./lessons.mjs";
import { evaluateProgress, failureFingerprint, workerExhausted } from "./progress.mjs";
import { loadTaskState, orchestrate, verifyCriteria } from "./orchestrator.mjs";
import { redact } from "./redact.mjs";
import { routeNext } from "./router.mjs";
import {
  actionClassOf,
  DEFAULT_BUDGET,
  validateTaskState,
  validateWorkerResult,
} from "./schemas.mjs";
import { finalReportMarkdown, statusBlock } from "./taskreport.mjs";
import {
  addEvidence,
  applyVerification,
  createTaskState,
  successCriteriaFor,
  TaskStateStore,
} from "./taskstate.mjs";
import { blocked, evidence, guard, ok, paused } from "./workers/contract.mjs";
import { createN8nWorker, createVercelWorker, N8N_CAPABILITIES } from "./workers/external.mjs";
import { createRepoWorker, resultFromRun } from "./workers/repo.mjs";
import { DEFAULT_REVIEW_POLICY, resultFromReview, reviewRequired } from "./workers/codex.mjs";

/* ── Fixtures ────────────────────────────────────────────────────────────── */

/**
 * A LEGACY task: exactly the V1 shape ATLAS-004 used, with no V2 field at all.
 * Everything below has to work on this, or backward compatibility is a claim
 * rather than a fact.
 */
const LEGACY_TASK = {
  taskId: "ATLAS-TEST",
  title: "Forward sanitized attachment metadata",
  objective: "Patch only the Messenger webhook sanitization.",
  context: "Fixture. No real work.",
  owner: "test",
  riskLevel: "medium",
  allowedPaths: ["api/_lib/metaMessengerWebhook.server.ts"],
  forbiddenPaths: ["src/"],
  acceptanceCriteria: [
    "Typecheck passes.",
    "Build passes.",
    "Codex review completes.",
    "A real customer taps the button and receives the right reply.",
  ],
  requiredChecks: ["typecheck", "build"],
  permissions: ["read_repository", "run_checks"],
  stoppingRules: ["Stop before any commit, push or deploy."],
  baseCommit: "a".repeat(40),
};

const boxes = [];
afterEach(() => {
  while (boxes.length) rmSync(boxes.pop(), { recursive: true, force: true });
});

function workspace(task = LEGACY_TASK) {
  const dir = mkdtempSync(path.join(tmpdir(), "atlas-orch-"));
  boxes.push(dir);
  const taskFile = path.join(dir, "task.json");
  writeFileSync(taskFile, JSON.stringify(task, null, 2));
  return { dir, taskFile, task, stateRoot: path.join(dir, "state") };
}

const RUN_DATA = {
  runId: "run-20260818T000000Z-ATLAS-TEST",
  branch: "agent/ATLAS-TEST",
  worktree: "/tmp/atlas-worktrees/ATLAS-TEST",
  filesChanged: ["api/_lib/metaMessengerWebhook.server.ts"],
};

/** A worker whose every step is scripted. Records what it was asked to do. */
function fakeWorker(name, script) {
  const calls = [];
  return {
    name,
    calls,
    capabilities: { inspect: { permission: "read_repository" } },
    async act({ action, state }) {
      const step =
        typeof script === "function"
          ? script(calls.length, state)
          : script[Math.min(calls.length, script.length - 1)];
      calls.push({ action, step: calls.length + 1, activeRunId: state.activeRun?.runId ?? null });
      return { ...step, worker: name, action };
    },
  };
}

/** Passes the preflight, then implements everything successfully. */
const happyRepo = () =>
  fakeWorker("repo", (call) =>
    call === 0
      ? ok("repo", "inspect", {
          evidence: [
            evidence({
              worker: "repo",
              action: "inspect",
              kind: "preflight",
              summary: "preflight READY_TO_RUN",
            }),
          ],
          verifiedBoundariesAdded: ["repo.preflight"],
        })
      : ok("repo", "implement", {
          changed: true,
          evidence: [
            evidence({
              worker: "repo",
              action: "implement",
              kind: "diff",
              summary: "1 file changed",
            }),
          ],
          verifiedBoundariesAdded: [
            "repo.implementation",
            "repo.checks",
            "repo.checks.typecheck",
            "repo.checks.build",
            "review.codex",
          ],
          data: { ...RUN_DATA, state: "READY_FOR_HUMAN_REVIEW", reviewVerdict: "PASS" },
        }),
  );

const run = (box, workers, extra = {}) =>
  orchestrate(box.taskFile, { stateRoot: box.stateRoot, workers, ...extra });

/* ══ 1. State creation ═════════════════════════════════════════════════════ */

test("state is created from a LEGACY task with no V2 fields", () => {
  const state = createTaskState({ task: LEGACY_TASK, taskFile: "task.json" });

  assert.equal(validateTaskState(state).valid, true, validateTaskState(state).errors.join("; "));
  assert.equal(state.taskId, "ATLAS-TEST");
  assert.equal(state.goal, LEGACY_TASK.objective, "goal falls back to the objective");
  assert.equal(state.status, "pending");
  assert.deepEqual(state.verifiedBoundaries, []);
  assert.equal(state.currentBlocker, null);
  assert.equal(state.attempts.total, 0);
  assert.deepEqual(state.budget, DEFAULT_BUDGET);
  assert.equal(state.successCriteria.length, 4);
});

test("success criteria separate what the agent can prove from what it cannot", () => {
  const criteria = successCriteriaFor(LEGACY_TASK);
  assert.deepEqual(
    criteria.map((c) => [c.id, c.verifiedBy]),
    [
      ["C1", "repo.checks.typecheck"],
      ["C2", "repo.checks.build"],
      ["C3", "review.codex"],
      ["C4", null],
    ],
  );
  assert.ok(criteria.every((c) => c.status === "pending"));

  // A V2 task may declare its own verifier and its own ids.
  const declared = successCriteriaFor({
    successCriteria: [{ id: "X1", text: "n8n route selected", verifiedBy: "n8n.execution" }],
  });
  assert.deepEqual(declared[0], {
    id: "X1",
    text: "n8n route selected",
    verifiedBy: "n8n.execution",
    status: "pending",
    evidenceIds: [],
    verifiedAt: null,
  });
});

/* ══ 2 & 3. Persistence, reload, atomic update ═════════════════════════════ */

test("state round-trips through the store and reloads identically", () => {
  const box = workspace();
  const store = TaskStateStore.open("ATLAS-TEST", path.join(box.stateRoot, "task-state"));
  const state = createTaskState({ task: LEGACY_TASK, taskFile: box.taskFile });

  assert.equal(store.load(), null, "a goal that never ran has no state");
  store.save(state);
  const reloaded = store.load();

  assert.equal(reloaded.taskId, state.taskId);
  assert.equal(reloaded.goal, state.goal);
  assert.deepEqual(reloaded.successCriteria, state.successCriteria);
  assert.ok(existsSync(store.stateFile));
});

test("state updates are atomic and leave no partial files behind", () => {
  const box = workspace();
  const store = TaskStateStore.open("ATLAS-TEST", path.join(box.stateRoot, "task-state"));
  const state = createTaskState({ task: LEGACY_TASK, taskFile: box.taskFile });

  for (let i = 0; i < 5; i += 1) {
    state.attempts.total = i;
    store.save(state);
    // Every intermediate read is a COMPLETE document, never a truncated one.
    assert.equal(JSON.parse(readFileSync(store.stateFile, "utf8")).attempts.total, i);
  }

  const leftovers = readdirSync(store.dir).filter((f) => f.includes(".tmp-"));
  assert.deepEqual(leftovers, [], "atomic writes must not leave temp files");
});

test("checkpoints are written per step and never overwrite each other", async () => {
  const box = workspace();
  const { state, store } = await run(box, { repo: happyRepo() });

  const checkpoints = store.checkpoints();
  assert.ok(checkpoints.length >= state.attempts.total, "one checkpoint per step at least");
  assert.ok(checkpoints.includes("0001-repo.json"));
  assert.equal(
    JSON.parse(readFileSync(store.file("checkpoints", "0001-repo.json"), "utf8")).attempts.total,
    1,
  );
});

/* ══ 4 & 5. Resume instead of restart (the ATLAS-004 lesson) ═══════════════ */

test("error_max_turns maps to a RESUMABLE blocker, not a failure", () => {
  const result = resultFromRun(
    {
      state: "PAUSED_BUILDER_BUDGET",
      taskId: "ATLAS-TEST",
      pauseReason: "builder_budget_exhausted",
      filesChanged: ["api/_lib/metaMessengerWebhook.server.ts"],
      checkResults: [],
      notes: [],
      ...RUN_DATA,
    },
    "implement",
  );

  assert.equal(result.status, "blocked", "a spent turn budget is not a failure");
  assert.equal(result.blocker.kind, "builder_budget_exhausted");
  assert.equal(result.resumable, true);
  assert.equal(result.terminal, false, "it must never be terminal — there is work to continue");
  assert.equal(result.suggestedNextWorker, "repo");
  assert.equal(result.changed, true, "the changed files are still there");
  assert.equal(
    result.data.worktree,
    RUN_DATA.worktree,
    "the worktree is remembered, not discarded",
  );
});

test("a resumed goal continues the SAME worktree instead of starting a second one", async () => {
  const box = workspace();
  const repo = fakeWorker("repo", (call) => {
    if (call === 0) {
      return ok("repo", "inspect", { verifiedBoundariesAdded: ["repo.preflight"] });
    }
    if (call === 1) {
      return blocked(
        "repo",
        "implement",
        {
          boundary: "repo.implementation",
          kind: "builder_budget_exhausted",
          detail: "turn budget spent",
        },
        {
          resumable: true,
          changed: true,
          evidence: [
            evidence({
              worker: "repo",
              action: "implement",
              kind: "diff",
              summary: "2 files changed",
            }),
          ],
          data: { ...RUN_DATA, state: "PAUSED_BUILDER_BUDGET" },
        },
      );
    }
    return ok("repo", "resume_implement", {
      changed: true,
      evidence: [
        evidence({
          worker: "repo",
          action: "resume_implement",
          kind: "diff",
          summary: "3 files changed",
        }),
      ],
      verifiedBoundariesAdded: [
        "repo.implementation",
        "repo.checks",
        "repo.checks.typecheck",
        "repo.checks.build",
        "review.codex",
      ],
      data: { ...RUN_DATA, state: "READY_FOR_HUMAN_REVIEW" },
    });
  });

  const { state } = await run(box, { repo });

  assert.deepEqual(
    repo.calls.map((c) => c.action),
    ["inspect", "implement", "resume_implement"],
    "the interrupted implementation is RESUMED, never re-implemented",
  );
  assert.equal(repo.calls[2].activeRunId, RUN_DATA.runId, "the same run, so the same worktree");
  assert.equal(state.activeRun.worktree, RUN_DATA.worktree);
  assert.ok(state.verifiedBoundaries.includes("repo.implementation"));
});

test("the repo worker asks the engine to RESUME, with a resume prompt", async () => {
  const calls = [];
  const worker = createRepoWorker({
    engine: {
      runTask: async () => {
        calls.push({ kind: "runTask" });
        return { run: { state: "PASS", runId: "r1", filesChanged: [], checkResults: [] } };
      },
      resumeRun: async (runId, opts) => {
        calls.push({
          kind: "resumeRun",
          runId,
          prompt: opts.prompt,
          continueAfterTerminal: opts.continueAfterTerminal,
        });
        return {
          run: { state: "PASS", runId, filesChanged: [], checkResults: [], reviewVerdict: "PASS" },
        };
      },
    },
  });

  const state = createTaskState({ task: LEGACY_TASK, taskFile: "task.json" });
  state.activeRun = { runId: "run-abc", worktree: "/tmp/wt", filesChanged: ["api/a.ts"] };
  state.currentBlocker = {
    boundary: "repo.implementation",
    kind: "builder_budget_exhausted",
    detail: "spent",
  };

  const result = await worker.act({
    action: "resume_implement",
    task: LEGACY_TASK,
    taskFile: "t.json",
    state,
  });

  assert.equal(result.status, "success");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "resumeRun");
  assert.equal(calls[0].runId, "run-abc");
  assert.equal(calls[0].continueAfterTerminal, true);
  assert.match(calls[0].prompt, /CONTINUATION, not a new attempt/);
  assert.match(calls[0].prompt, /DO NOT start the implementation over/);
  assert.match(calls[0].prompt, /api\/a\.ts/, "the prompt names the work already in the worktree");
});

/* ══ 6, 7, 8. The progress rule ════════════════════════════════════════════ */

test("a fingerprint ignores volatile detail but not the actual failure", () => {
  const a = failureFingerprint({
    boundary: "repo.checks",
    kind: "check_failure",
    detail: "src/a.ts:12 type error",
  });
  const b = failureFingerprint({
    boundary: "repo.checks",
    kind: "check_failure",
    detail: "src/a.ts:47 type error",
  });
  const c = failureFingerprint({
    boundary: "repo.checks",
    kind: "check_failure",
    detail: "missing import",
  });

  assert.equal(a, b, "the same error on a different line is the same error");
  assert.notEqual(a, c);
  assert.equal(failureFingerprint(null), null);
});

test("a DIFFERENT blocker continues the loop", () => {
  const verdict = evaluateProgress({
    result: blocked("repo", "implement", {
      boundary: "repo.checks",
      kind: "check_failure",
      detail: "b",
    }),
    previousFingerprint: "repo.checks|check_failure|a",
    sameFailureCount: 1,
    newEvidenceCount: 0,
  });
  assert.equal(verdict.continue, true);
  assert.equal(verdict.reason, "the blocker changed");
  assert.equal(verdict.sameFailureCount, 1);
});

test("the SAME blocker with NEW evidence continues the loop", () => {
  const result = blocked("repo", "implement", {
    boundary: "repo.checks",
    kind: "check_failure",
    detail: "a",
  });
  const verdict = evaluateProgress({
    result,
    previousFingerprint: result.failureFingerprint,
    sameFailureCount: 1,
    newEvidenceCount: 2,
  });
  assert.equal(verdict.continue, true);
  assert.equal(verdict.newEvidence, true);
});

test("the SAME failure with NOTHING new escalates instead of burning tokens", () => {
  const result = blocked("repo", "implement", {
    boundary: "repo.checks",
    kind: "check_failure",
    detail: "a",
  });
  const verdict = evaluateProgress({
    result,
    previousFingerprint: result.failureFingerprint,
    sameFailureCount: 1,
    newEvidenceCount: 0,
  });
  assert.equal(verdict.continue, false);
  assert.equal(verdict.status, "escalated");
  assert.equal(verdict.stopReason, "repeated_failure_without_new_evidence");
});

test("a pause is never counted as a failed attempt", () => {
  const verdict = evaluateProgress({
    result: paused("repo", "implement", {
      boundary: "repo.implementation",
      kind: "usage_limit",
      detail: "limit",
    }),
    previousFingerprint: null,
  });
  assert.equal(verdict.continue, false);
  assert.equal(verdict.status, "paused", "paused, not failed");
  assert.equal(verdict.stopReason, "usage_limit");
});

test("a scope violation is terminal at any budget", () => {
  const verdict = evaluateProgress({
    result: blocked(
      "repo",
      "implement",
      { boundary: "repo.scope", kind: "scope_violation", detail: "wrote src/secret.ts" },
      { terminal: true },
    ),
    previousFingerprint: null,
  });
  assert.equal(verdict.continue, false);
  assert.equal(verdict.status, "escalated");
  assert.equal(verdict.stopReason, "scope_violation");
});

test("the loop escalates on a repeated identical failure, end to end", async () => {
  const box = workspace();
  const sameFailure = blocked(
    "repo",
    "implement",
    {
      boundary: "repo.checks",
      kind: "check_failure",
      detail: "typecheck: api/x.ts:3 not assignable",
    },
    {
      resumable: true,
      evidence: [
        evidence({
          worker: "repo",
          action: "implement",
          kind: "check",
          summary: "typecheck: NEW_FAILURE",
        }),
      ],
      data: { ...RUN_DATA, state: "CHECKS_FAILED" },
    },
  );
  const repo = fakeWorker("repo", (call) =>
    call === 0
      ? ok("repo", "inspect", { verifiedBoundariesAdded: ["repo.preflight"] })
      : sameFailure,
  );

  const { state } = await run(box, { repo });

  assert.equal(state.status, "escalated");
  assert.equal(state.stopReason, "repeated_failure_without_new_evidence");
  assert.equal(repo.calls.length, 3, "inspect, one attempt, one identical retry — then stop");
  assert.equal(state.currentBlocker.boundary, "repo.checks");
});

test("new evidence keeps the loop going until the STEP BUDGET stops it", async () => {
  const box = workspace();
  const repo = fakeWorker("repo", (call) =>
    call === 0
      ? ok("repo", "inspect", { verifiedBoundariesAdded: ["repo.preflight"] })
      : blocked(
          "repo",
          "implement",
          { boundary: "repo.checks", kind: "check_failure", detail: "typecheck failed" },
          {
            resumable: true,
            // Different evidence every round: the agent IS learning something,
            // so the repeat rule allows it — the total budget is the backstop.
            evidence: [
              evidence({
                worker: "repo",
                action: "implement",
                kind: "check",
                summary: `attempt ${call} log`,
              }),
            ],
            data: { ...RUN_DATA, state: "CHECKS_FAILED" },
          },
        ),
  );

  const box2 = workspace({
    ...LEGACY_TASK,
    budget: { maxTotalSteps: 5, maxPerWorkerAttempts: 99 },
  });
  const { state } = await run(box2, { repo });

  assert.equal(state.status, "escalated");
  assert.equal(state.stopReason, "step_budget_exhausted");
  assert.equal(state.attempts.total, 5, "bounded, never infinite");
  assert.ok(box.dir);
});

/* ══ 10. Per-worker attempt budget ═════════════════════════════════════════ */

test("a worker that has spent its attempt budget stops the goal", async () => {
  const box = workspace({ ...LEGACY_TASK, budget: { maxPerWorkerAttempts: 2, maxTotalSteps: 30 } });
  const repo = fakeWorker("repo", (call) =>
    call === 0
      ? ok("repo", "inspect", { verifiedBoundariesAdded: ["repo.preflight"] })
      : blocked(
          "repo",
          "implement",
          { boundary: "repo.checks", kind: "check_failure", detail: "typecheck failed" },
          {
            resumable: true,
            evidence: [
              evidence({
                worker: "repo",
                action: "implement",
                kind: "check",
                summary: `attempt ${call}`,
              }),
            ],
            data: { ...RUN_DATA, state: "CHECKS_FAILED" },
          },
        ),
  );

  const { state } = await run(box, { repo });

  assert.equal(state.status, "escalated");
  assert.equal(state.stopReason, "worker_attempt_budget_exhausted");
  assert.equal(state.attempts.byWorker.repo, 2);
});

test("waiting at a gate does not spend the worker's attempt budget", async () => {
  const box = workspace({ ...LEGACY_TASK, budget: { maxPerWorkerAttempts: 2 } });
  const repo = fakeWorker("repo", () => ({
    ...ok("repo", "inspect"),
    status: "requires_approval",
    requiresApproval: {
      worker: "repo",
      action: "task_approval",
      actionClass: "B",
      reason: "no receipt",
    },
  }));

  // Four re-runs while the human has not approved yet. None of them is an
  // attempt at the work, so none of them may exhaust the budget for it.
  for (let i = 0; i < 4; i += 1) await run(box, { repo });
  const { state } = await run(box, { repo });

  assert.equal(state.status, "waiting_for_approval");
  assert.equal(state.attempts.byWorker.repo ?? 0, 0, "a gate is not an attempt");
  assert.equal(state.attempts.total, 5, "the step count stays honest");
  assert.equal(state.approvalsPending.length, 1, "the same approval is queued once");
});

test("workerExhausted reads the per-worker counter", () => {
  const state = createTaskState({ task: LEGACY_TASK, taskFile: "t.json" });
  state.attempts.byWorker = { repo: 5, n8n: 1 };
  assert.equal(workerExhausted(state, "repo"), true);
  assert.equal(workerExhausted(state, "n8n"), false);
  assert.equal(workerExhausted(state, "vercel"), false);
});

/* ══ 11. Routing by failing boundary ═══════════════════════════════════════ */

test("routing always starts read-only, then implements", () => {
  const state = createTaskState({ task: LEGACY_TASK, taskFile: "t.json" });
  const workers = { repo: {}, codex: {}, n8n: {}, vercel: {} };

  const first = routeNext(state, { task: LEGACY_TASK, workers });
  assert.deepEqual([first.worker, first.action], ["repo", "inspect"]);

  state.verifiedBoundaries.push("repo.preflight");
  const second = routeNext(state, { task: LEGACY_TASK, workers });
  assert.deepEqual([second.worker, second.action], ["repo", "implement"]);
});

test("each failing boundary routes to the worker that OWNS it", () => {
  const workers = { repo: {}, codex: {}, n8n: {}, vercel: {} };
  const at = (boundary, kind) => {
    const state = createTaskState({ task: LEGACY_TASK, taskFile: "t.json" });
    state.verifiedBoundaries.push("repo.preflight");
    state.currentBlocker = { boundary, kind, detail: "x" };
    return routeNext(state, { task: LEGACY_TASK, workers });
  };

  assert.equal(at("repo.checks", "check_failure").worker, "repo");
  assert.equal(at("n8n.execution", "node_error").worker, "n8n");
  assert.equal(
    at("n8n.execution", "node_error").action,
    "inspect_execution",
    "inspect before modify",
  );
  assert.equal(at("vercel.deployment", "build_failed").worker, "vercel");
  assert.equal(
    at("review.findings", "revision_requested").worker,
    "repo",
    "the implementer fixes findings",
  );
  assert.equal(at("review.codex", "needs_human").worker, "codex");

  // A scope breach has no owner: it is a human decision, not a retry.
  const scope = at("repo.scope", "scope_violation");
  assert.equal(scope.worker, null);
  assert.equal(scope.stop.stopReason, "no_owner_for_boundary");
});

test("routing selects the n8n workflow action and attaches its task-declared target", () => {
  const task = {
    ...LEGACY_TASK,
    systemTargets: { n8n: { workflowId: "wf-public-1" } },
  };
  const state = createTaskState({ task, taskFile: "t.json" });
  state.verifiedBoundaries.push("repo.preflight");
  state.currentBlocker = {
    boundary: "n8n.workflow",
    kind: "workflow_inspection_required",
    detail: "inspect the declared workflow",
  };

  const decision = routeNext(state, { task, workers: { repo: {}, n8n: {} } });

  assert.equal(decision.worker, "n8n");
  assert.equal(decision.action, "inspect_workflow");
  assert.deepEqual(decision.args, { workflowId: "wf-public-1" });
});

test("legacy tasks route external work with empty args", () => {
  const state = createTaskState({ task: LEGACY_TASK, taskFile: "t.json" });
  state.verifiedBoundaries.push("repo.preflight");
  state.currentBlocker = {
    boundary: "n8n.execution",
    kind: "execution_failure",
    detail: "inspect an execution",
  };

  const decision = routeNext(state, {
    task: LEGACY_TASK,
    workers: { repo: {}, n8n: {} },
  });

  assert.equal(decision.action, "inspect_execution");
  assert.deepEqual(decision.args, {});
});

test("a blocker whose owning worker is not configured stops instead of improvising", () => {
  const state = createTaskState({ task: LEGACY_TASK, taskFile: "t.json" });
  state.verifiedBoundaries.push("repo.preflight");
  state.currentBlocker = {
    boundary: "n8n.execution",
    kind: "node_error",
    detail: "URL is not defined",
  };

  const decision = routeNext(state, { task: LEGACY_TASK, workers: { repo: {} } });

  assert.equal(decision.worker, null);
  assert.equal(decision.stop.status, "escalated");
  assert.equal(decision.stop.stopReason, "worker_unavailable");
  assert.match(decision.stop.reason, /n8n worker/);
});

test("a review is required for code and skipped for prose", () => {
  assert.equal(reviewRequired({ filesChanged: ["api/_lib/x.server.ts"] }).required, true);
  assert.equal(reviewRequired({ filesChanged: ["src/components/Button.tsx"] }).required, true);
  assert.equal(reviewRequired({ filesChanged: ["docs/notes.md"] }).required, false);
  assert.equal(reviewRequired({ filesChanged: [] }).required, false);
  // Policy is configurable per task, not hardcoded per repo.
  assert.equal(
    reviewRequired({
      filesChanged: ["scripts/test-x.mjs"],
      task: { reviewPolicy: { ...DEFAULT_REVIEW_POLICY, reviewExtensions: [] } },
    }).required,
    false,
  );
});

/* ══ 11b. External-only goals ══════════════════════════════════════════════ */

/**
 * An EXTERNAL-ONLY goal: read one n8n workflow, prove one criterion, finish.
 * No file is written, no worktree is created, and the state of the working tree
 * is irrelevant to every step of it.
 */
const EXTERNAL_TASK = {
  ...LEGACY_TASK,
  taskId: "ATLAS-TEST-EXTERNAL",
  permissions: ["read_repository", "inspect_external_system"],
  systemTargets: { n8n: { workflowId: "wf-public-9" } },
  successCriteria: [
    { id: "C1", text: "The declared n8n workflow is inspected.", verifiedBy: "n8n.workflow" },
  ],
};

/** Blocked on a dirty tree, terminally, the way the real preflight reports it. */
const dirtyRepo = () =>
  fakeWorker("repo", () =>
    blocked(
      "repo",
      "inspect",
      {
        boundary: "repo.preflight",
        kind: "dirty_repository",
        detail: "working tree has uncommitted changes",
      },
      { terminal: true },
    ),
  );

const inspectedWorkflow = () =>
  fakeWorker("n8n", () =>
    ok("n8n", "inspect_workflow", {
      evidence: [
        evidence({
          worker: "n8n",
          action: "inspect_workflow",
          kind: "inspection",
          summary: "workflow wf-public-9 is active with 19 nodes",
        }),
      ],
      verifiedBoundariesAdded: ["n8n.workflow"],
      data: { id: "wf-public-9", active: true },
    }),
  );

test("an external-only goal starts at its connector, not at the repo preflight", () => {
  const state = createTaskState({ task: EXTERNAL_TASK, taskFile: "t.json" });

  const decision = routeNext(state, { task: EXTERNAL_TASK, workers: { repo: {}, n8n: {} } });

  assert.deepEqual([decision.worker, decision.action], ["n8n", "inspect_workflow"]);
  assert.deepEqual(decision.args, { workflowId: "wf-public-9" });
});

test("repository work still waits for the read-only preflight", () => {
  const fresh = createTaskState({ task: LEGACY_TASK, taskFile: "t.json" });
  assert.deepEqual(
    [routeNext(fresh, { task: LEGACY_TASK, workers: { repo: {} } }).worker, "inspect"],
    ["repo", "inspect"],
  );

  // Even a proven repo blocker does not skip the preflight that protects it.
  const blockedState = createTaskState({ task: LEGACY_TASK, taskFile: "t.json" });
  blockedState.currentBlocker = { boundary: "repo.checks", kind: "check_failure", detail: "tsc" };
  const decision = routeNext(blockedState, { task: LEGACY_TASK, workers: { repo: {} } });
  assert.deepEqual([decision.worker, decision.action], ["repo", "inspect"]);
});

test("a goal whose criteria are all proven COMPLETES instead of implementing", () => {
  const state = createTaskState({ task: EXTERNAL_TASK, taskFile: "t.json" });
  state.verifiedBoundaries.push("n8n.workflow");
  applyVerification(state);

  const decision = routeNext(state, { task: EXTERNAL_TASK, workers: { repo: {}, n8n: {} } });

  assert.equal(decision.worker, null, "no repo.implement fallback for a satisfied goal");
  assert.equal(decision.stop.status, "completed");
  assert.equal(decision.stop.stopReason, "all_criteria_verified");
});

test("an external-only goal completes on a DIRTY repository and never touches it", async () => {
  const box = workspace(EXTERNAL_TASK);
  const repo = dirtyRepo();
  const n8n = inspectedWorkflow();

  const result = await run(box, { repo, n8n });

  assert.equal(result.state.status, "completed");
  assert.equal(result.state.stopReason, "all_criteria_verified");
  assert.equal(result.state.successCriteria[0].status, "verified");
  assert.deepEqual(
    n8n.calls.map((c) => c.action),
    ["inspect_workflow"],
  );
  assert.equal(repo.calls.length, 0, "a dirty tree is none of an external read's business");
});

test("repository work still stops dead on a DIRTY repository", async () => {
  const box = workspace(LEGACY_TASK);
  const repo = dirtyRepo();

  const result = await run(box, { repo, codex: fakeWorker("codex", () => ok("codex", "review")) });

  assert.equal(result.state.status, "escalated");
  assert.equal(result.state.stopReason, "dirty_repository");
  assert.deepEqual(
    repo.calls.map((c) => c.action),
    ["inspect"],
    "preflight refused, so nothing was implemented",
  );
});

test("an external read that proves nothing escalates on ITS OWN worker", async () => {
  const box = workspace(EXTERNAL_TASK);
  const repo = dirtyRepo();
  // Succeeds, but never verifies the boundary the criterion depends on.
  const n8n = fakeWorker("n8n", () => ok("n8n", "inspect_workflow"));

  const result = await run(box, { repo, n8n });

  assert.equal(result.state.status, "escalated");
  assert.equal(result.state.stopReason, "worker_attempt_budget_exhausted");
  assert.equal(n8n.calls.length, DEFAULT_BUDGET.maxPerWorkerAttempts);
  assert.equal(repo.calls.length, 0, "an unproven external boundary never becomes repo work");
});

/* ══ 12. Approval classification ═══════════════════════════════════════════ */

test("action classes follow the permission tiers, and default to C when unsure", () => {
  assert.equal(actionClassOf({ permission: "read_repository" }), "A");
  assert.equal(actionClassOf({ permission: "edit_task_workspace" }), "A");
  assert.equal(actionClassOf({ permission: "inspect_external_system" }), "A");
  assert.equal(actionClassOf({ permission: "commit" }), "B");
  assert.equal(actionClassOf({ permission: "n8n_change" }), "B");
  assert.equal(actionClassOf({ permission: "production_deploy" }), "C");
  assert.equal(actionClassOf({ permission: "secret_rotation" }), "C");
  assert.equal(actionClassOf({ permission: "who_knows" }), "C", "unknown means approval");
  assert.equal(actionClassOf({}), "C", "no permission at all means approval");
});

test("a Class B or C capability is queued for a human and never performed", async () => {
  const n8n = createN8nWorker({
    connector: {
      publish: async () => {
        throw new Error("the connector must never be reached for a Class B action");
      },
    },
  });

  const result = await n8n.act({
    action: "publish",
    task: { ...LEGACY_TASK, permissions: [...LEGACY_TASK.permissions, "inspect_external_system"] },
    state: {},
  });

  assert.equal(result.status, "requires_approval");
  assert.equal(result.requiresApproval.actionClass, "B");
  assert.equal(result.changed, false);
  assert.match(result.requiresApproval.detail, /performed nothing/);
});

test("a production deploy is Class C and stops the goal at an approval boundary", async () => {
  const box = workspace();
  const repo = fakeWorker("repo", (call) =>
    call === 0
      ? ok("repo", "inspect", { verifiedBoundariesAdded: ["repo.preflight"] })
      : blocked(
          "repo",
          "implement",
          {
            boundary: "vercel.config",
            kind: "missing_env",
            detail: "PAYMENT_WEBHOOK_URL is absent in production",
          },
          {
            suggestedNextWorker: "vercel",
            data: { ...RUN_DATA, suggestedAction: "deploy_production" },
          },
        ),
  );
  const vercel = createVercelWorker({ connector: null });

  const { state } = await run(box, { repo, vercel });

  assert.equal(state.status, "waiting_for_approval");
  assert.equal(state.approvalsPending.length, 1);
  assert.equal(state.approvalsPending[0].actionClass, "C");
  assert.equal(state.approvalsPending[0].action, "deploy_production");
  assert.match(state.nextAction, /approve vercel\.deploy_production/);
});

/* ══ 16 & 17. Worker permission boundaries ═════════════════════════════════ */

test("the repo worker has NO capability that touches an external system", async () => {
  const worker = createRepoWorker({
    engine: { runTask: async () => ({ run: {} }), resumeRun: async () => ({ run: {} }) },
  });

  for (const action of ["publish", "apply_draft", "deploy_production", "set_production_env"]) {
    const result = await worker.act({ action, task: LEGACY_TASK, taskFile: "t.json", state: {} });
    assert.equal(result.status, "not_permitted", `repo must not be able to ${action}`);
    assert.equal(result.terminal, true);
    assert.match(result.blocker.detail, /has no "/);
  }
});

test("an n8n problem is never solved by pushing the repo worker harder", async () => {
  // The task DOES grant read-only external inspection, so the stop below is
  // about the missing connector, not about a missing permission.
  const box = workspace({
    ...LEGACY_TASK,
    permissions: [...LEGACY_TASK.permissions, "inspect_external_system"],
  });
  // The repo worker reports an n8n boundary. The router must hand it to n8n,
  // not tell the repo worker to reach further than its rules allow.
  const repo = fakeWorker("repo", (call) =>
    call === 0
      ? ok("repo", "inspect", { verifiedBoundariesAdded: ["repo.preflight"] })
      : blocked(
          "repo",
          "implement",
          {
            boundary: "n8n.execution",
            kind: "node_error",
            detail: "URL is not defined in the Code node",
          },
          { data: RUN_DATA },
        ),
  );
  const n8n = createN8nWorker({ connector: null });

  const { state } = await run(box, { repo, n8n });

  assert.equal(repo.calls.length, 2, "the repo worker is not asked again");
  assert.equal(state.activeWorker, null);
  assert.equal(state.status, "escalated");
  assert.equal(state.stopReason, "connector_unavailable");
  assert.equal(state.history.at(-1).worker, "n8n", "the n8n worker was the one asked");
});

test("an external read is refused unless the task granted the permission", async () => {
  const connector = { inspect_execution: async () => ({ ok: true, summary: "ran" }) };
  const n8n = createN8nWorker({ connector });

  const ungranted = await n8n.act({ action: "inspect_execution", task: LEGACY_TASK, state: {} });
  assert.equal(ungranted.status, "not_permitted");
  assert.match(ungranted.blocker.detail, /does not grant "inspect_external_system"/);

  const granted = await n8n.act({
    action: "inspect_execution",
    task: { ...LEGACY_TASK, permissions: [...LEGACY_TASK.permissions, "inspect_external_system"] },
    state: {},
    args: { executionId: "exec-public-1" },
  });
  assert.equal(granted.status, "success");
});

test("the orchestrator forwards structured public target args to an external worker", async () => {
  const task = {
    ...LEGACY_TASK,
    permissions: [...LEGACY_TASK.permissions, "inspect_external_system"],
    systemTargets: { n8n: { workflowId: "wf-public-2" } },
  };
  const box = workspace(task);
  const repo = fakeWorker("repo", (call) =>
    call === 0
      ? ok("repo", "inspect", { verifiedBoundariesAdded: ["repo.preflight"] })
      : blocked(
          "repo",
          "implement",
          {
            boundary: "n8n.workflow",
            kind: "workflow_inspection_required",
            detail: "inspect the workflow",
          },
          { data: RUN_DATA },
        ),
  );
  const calls = [];
  const n8n = createN8nWorker({
    connector: {
      inspect_workflow: async (args) => {
        calls.push(args);
        return { ok: true, summary: "workflow inspected", verifies: ["n8n.workflow"] };
      },
    },
  });

  await run(box, { repo, n8n });

  assert.deepEqual(calls, [{ workflowId: "wf-public-2" }]);
});

test("an external read with a missing required target fails before the connector call", async () => {
  let called = false;
  const n8n = createN8nWorker({
    connector: {
      inspect_workflow: async () => {
        called = true;
        return { ok: true, summary: "unexpected" };
      },
    },
  });
  const result = await n8n.act({
    action: "inspect_workflow",
    task: { ...LEGACY_TASK, permissions: [...LEGACY_TASK.permissions, "inspect_external_system"] },
    state: {},
    args: {},
  });

  assert.equal(result.status, "failed");
  assert.equal(result.terminal, true);
  assert.match(result.blocker.detail, /workflowId/);
  assert.equal(called, false);
});

test("secret-bearing task targets are rejected before an external worker receives them", async () => {
  const task = {
    ...LEGACY_TASK,
    systemTargets: { n8n: { workflowId: "wf-public-3", apiKey: "must-not-cross" } },
  };
  const box = workspace(task);
  const repo = fakeWorker("repo", (call) =>
    call === 0
      ? ok("repo", "inspect", { verifiedBoundariesAdded: ["repo.preflight"] })
      : blocked("repo", "implement", {
          boundary: "n8n.workflow",
          kind: "workflow_inspection_required",
          detail: "inspect the workflow",
        }),
  );
  let calls = 0;
  const n8n = { name: "n8n", act: async () => (calls += 1) };

  const { state } = await run(box, { repo, n8n });

  assert.equal(calls, 0);
  assert.equal(state.status, "failed");
  assert.match(state.currentBlocker.detail, /secret-bearing field/);
});

test("no connector means NOT AVAILABLE — never a simulated success", async () => {
  const task = {
    ...LEGACY_TASK,
    permissions: [...LEGACY_TASK.permissions, "inspect_external_system"],
  };
  for (const worker of [createN8nWorker(), createVercelWorker()]) {
    const action = worker.name === "n8n" ? "inspect_workflow" : "inspect_deployments";
    const result = await worker.act({ action, task, state: {} });
    assert.equal(result.status, "not_available");
    assert.equal(result.changed, false);
    assert.deepEqual(result.verifiedBoundariesAdded, [], "an unavailable read proves nothing");
    assert.match(result.blocker.detail, /will not be simulated/);
  }
});

test("guard refuses an action a worker does not have at all", () => {
  const refusal = guard({
    worker: "n8n",
    action: "rm_rf_everything",
    task: LEGACY_TASK,
    capabilities: N8N_CAPABILITIES,
  });
  assert.equal(refusal.status, "not_permitted");
});

/* ══ 13 & 14. Criteria, completion, reports ════════════════════════════════ */

test("verified boundaries mark their criteria, and only their criteria", () => {
  const state = createTaskState({ task: LEGACY_TASK, taskFile: "t.json" });
  state.verifiedBoundaries.push("repo.checks", "review.codex");
  applyVerification(state);

  assert.equal(state.successCriteria[0].status, "verified", "typecheck proven by repo.checks");
  assert.equal(state.successCriteria[1].status, "verified", "build proven by repo.checks");
  assert.equal(state.successCriteria[2].status, "verified", "review proven by review.codex");
  assert.equal(state.successCriteria[3].status, "pending", "the customer-facing one is NOT proven");
});

test("a goal with unprovable criteria stops for a human instead of claiming success", async () => {
  const box = workspace();
  const { state, reportPath } = await run(box, { repo: happyRepo() });

  assert.equal(state.status, "paused");
  assert.equal(state.stopReason, "manual_verification_required");
  assert.equal(state.successCriteria[3].status, "manual_verification_required");
  assert.match(state.nextAction, /agent:verify/);
  assert.ok(existsSync(reportPath));
});

test("a human can record the verification the agent cannot do, and the goal completes", async () => {
  const box = workspace();
  await run(box, { repo: happyRepo() });

  const verified = verifyCriteria(
    "ATLAS-TEST",
    { criteria: ["C4"], by: "Sai Sai Khay", note: "tapped it on my phone" },
    { stateRoot: box.stateRoot },
  );
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.marked, ["C4"]);
  assert.equal(verified.state.successCriteria[3].verifiedBy, "human:Sai Sai Khay");

  const { state } = await run(box, { repo: happyRepo() });
  assert.equal(state.status, "completed");
  assert.equal(state.stopReason, "all_criteria_verified");
});

test("verification refuses an unknown criterion and an anonymous verifier", async () => {
  const box = workspace();
  await run(box, { repo: happyRepo() });

  assert.equal(
    verifyCriteria("ATLAS-TEST", { criteria: ["C9"], by: "x" }, { stateRoot: box.stateRoot }).ok,
    false,
  );
  assert.equal(
    verifyCriteria("ATLAS-TEST", { criteria: ["C4"], by: "" }, { stateRoot: box.stateRoot }).ok,
    false,
  );
});

test("the status block answers the six questions a human actually asks", async () => {
  const box = workspace();
  const { state } = await run(box, { repo: happyRepo() });
  const block = statusBlock(state);

  for (const heading of [
    "TASK",
    "GOAL",
    "STATUS",
    "VERIFIED",
    "CURRENT BLOCKER",
    "ACTIVE WORKER",
    "LAST ACTION",
    "NEXT ACTION",
    "APPROVALS REQUIRED",
  ]) {
    assert.match(block, new RegExp(`^${heading}`, "m"), `status block is missing ${heading}`);
  }
  assert.match(block, /ATLAS-TEST/);
});

test("the final report covers every section a handover needs", async () => {
  const box = workspace();
  const { state, report, reportPath } = await run(box, { repo: happyRepo() });

  for (const section of [
    "Original goal",
    "Root cause",
    "Changes made",
    "Systems touched",
    "Validation",
    "Reviewer result",
    "Production actions",
    "Success criteria",
    "Evidence",
    "Lessons applied",
    "Unresolved limitations",
  ]) {
    assert.match(report, new RegExp(section, "i"), `final report is missing "${section}"`);
  }
  assert.match(report, /none — no production action was performed or attempted/);
  assert.match(report, /needs human verification/);
  assert.equal(readFileSync(reportPath, "utf8"), report);
  assert.equal(finalReportMarkdown(state).includes(state.taskId), true);
});

/* ══ 15. Backward compatibility ════════════════════════════════════════════ */

test("a legacy V1 task orchestrates with no V2 fields and no migration step", async () => {
  const box = workspace();
  assert.equal("goal" in LEGACY_TASK, false);
  assert.equal("successCriteria" in LEGACY_TASK, false);
  assert.equal("budget" in LEGACY_TASK, false);

  const { ok: succeeded, state } = await run(box, { repo: happyRepo() });

  assert.equal(succeeded, true);
  assert.equal(state.goal, LEGACY_TASK.objective);
  assert.equal(state.successCriteria.length, 4);
  assert.deepEqual(state.budget, DEFAULT_BUDGET);
});

test("status and report read the stored state by task id alone", async () => {
  const box = workspace();
  await run(box, { repo: happyRepo() });

  const { state, store } = loadTaskState("ATLAS-TEST", { stateRoot: box.stateRoot });
  assert.equal(state.taskId, "ATLAS-TEST");
  assert.ok(existsSync(store.stateFile));

  const missing = loadTaskState("NO-SUCH-TASK", { stateRoot: box.stateRoot });
  assert.match(missing.error, /no task file and no stored state/);
});

test("a completed goal is not silently re-run", async () => {
  const box = workspace();
  await run(box, { repo: happyRepo() });
  verifyCriteria("ATLAS-TEST", { criteria: ["C4"], by: "test" }, { stateRoot: box.stateRoot });
  await run(box, { repo: happyRepo() });

  const repo = happyRepo();
  const again = await run(box, { repo });
  assert.equal(again.alreadyComplete, true);
  assert.equal(repo.calls.length, 0, "no worker is invoked for a finished goal");
});

/* ══ Lessons ═══════════════════════════════════════════════════════════════ */

test("the seeded lessons load and filter to what a task can trip over", () => {
  const all = loadLessons();
  assert.equal(all.length, 10);
  assert.ok(all.every((l) => l.id && l.lesson && Array.isArray(l.tags)));

  const relevant = relevantLessons(LEGACY_TASK);
  const ids = relevant.map((l) => l.id);
  assert.ok(ids.includes("L-007"), "the ATLAS-004 worktree lesson is universal");
  assert.ok(ids.includes("L-010"), "so is 'do not declare done until proven'");
  assert.ok(relevant.length <= 8);

  assert.equal(searchLessons("n8n").length >= 2, true);
  assert.deepEqual(
    searchLessons("L-001").map((l) => l.id),
    ["L-001"],
  );
  assert.deepEqual(searchLessons(""), []);
});

test("a task's lessons are handed to the resuming Builder", async () => {
  let prompt = "";
  const worker = createRepoWorker({
    engine: {
      runTask: async () => ({
        run: { state: "PASS", runId: "r", filesChanged: [], checkResults: [] },
      }),
      resumeRun: async (runId, opts) => {
        prompt = opts.prompt;
        return {
          run: { state: "PASS", runId, filesChanged: [], checkResults: [], reviewVerdict: "PASS" },
        };
      },
    },
  });
  const state = createTaskState({
    task: LEGACY_TASK,
    taskFile: "t.json",
    lessons: ["L-007: keep the worktree"],
  });
  state.activeRun = { runId: "r1", worktree: "/tmp/wt", filesChanged: [] };
  state.verifiedBoundaries.push("repo.preflight");

  await worker.act({ action: "resume_implement", task: LEGACY_TASK, taskFile: "t.json", state });

  assert.match(prompt, /L-007: keep the worktree/);
  assert.match(prompt, /Already proven, do not re-litigate: repo\.preflight/);
});

/* ══ Security ══════════════════════════════════════════════════════════════ */

test("secrets never reach state, evidence or reports", async () => {
  const box = workspace();
  const leaky =
    "connector failed: Authorization: Bearer sk-live-ABCDEF1234567890 token=hunter2secret";
  const repo = fakeWorker("repo", (call) =>
    call === 0
      ? ok("repo", "inspect", { verifiedBoundariesAdded: ["repo.preflight"] })
      : blocked(
          "repo",
          "implement",
          { boundary: "repo.checks", kind: "check_failure", detail: leaky },
          {
            evidence: [
              evidence({
                worker: "repo",
                action: "implement",
                kind: "check",
                summary: leaky,
                payload: { raw: leaky },
              }),
            ],
            data: { ...RUN_DATA, state: "CHECKS_FAILED" },
          },
        ),
  );

  const { state, store, report } = await run(box, { repo });
  const onDisk = readFileSync(store.stateFile, "utf8");
  const evidenceFiles = readdirSync(store.file("evidence")).map((f) =>
    readFileSync(store.file("evidence", f), "utf8"),
  );

  for (const text of [onDisk, report, ...evidenceFiles]) {
    assert.doesNotMatch(text, /sk-live-ABCDEF1234567890/, "a key must never be written down");
    assert.doesNotMatch(text, /hunter2secret/);
  }
  assert.match(onDisk, /«redacted/);
  assert.equal(state.currentBlocker.detail.includes("sk-live"), false);
});

test("redact leaves ordinary text alone", () => {
  assert.equal(redact("typecheck failed at api/x.ts:12"), "typecheck failed at api/x.ts:12");
  assert.equal(redact(42), 42);
});

/* ══ Contract hygiene ══════════════════════════════════════════════════════ */

test("every worker result the orchestrator acts on is schema-valid", () => {
  const results = [
    ok("repo", "implement"),
    blocked("repo", "implement", { boundary: "repo.checks", kind: "check_failure", detail: "x" }),
    paused("repo", "implement", {
      boundary: "repo.implementation",
      kind: "usage_limit",
      detail: "x",
    }),
    resultFromReview({ outcome: "success", review: { verdict: "PASS", findings: [] } }),
    resultFromReview({ outcome: "malformed_output", error: "not json" }),
  ];
  for (const result of results) {
    const validation = validateWorkerResult(result);
    assert.equal(
      validation.valid,
      true,
      `${result.worker}.${result.action}: ${validation.errors.join("; ")}`,
    );
  }
  // A blocked result with no fingerprint could never be compared. Refuse it.
  assert.equal(validateWorkerResult({ ...ok("repo", "x"), status: "blocked" }).valid, false);
});

test("a malformed worker result becomes a failure, never a routing decision", async () => {
  const box = workspace();
  const repo = fakeWorker("repo", (call) =>
    call === 0
      ? ok("repo", "inspect", { verifiedBoundariesAdded: ["repo.preflight"] })
      : { status: "nonsense" },
  );

  const { state } = await run(box, { repo });

  assert.equal(state.status, "failed");
  assert.equal(state.stopReason, "worker_failed");
  assert.match(state.history.at(-1).blocker.detail, /malformed result/);
});

test("an unreadable review can never become a PASS", () => {
  const result = resultFromReview({ outcome: "malformed_output", error: "no json block" });
  assert.equal(result.status, "blocked");
  assert.equal(result.terminal, true);
  assert.deepEqual(result.verifiedBoundariesAdded, []);
});

test("evidence is de-duplicated so a repeat cannot masquerade as progress", () => {
  const state = createTaskState({ task: LEGACY_TASK, taskFile: "t.json" });
  const entry = {
    worker: "repo",
    action: "implement",
    kind: "check",
    summary: "typecheck: NEW_FAILURE",
  };

  const first = addEvidence(state, [entry]);
  const second = addEvidence(state, [entry]);

  assert.equal(first.added.length, 1);
  assert.equal(second.added.length, 0, "identical evidence is not new evidence");
  assert.equal(state.evidence.length, 1);
});
