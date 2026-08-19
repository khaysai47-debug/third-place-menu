// The worker contract.
//
// A worker owns CAPABILITIES. It does not own the goal — the orchestrator does.
// Every worker answers in the same structured shape, so routing is a lookup
// rather than an exercise in reading model prose:
//
//   { worker, action, status, changed, evidence, verifiedBoundariesAdded,
//     blocker, failureFingerprint, suggestedNextWorker, requiresApproval,
//     terminal, resumable, data }
//
// PERMISSIONS BELONG HERE, NOT IN THE PROMPT.
//
//   The repo worker has no n8n capability. Not "is asked not to use one" — it
//   does not have one, so an n8n problem cannot be solved by telling the repo
//   worker to try harder, and AGENTS.md never has to be weakened to let it. The
//   orchestrator routes the problem to the worker that owns that system, or it
//   stops and says so.
import { actionClassOf, ACTION_CLASS_LABELS } from "../schemas.mjs";
import { buildActionRequest, verifyActionApproval } from "../action-approval.mjs";
import { redact } from "../redact.mjs";
import { failureFingerprint } from "../progress.mjs";

/**
 * Boundaries, named `<system>.<stage>`. The FIRST unproven one is what the
 * router acts on — "inspect before modify" expressed as a data structure.
 */
export const BOUNDARIES = {
  repoPreflight: "repo.preflight",
  repoImplementation: "repo.implementation",
  repoChecks: "repo.checks",
  repoScope: "repo.scope",
  review: "review.codex",
  n8nWorkflow: "n8n.workflow",
  n8nExecution: "n8n.execution",
  vercelDeployment: "vercel.deployment",
  vercelConfig: "vercel.config",
  productVerification: "product.verification",
};

/** Which worker FIXES a boundary. Not which one reported it. */
export const BOUNDARY_OWNER = {
  "repo.preflight": "repo",
  "repo.implementation": "repo",
  "repo.checks": "repo",
  "repo.scope": null, // a scope breach is a human decision, never a retry
  "review.codex": "codex",
  // A reviewer finding is fixed by the implementer, not by the reviewer.
  "review.findings": "repo",
  "n8n.workflow": "n8n",
  "n8n.execution": "n8n",
  "vercel.deployment": "vercel",
  "vercel.config": "vercel",
  "product.verification": null, // proven by a human, or not proven at all
};

export const ownerOf = (boundary) =>
  boundary in BOUNDARY_OWNER ? BOUNDARY_OWNER[boundary] : (boundary?.split(".")[0] ?? null);

/* ── Result builders ─────────────────────────────────────────────────────── */

const baseResult = (worker, action) => ({
  worker,
  action,
  status: "success",
  changed: false,
  evidence: [],
  verifiedBoundariesAdded: [],
  blocker: null,
  failureFingerprint: null,
  suggestedNextWorker: null,
  requiresApproval: null,
  // `terminal` means no worker can retry this; the orchestrator escalates.
  terminal: false,
  // `resumable` means the same worker can pick up exactly where it stopped.
  resumable: false,
  data: null,
});

/** One evidence entry. Summaries are scrubbed; payloads are scrubbed on write. */
export const evidence = ({ worker, action, kind, summary, ref = null, payload = null }) => ({
  worker,
  action,
  kind,
  summary: redact(String(summary)),
  ref,
  payload,
});

export function ok(worker, action, extra = {}) {
  return { ...baseResult(worker, action), status: "success", ...extra };
}

/** A real boundary is in the way. Carries the fingerprint the loop compares. */
export function blocked(worker, action, blocker, extra = {}) {
  const scrubbed = { ...blocker, detail: redact(String(blocker.detail ?? "")) };
  return {
    ...baseResult(worker, action),
    status: "blocked",
    blocker: scrubbed,
    failureFingerprint: failureFingerprint(scrubbed),
    suggestedNextWorker: extra.suggestedNextWorker ?? ownerOf(scrubbed.boundary),
    ...extra,
  };
}

/** Resumable interruption. NOT a failure, and never a discarded worktree. */
export function paused(worker, action, blocker, extra = {}) {
  const scrubbed = { ...blocker, detail: redact(String(blocker.detail ?? "")) };
  return {
    ...baseResult(worker, action),
    status: "paused",
    blocker: scrubbed,
    failureFingerprint: failureFingerprint(scrubbed),
    resumable: true,
    ...extra,
  };
}

