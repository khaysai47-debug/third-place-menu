import { useEffect, useRef, useState } from "react";
import { useCountUp } from "./useCountUp";

interface Props {
  count: number;
  /** Something in the cart is no longer orderable — the bar says so here
   *  rather than letting the customer find out at the last step. */
  hasSoldOut: boolean;
  onOpen: () => void;
}

/** ms the "Item added" acknowledgement holds before the bar settles back. */
const ADDED_MS = 1400;

/**
 * The approved red sticky cart bar, kept to a single row.
 *
 * It deliberately carries no running total: while browsing, a figure that
 * ticks up on every tap turns ordering into a spend counter. Per-item prices
 * stay on every card, and the full breakdown lives in the checkout sheet.
 * What this bar owes the customer is how many items are on the order and
 * that the tap registered.
 *
 * It stays mounted and slides out of frame when the cart empties, so arrival
 * and departure are both animated.
 */
export function CartTray({ count, hasSoldOut, onOpen }: Props) {
  const shown = count > 0;
  const animatedCount = useCountUp(count);

  // Acknowledge additions only. A decrement is the customer undoing
  // something they can already see, and does not need announcing.
  const [justAdded, setJustAdded] = useState(false);
  const previous = useRef(count);

  useEffect(() => {
    const grew = count > previous.current;
    previous.current = count;
    if (!grew) return;
    setJustAdded(true);
    const t = window.setTimeout(() => setJustAdded(false), ADDED_MS);
    return () => window.clearTimeout(t);
  }, [count]);

  const status = justAdded ? "Item added" : "Ready to review";

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[680px] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-[transform,opacity] duration-[420ms] ease-[var(--ease-drawer)] motion-reduce:transition-none ${
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-[140%] opacity-0"
      }`}
      aria-hidden={!shown}
    >
      <button
        onClick={onOpen}
        tabIndex={shown ? undefined : -1}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--color-vermillion-deep)] bg-[var(--color-vermillion)] px-4 py-3 text-[var(--color-cream)] shadow-[0_20px_40px_-18px_oklch(0.45_0.18_27/0.7)] transition-transform duration-150 ease-[var(--ease-fluid)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)]"
      >
        <span className="flex min-w-0 items-center gap-3">
          {/* Keyed on the tweened value, not the raw count, so the bump lands
              on the frame the digit actually changes. */}
          <span
            key={animatedCount}
            className="tp-num tp-bump flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-cream)]/15 text-[15px]"
          >
            {animatedCount}
          </span>
          {/* w-full on both lines is load-bearing: items-start sizes a child
              to its own content, so `truncate` would never engage and the
              status would run under the CTA at 375. */}
          <span className="flex min-w-0 flex-col items-start">
            <span className="w-full truncate text-[10px] uppercase leading-[1.4] tracking-[0.2em] opacity-80">
              Your order
            </span>
            {/* Keyed on the text so each swap re-enters instead of the label
                silently changing underneath the customer. */}
            {/* 11px / 0.04em is what lets "Ready to review" sit next to
                "View Cart →" at 375 without ellipsising. */}
            <span
              key={status}
              className="tp-rise-sm w-full truncate text-[11px] font-semibold uppercase leading-[1.35] tracking-[0.04em]"
            >
              {status}
            </span>
          </span>
        </span>
        <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold uppercase tracking-[0.12em]">
          {hasSoldOut ? "Remove sold-out" : "View Cart →"}
        </span>
      </button>
    </div>
  );
}
