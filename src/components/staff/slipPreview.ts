// State machine for the in-dashboard payment-slip preview. Kept separate from
// the component for the same reason as proofReview.ts: the decisions that
// matter — whether a proof can be previewed at all, how Escape is routed when
// two layers are stacked, and the load/error/retry cycle — are then testable
// without a DOM runner.
//
// URL DISCIPLINE: the only source is the SHORT-LIVED SIGNED url the proof
// history endpoint mints per request. Nothing here builds, stores, or derives a
// URL, so no storage path, bucket name, or permanent link can appear.

/** The subset of a history item the preview needs. */
export interface PreviewableProof {
  proof_url: string | null;
  status: string;
}

export type PreviewPhase = "loading" | "ready" | "error";

export interface SlipPreviewState {
  /** The signed url handed to <img src>. Never rewritten (a query tweak would
   *  invalidate the signature). */
  url: string;
  /** pending | approved | rejected — shown in the modal header. */
  status: string;
  phase: PreviewPhase;
  /** Bumped by a retry to force the <img> to remount and refetch. */
  attempt: number;
}

/**
 * The state for opening a proof, or null when there is nothing to show. Any
 * proof WITH a signed url is previewable regardless of status — staff need to
 * look at approved and rejected slips, not just pending ones.
 */
export function openPreview(proof: PreviewableProof): SlipPreviewState | null {
  if (!proof.proof_url) return null;
  return { url: proof.proof_url, status: proof.status, phase: "loading", attempt: 0 };
}

export const markPreviewLoaded = (state: SlipPreviewState): SlipPreviewState => ({
  ...state,
  phase: "ready",
});

export const markPreviewFailed = (state: SlipPreviewState): SlipPreviewState => ({
  ...state,
  phase: "error",
});

/**
 * Retry after a failed load: same signed url, remount the image. The signature
 * may simply have expired, in which case reopening the drawer re-signs — the
 * error copy says so.
 */
export const retryPreview = (state: SlipPreviewState): SlipPreviewState => ({
  ...state,
  phase: "loading",
  attempt: state.attempt + 1,
});

/** Escape closes the preview. */
export const isDismissKey = (key: string): boolean => key === "Escape";

/**
 * Escape routing for the stacked layers. The preview sits ON TOP of the order
 * drawer, so while it is open Escape must close ONLY the preview — the drawer
 * stays mounted underneath, exactly as it does when the preview is closed by
 * its button or backdrop.
 */
export const drawerHandlesDismiss = (key: string, previewOpen: boolean): boolean =>
  isDismissKey(key) && !previewOpen;

export const previewHandlesDismiss = (key: string, previewOpen: boolean): boolean =>
  isDismissKey(key) && previewOpen;
