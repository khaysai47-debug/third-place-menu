// The router: which worker acts next, and why.
//
// It answers one question — WHAT IS THE FIRST PROVEN FAILING BOUNDARY? — and
// hands that boundary to the worker that owns it. It never asks a worker to
// solve a problem in a system it has no capability for; when the owner of a
// boundary cannot act, the goal stops and says so. That is what keeps an n8n
// problem from turning into pressure on the repository rules.
//
// Every decision here is derived from STRUCTURED state: verified boundaries,
// the current blocker's boundary and kind, attempt counters. No prose is parsed.
import { reviewRequired } from "./workers/codex.mjs";
import { ownerOf } from "./workers/contract.mjs";
import { workerExhausted } from "./progress.mjs";
import { allCriteriaVerified, manualCriteria } from "./taskstate.mjs";
import { DEFAULT_BUDGET } from "./schemas.mjs";

/** The Class A action each worker takes when it is handed a blocker. */
const DEFAULT_ACTION = {
  // Inspect before modify: an external blocker is investigated, never patched
  // on a hunch.
  n8n: "inspect_execution",
  vercel: "inspect_deployments",
  codex: "review",
};

/** The read-only action that proves a given external boundary. */
const BOUNDARY_ACTION = {
  "n8n.workflow": "inspect_workflow",
  "n8n.execution": "inspect_execution",
  "vercel.deployment": "inspect_deployments",
  "vercel.config": "inspect_config",
};

/** Workers whose boundaries live outside this repository. */
const EXTERNAL_WORKERS = new Set(["n8n", "vercel"]);

const act = (worker, action, status, reason, args) => ({
  worker,
  action,
  status,
  reason,
  ...(args === undefined ? {} : { args }),
});
const halt = (status, stopReason, reason, nextAction = null) => ({
  worker: null,
  stop: { status, stopReason, reason, nextAction },
});

/** The read-only repository preflight — the gate in front of all repo work. */
const preflight = () =>
  act("repo", "inspect", "investigating", "no read-only preflight has been done yet");

/**
 * Choose the next step.
 *
 * ORDER MATTERS, and it is this:
 *
 *   blocker → review → criteria proven → external reads → repository work
 *
 * The repository preflight gates REPOSITORY WORK, not the goal. A goal that
 * only has to read an n8n workflow touches no working tree, so the state of
 * that tree is none of its business; the moment the repo worker is asked to do
 * anything at all, the full preflight runs first exactly as it always did.
 *
 * "Every criterion is proven" is answered BEFORE the implement fallback, so an
 * inspection-only goal completes instead of falling through into a repository
 * change nobody asked for.
 *
 * @param {object} state    orchestration state
 * @param {object} context  { task, workers, policy, budget }
 * @returns {{worker, action, status, reason} | {worker: null, stop: {...}}}
 */