/**
 * A Class B or C action, described but NOT performed. The orchestrator queues
 * it and stops; a human decides. There is no code path that executes one.
 */
export function requiresApproval(
  worker,
  action,
  { actionClass, reason, detail, request = null, approvalStatus = null, ...extra } = {},
) {
  return {
    ...baseResult(worker, action),
    status: "requires_approval",
    requiresApproval: {
      worker,
      action,
      actionClass,
      classLabel: ACTION_CLASS_LABELS[actionClass],
      reason: redact(String(reason ?? "")),
      detail: redact(String(detail ?? "")),
      request,
      approvalStatus,
    },
    ...extra,
  };
}

/**
 * No connector is wired for this capability.
 *
 * Deliberately its own status rather than a failure or a fake success: an agent
 * that reports "n8n workflow inspected" with no n8n connection is worse than one
 * that cannot inspect at all.
 */
export function notAvailable(worker, action, detail, extra = {}) {
  return {
    ...baseResult(worker, action),
    status: "not_available",
    blocker: { boundary: `${worker}.connector`, kind: "connector_missing", detail: redact(detail) },
    ...extra,
  };
}

/** The worker has no such capability, or the task never granted its permission. */
export function notPermitted(worker, action, detail, extra = {}) {
  return {
    ...baseResult(worker, action),
    status: "not_permitted",
    blocker: {
      boundary: `${worker}.permission`,
      kind: "not_permitted",
      detail: redact(detail),
    },
    terminal: true,
    ...extra,
  };
}

export function failed(worker, action, detail, extra = {}) {
  return {
    ...baseResult(worker, action),
    status: "failed",
    blocker: { boundary: `${worker}.worker`, kind: "worker_error", detail: redact(detail) },
    ...extra,
  };
}

/* ── The gate every worker runs before acting ────────────────────────────── */

/**
 * Refuse anything a worker must not do, before it does it.
 *
 * Three refusals, in order:
 *   1. the worker has no such capability          → not_permitted
 *   2. the task never granted the permission it   → not_permitted
 *      needs (only for capabilities that require
 *      an explicit grant, which is every external
 *      system read; local Tier-1 work is granted
 *      by approval exactly as in V1)
 *   3. the capability is Class B or C             → requires_approval, unperformed
 *
 * @returns {?object} a WorkerResult to return immediately, or null to proceed
 */
export function guard({ worker, action, task, capabilities, args = {}, actionApprovalDir = null }) {
  const capability = capabilities[action];
  if (!capability) {
    const owner = ownerOf(capability?.boundary) ?? "another worker";
    return notPermitted(
      worker,
      action,
      `the ${worker} worker has no "${action}" capability — this belongs to ${owner}`,
      { suggestedNextWorker: null },
    );
  }

  const granted = Array.isArray(task?.permissions) ? task.permissions : [];
  if (capability.requiresGrant && !granted.includes(capability.permission)) {
    return notPermitted(
      worker,
      action,
      `task ${task?.taskId} does not grant "${capability.permission}", which "${action}" requires`,
    );
  }

  const actionClass = actionClassOf(capability);
  if (actionClass !== "A") {
    const request = buildActionRequest({
      task,
      worker,
      action,
      actionClass,
      permission: capability.permission,
      target: args.target ?? null,
      artifact: args.artifact ?? null,
    });
    const approval = actionApprovalDir
      ? verifyActionApproval({ request, dir: actionApprovalDir })
      : { status: "ACTION_APPROVAL_MISSING" };
    if (approval.status === "ACTION_APPROVED") return null;
    return requiresApproval(worker, action, {
      actionClass,
      reason: capability.summary ?? action,
      request,
      approvalStatus: approval.status,
      detail:
        `${worker}.${action} is Class ${actionClass} — ${ACTION_CLASS_LABELS[actionClass]}. ` +
        `Immutable action ${request.actionHash} needs its own receipt; performed nothing.`,
    });
  }

  return null;
}

/** Every capability of a worker, with its class. Used by `status` and reports. */
export const describeCapabilities = (capabilities) =>
  Object.entries(capabilities).map(([action, capability]) => ({
    action,
    actionClass: actionClassOf(capability),
    permission: capability.permission ?? null,
    summary: capability.summary ?? "",
  }));
