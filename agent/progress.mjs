// The progress rule: when may the orchestrator try again, and when is trying
// again just spending money to reach the same wrong place?
//
// V1 asked a simpler question — "have I used my two revision rounds?" — and it
// was the wrong question in both directions. Two rounds is not enough for a real
// multi-system bug, and two rounds of the SAME failure is already one too many.
//
// The rule here is about movement, not counting:
//
//   different blocker            → continue (the first failing boundary moved)
//   same blocker, new evidence   → continue (we know something we did not)
//   same blocker, nothing new    → escalate (a third guess is still a guess)
//
// with a hard total-step ceiling behind all of it so a loop that keeps producing
// novel evidence about the same wall still terminates.
import { DEFAULT_BUDGET } from "./schemas.mjs";

/**
 * A normalized identity for a failure, so "the same failure" is a comparison
 * rather than a judgement.
 *
 * Volatile parts — line numbers, counts, durations, hashes, absolute paths — are
 * flattened, because a type error that moves from line 12 to line 14 is the same
 * type error and must not read as progress.
 */
export function failureFingerprint(blocker) {
  if (!blocker || !blocker.boundary) return null;
  const detail = String(blocker.detail ?? "")
    .toLowerCase()
    .replace(/[a-z]:[\\/][^\s"',]+/g, "<path>")
    .replace(/[\w.-]*[\\/][\w.\-\\/]+/g, "<path>")
    .replace(/\b[0-9a-f]{7,}\b/g, "<hash>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return `${blocker.boundary}|${blocker.kind ?? "unknown"}|${detail}`;
}

/**
 * Decide whether the loop continues after a worker step.
 *
 * Pure and free of state objects on purpose: every branch below is one assert in
 * the test suite, and none of them needs a repository, a worktree or a model.
 *
 * @param {object}  input
 * @param {object}  input.result              structured worker result
 * @param {?string} input.previousFingerprint fingerprint of the last blocker
 * @param {number}  input.sameFailureCount    consecutive sightings, no new evidence
 * @param {number}  input.newEvidenceCount    evidence entries this step that were new
 * @param {number}  input.totalSteps          steps taken INCLUDING this one
 * @returns {{ continue: boolean, status?: string, stopReason?: string, reason: string,
 *             fingerprint: ?string, sameFailureCount: number, progressed: boolean,
 *             newEvidence: boolean }}
 */
export function evaluateProgress({
  result,
  previousFingerprint = null,
  sameFailureCount = 0,
  newEvidenceCount = 0,
  totalSteps = 1,
  budget = DEFAULT_BUDGET,
}) {
  const limits = { ...DEFAULT_BUDGET, ...budget };
  const fingerprint = result.failureFingerprint ?? failureFingerprint(result.blocker);
  const progressed = (result.verifiedBoundariesAdded ?? []).length > 0;
  const newEvidence = newEvidenceCount > 0;
  const base = { fingerprint, progressed, newEvidence, sameFailureCount };
  const halt = (status, stopReason, reason) => ({
    ...base,
    continue: false,
    status,
    stopReason,
    reason,
  });

  // Outcomes that are not about progress at all. Checked first: a step that
  // needs a human, or that could not run, must never be read as a failed
  // attempt and burn the failure budget.
  switch (result.status) {
    case "requires_approval":
      return halt(
        "waiting_for_approval",
        "approval_required",
        `${result.worker} needs approval for ${result.requiresApproval?.action ?? result.action}`,
      );
    case "paused":
      return halt(
        "paused",
        result.blocker?.kind ?? "interrupted",
        `${result.worker} paused: ${result.blocker?.detail ?? "resumable interruption"}`,
      );
    case "not_permitted":
      return halt(
        "escalated",
        "permission_boundary",
        `${result.worker} may not perform ${result.action} — this needs the owning worker or a human`,
      );
    case "not_available":
      return halt(
        "escalated",
        "connector_unavailable",
        `${result.worker} has no connector for ${result.action}`,
      );
    case "failed":
      return halt("failed", "worker_failed", `${result.worker} failed: ${result.blocker?.detail}`);
    default:
      break;
  }

  // A boundary breach or an unreadable review is not iterated on, at any budget.
  if (result.terminal) {
    return halt(
      "escalated",
      result.blocker?.kind ?? "terminal_blocker",
      `${result.worker}: ${result.blocker?.detail ?? "cannot be retried"}`,
    );
  }

  if (totalSteps >= limits.maxTotalSteps) {
    return halt(
      "escalated",
      "step_budget_exhausted",
      `step budget spent (${totalSteps}/${limits.maxTotalSteps})`,
    );
  }

  if (result.status === "success" && !result.blocker) {
    return { ...base, sameFailureCount: 0, continue: true, reason: "step succeeded" };
  }

  // Blocked. The three-way movement test.
  if (fingerprint !== previousFingerprint) {
    return { ...base, sameFailureCount: 1, continue: true, reason: "the blocker changed" };
  }
  if (progressed || newEvidence) {
    return {
      ...base,
      sameFailureCount: 1,
      continue: true,
      reason: progressed ? "a boundary was verified" : "new evidence was produced",
    };
  }

  const repeats = sameFailureCount + 1;
  if (repeats >= limits.maxSameFailureWithoutNewEvidence) {
    return {
      ...base,
      sameFailureCount: repeats,
      continue: false,
      status: "escalated",
      stopReason: "repeated_failure_without_new_evidence",
      reason: `the same failure ${repeats}× with nothing new learned: ${result.blocker?.detail ?? fingerprint}`,
    };
  }
  return {
    ...base,
    sameFailureCount: repeats,
    continue: true,
    reason: "same blocker, one more attempt within budget",
  };
}

/** Has this worker spent its attempt budget? */
export const workerExhausted = (state, worker, budget = DEFAULT_BUDGET) =>
  (state.attempts?.byWorker?.[worker] ?? 0) >=
  { ...DEFAULT_BUDGET, ...budget }.maxPerWorkerAttempts;