export function routeNext(state, { task, workers = {}, policy, budget = DEFAULT_BUDGET } = {}) {
  const verified = new Set(state.verifiedBoundaries);

  // 1. A proven blocker outranks everything: it IS the first failing boundary.
  const blocker = state.currentBlocker;
  if (blocker) {
    const worker = blocker.suggestedNextWorker ?? ownerOf(blocker.boundary);
    if (!worker) {
      return halt(
        "escalated",
        "no_owner_for_boundary",
        `no worker owns ${blocker.boundary} — a human decides this one`,
        `resolve ${blocker.boundary}: ${blocker.detail ?? ""}`,
      );
    }
    if (!workers[worker]) {
      return halt(
        "escalated",
        "worker_unavailable",
        `${blocker.boundary} belongs to the ${worker} worker, which is not configured`,
        `wire up the ${worker} worker, or resolve ${blocker.boundary} by hand`,
      );
    }
    if (workerExhausted(state, worker, budget)) {
      return halt(
        "escalated",
        "worker_attempt_budget_exhausted",
        `the ${worker} worker has spent its attempt budget on this goal`,
        `review the ${worker} evidence and decide`,
      );
    }
    // OBSERVE FIRST, where observing is what protects something: the repo
    // worker does nothing until a read-only preflight has proven what the
    // working tree actually looks like right now.
    if (worker === "repo" && !verified.has("repo.preflight")) return preflight();

    const action = blocker.suggestedAction ?? actionFor(worker, state, blocker.boundary);
    return act(
      worker,
      action,
      worker === "repo" ? "implementing" : "investigating",
      `first failing boundary is ${blocker.boundary} (${blocker.kind}), owned by ${worker}`,
      externalArgs(task, worker, blocker),
    );
  }

  // 2. A change sitting in the worktree gets its independent review before
  //    anything is allowed to call the goal proven. (The engine reviews its own
  //    rounds; this catches a change that arrived some other way.)
  const files = state.activeRun?.filesChanged ?? [];
  const review = reviewRequired({ filesChanged: files, task, policy });
  if (review.required && !verified.has("review.codex")) {
    if (!workers.codex) {
      return halt(
        "escalated",
        "worker_unavailable",
        "a review is required but no reviewer is configured",
      );
    }
    return act("codex", "review", "validating", `review required — ${review.reason}`);
  }

  // 3. Proven is proven. Nothing is implemented to satisfy a goal that is
  //    already satisfied.
  if (allCriteriaVerified(state)) {
    return halt("completed", "all_criteria_verified", "every success criterion is proven");
  }

  // 4. An unproven criterion belonging to an EXTERNAL system is read before any
  //    repository work begins: that read needs no worktree, no clean tree and
  //    no repo preflight, and it may well be the entire goal.
  const pending = pendingExternalBoundary(state, verified);
  if (pending) {
    if (!workers[pending.worker]) {
      return halt(
        "escalated",
        "worker_unavailable",
        `${pending.boundary} belongs to the ${pending.worker} worker, which is not configured`,
        `wire up the ${pending.worker} worker, or verify ${pending.boundary} by hand`,
      );
    }
    if (workerExhausted(state, pending.worker, budget)) {
      return halt(
        "escalated",
        "worker_attempt_budget_exhausted",
        `the ${pending.worker} worker has spent its attempt budget on this goal`,
        `review the ${pending.worker} evidence and decide`,
      );
    }
    return act(
      pending.worker,
      actionFor(pending.worker, state, pending.boundary),
      "investigating",
      `criterion boundary ${pending.boundary} is unproven and owned by ${pending.worker}`,
      externalArgs(task, pending.worker, null),
    );
  }

  // 5. Repository work. Preflight first, always, exactly as before.
  if (!verified.has("repo.preflight")) return preflight();
  if (!state.activeRun) {
    if (workerExhausted(state, "repo", budget)) {
      return halt(
        "escalated",
        "worker_attempt_budget_exhausted",
        "the repo worker is out of attempts",
      );
    }
    return act(
      "repo",
      "implement",
      "implementing",
      "preflight is clean and nothing is implemented yet",
    );
  }

  // 6. Controlled verification. Compiling is not succeeding.
  const manual = manualCriteria(state);
  if (manual.length > 0) {
    return halt(
      "paused",
      "manual_verification_required",
      `${manual.length} criterion/criteria cannot be proven by this agent`,
      `a human verifies: ${manual.map((c) => c.id).join(", ")} — then \`agent:verify\``,
    );
  }
  const unproven = state.successCriteria.filter((c) => c.status !== "verified");
  return halt(
    "escalated",
    "criteria_unproven",
    `work finished but ${unproven.length} criterion/criteria are still unproven: ${unproven
      .map((c) => c.id)
      .join(", ")}`,
  );
}

/**
 * The first unproven criterion whose boundary belongs to an external system.
 *
 * A criterion with no automatic verifier is a human's job and is never routed;
 * this only ever picks a boundary a connector can actually prove.
 */
function pendingExternalBoundary(state, verified) {
  for (const criterion of state.successCriteria ?? []) {
    if (criterion.status === "verified" || !criterion.verifiedBy) continue;
    if (verified.has(criterion.verifiedBy)) continue;
    const worker = ownerOf(criterion.verifiedBy);
    if (EXTERNAL_WORKERS.has(worker)) return { worker, boundary: criterion.verifiedBy };
  }
  return null;
}

/**
 * The repo worker RESUMES whenever a run already exists. Creating a second
 * worktree for the same goal is how work gets abandoned; there is exactly one
 * per task, and it is continued.
 */
function actionFor(worker, state, boundary = null) {
  if (worker === "repo") return state.activeRun ? "resume_implement" : "implement";
  return BOUNDARY_ACTION[boundary] ?? DEFAULT_ACTION[worker] ?? "inspect";
}

/**
 * External targets are public task data, never connector credentials. A
 * blocker may add public per-attempt arguments (for example an executionId),
 * while the task remains the source of the stable system target.
 */
function externalArgs(task, worker, blocker) {
  if (!EXTERNAL_WORKERS.has(worker)) return undefined;
  const target = task?.systemTargets?.[worker];
  const attempt = blocker?.args;
  return {
    ...(target && typeof target === "object" && !Array.isArray(target) ? target : {}),
    ...(attempt && typeof attempt === "object" && !Array.isArray(attempt) ? attempt : {}),
  };
}
