import { buildActionReceipt, writeActionReceipt } from "./action-approval.mjs";

/** Approve one already-queued immutable action request. No connector is called. */
export function approvePendingAction({ state, action, actionHash, approvedBy, dir }) {
  if (!approvedBy || !String(approvedBy).trim()) {
    return { ok: false, status: "APPROVER_MISSING", detail: "--by is required" };
  }
  const matches = (state?.approvalsPending ?? []).filter((pending) => {
    if (actionHash && pending.request?.actionHash !== actionHash) return false;
    if (action && `${pending.worker}.${pending.action}` !== action) return false;
    return true;
  });
  if (matches.length !== 1) {
    return {
      ok: false,
      status: "ACTION_NOT_FOUND",
      detail:
        matches.length === 0
          ? "no pending action matches"
          : "multiple actions match; pass --action-hash",
    };
  }
  const pending = matches[0];
  if (!pending.request?.actionHash || !["B", "C"].includes(pending.actionClass)) {
    return {
      ok: false,
      status: "ACTION_INVALID",
      detail: "pending action has no immutable Class B/C request",
    };
  }
  const receipt = buildActionReceipt({
    request: pending.request,
    approvedBy: String(approvedBy).trim(),
  });
  const receiptFile = writeActionReceipt(receipt, dir);
  return { ok: true, status: "ACTION_APPROVED", receipt, receiptFile, pending };
}
