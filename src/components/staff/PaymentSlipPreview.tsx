import { useEffect, useRef } from "react";
import { ExternalLink, X } from "lucide-react";

import {
  markPreviewFailed,
  markPreviewLoaded,
  previewHandlesDismiss,
  retryPreview,
  type SlipPreviewState,
} from "./slipPreview";

// The in-dashboard payment-slip preview. Staff stay on the board: this opens
// OVER the order drawer, which remains mounted underneath, so closing the
// preview returns them exactly where they were mid-review.
//
// The image source is the SHORT-LIVED SIGNED url from /api/staff/proof-history,
// passed in already resolved. This component never builds a URL, so no storage
// path, bucket name, or permanent link can leak through it.

interface Props {
  state: SlipPreviewState;
  onChange: (next: SlipPreviewState) => void;
  onClose: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "待審核 Pending",
  approved: "已核准 Approved",
  rejected: "已拒絕 Rejected",
};

const STATUS_TONE: Record<string, string> = {
  pending: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  approved: "border-emerald-600/40 bg-emerald-500/10 text-emerald-300",
  rejected:
    "border-[var(--color-vermillion)]/40 bg-[var(--color-vermillion)]/10 text-[var(--color-vermillion-text)]",
};

export function PaymentSlipPreview({ state, onChange, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus moves INTO the dialog on open; OrderDetailDrawer restores focus to
  // the originating "View slip" button when this unmounts.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // Escape closes the preview only. The drawer's own Escape handler stands down
  // while this is open (see drawerHandlesDismiss), so one press peels off one
  // layer instead of dismissing both.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (previewHandlesDismiss(e.key, true)) {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // No background scrolling behind the preview. The previous value is restored
  // rather than assumed empty — the drawer underneath may have set it too.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const tone = STATUS_TONE[state.status] ?? STATUS_TONE.pending;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop — a click anywhere outside the panel closes the preview. */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        data-testid="slip-preview-backdrop"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="slip-preview-title"
        // Small screens ~90vw/78vh; from sm up it stays a panel, never a
        // full-screen takeover on an iPad.
        className="relative flex max-h-[78vh] w-[90vw] flex-col overflow-hidden rounded-2xl border border-[var(--color-gold)]/20 bg-[var(--color-charcoal-soft)] shadow-[0_24px_60px_-20px_oklch(0_0_0/0.8)] sm:max-h-[68vh] sm:w-[min(60vw,520px)]"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-gold)]/15 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <h2
              id="slip-preview-title"
              className="truncate text-[13px] font-medium tracking-[0.04em] text-[var(--color-cream)]/85"
            >
              Payment slip · 付款收據
            </h2>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] font-medium ${tone}`}
            >
              {STATUS_LABEL[state.status] ?? state.status}
            </span>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close payment slip preview"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--color-gold)]/20 text-[var(--color-cream)]/70 transition hover:border-[var(--color-gold)]/40 hover:text-[var(--color-cream)]"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        {/* Image area: contain, centered, never cropped. Vertical scroll only
            if the rendered image genuinely exceeds the panel. */}
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-x-hidden overflow-y-auto bg-[var(--color-ink)]/50 p-3">
          {state.phase === "error" ? (
            <div className="px-4 py-6 text-center">
              <p className="text-[13px] text-[var(--color-cream)]/70">
                收據載入失敗 · Couldn&apos;t load this slip
              </p>
              <p className="mt-1 text-[12px] text-[var(--color-cream)]/45">
                The preview link may have expired. Retry, or close and reopen the order to get a
                fresh one.
              </p>
              <button
                onClick={() => onChange(retryPreview(state))}
                className="mt-3 inline-flex h-11 items-center justify-center rounded-xl border border-[var(--color-gold)]/30 px-5 text-[13px] font-semibold text-[var(--color-cream)]/80 transition hover:border-[var(--color-gold)]/50 hover:text-[var(--color-cream)]"
              >
                重試 · Retry
              </button>
            </div>
          ) : (
            <>
              {state.phase === "loading" && (
                <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[12.5px] text-[var(--color-cream)]/45">
                  載入中 · Loading slip…
                </p>
              )}
              <img
                // Remounting on retry re-requests the same signed url; the url
                // itself is never rewritten (that would break the signature).
                key={state.attempt}
                src={state.url}
                alt="Customer payment slip"
                onLoad={() => onChange(markPreviewLoaded(state))}
                onError={() => onChange(markPreviewFailed(state))}
                className={`mx-auto h-auto max-w-full object-contain transition-opacity ${
                  state.phase === "ready" ? "opacity-100" : "opacity-0"
                }`}
              />
            </>
          )}
        </div>

        {/* Optional escape hatch for a slip that is hard to read at this size.
            The MAIN action is this modal; only here do we hand off to a tab. */}
        <div className="flex shrink-0 justify-end border-t border-[var(--color-gold)]/15 px-4 py-2">
          <a
            href={state.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-1.5 rounded-xl px-3 text-[12.5px] font-medium text-teal-300/85 transition hover:text-teal-200"
          >
            <ExternalLink size={13} strokeWidth={1.75} />
            原圖 · Open full size
          </a>
        </div>
      </div>
    </div>
  );
}
