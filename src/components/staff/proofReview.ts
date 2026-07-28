// Presentation-free rules for the staff payment-proof review UI. Extracted
// from OrderDetailDrawer so the decisions that matter (which reason string
// actually reaches the API, when Confirm may be pressed, which controls a proof
// state may show) are testable without a DOM — same idea as orderStatus.ts
// holding the status vocabulary for the board.
//
// NOTHING HERE TOUCHES THE BACKEND CONTRACT: the review call still sends one
// plain English `reason` string, exactly as before. The presets only stop staff
// from typing it by hand.

/** One preset rejection reason. `reason` is the value SENT to the API. */
export interface ProofRejectReason {
  /** English string stored in payment_proofs.rejection_reason. */
  reason: string;
  /** Chinese label shown first, matching the rest of the staff UI. */
  zh: string;
}

/** The preset that opens the free-text field instead of being sent verbatim. */
export const OTHER_REASON = "Other";

/**
 * The fixed reason list, in tap order. Same shape and intent as CANCEL_REASONS
 * in OrderDetailDrawer: the common cases are one tap, "Other" stays available
 * for the rest. Changing a `reason` string changes what is stored, so treat
 * these as vocabulary, not copy.
 */
export const PROOF_REJECT_REASONS: readonly ProofRejectReason[] = [
  { reason: "Wrong amount", zh: "金額錯誤" },
  { reason: "Unclear image", zh: "圖片不清" },
  { reason: "Wrong slip", zh: "收據錯誤" },
  { reason: "Duplicate slip", zh: "重複收據" },
  { reason: "Payment not received", zh: "未收到付款" },
  { reason: OTHER_REASON, zh: "其他" },
];

/**
 * The reason string to send, or null when the form is not submittable.
 *
 * A preset other than "Other" is sent verbatim. "Other" sends the trimmed
 * custom text and is submittable only when that text is non-empty — so the
 * literal word "Other" is never stored, and neither is a whitespace-only
 * reason (the server requires a non-blank reason and would refuse it anyway).
 */
export function resolveRejectionReason(preset: string, customText: string): string | null {
  if (!preset) return null;
  if (preset !== OTHER_REASON) return preset;
  const custom = customText.trim();
  return custom === "" ? null : custom;
}

/** Whether "Confirm Reject" may be pressed. */
export const canSubmitRejection = (preset: string, customText: string): boolean =>
  resolveRejectionReason(preset, customText) !== null;

/** Whether the free-text field should be shown at all. */
export const needsCustomReason = (preset: string): boolean => preset === OTHER_REASON;

/**
 * Newest attempt first. The history API returns oldest → newest (stable
 * created_at order); staff read the latest slip first, and earlier attempts
 * stay visible below it — a rejected proof is never hidden by a newer pending
 * one, which is the audit trail staff rely on.
 */
export function newestProofsFirst<T>(proofs: readonly T[]): T[] {
  return [...proofs].reverse();
}

/** What the review section may offer for the CURRENT proof state. */
export interface ProofReviewControls {
  /** Approve / Reject may be shown — a pending proof with a reviewable id. */
  canReview: boolean;
  /** Show "waiting for the customer to send another slip". */
  awaitingNewSlip: boolean;
}

/**
 * Review controls belong to a PENDING proof only. A rejected proof shows the
 * waiting-for-customer state instead (while the order is still unpaid) —
 * re-deciding a finished proof is refused by the RPC anyway, so offering the
 * buttons would only produce a 409.
 */
export function proofReviewControls(proof: {
  hasPaymentProof?: boolean;
  paymentProofId?: string;
  paymentProofStatus?: string;
  paymentStatus?: string;
}): ProofReviewControls {
  const present = proof.hasPaymentProof === true;
  return {
    canReview: present && proof.paymentProofStatus === "pending" && !!proof.paymentProofId,
    awaitingNewSlip:
      present && proof.paymentProofStatus === "rejected" && proof.paymentStatus !== "paid",
  };
}
