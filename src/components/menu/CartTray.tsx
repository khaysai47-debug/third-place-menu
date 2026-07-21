import { useCountUp } from "./useCountUp";

interface Props {
  count: number;
  total: number;
  /** Something in the cart is no longer orderable — the bar says so here
   *  rather than letting the customer find out at the last step. */
  hasSoldOut: boolean;
  onOpen: () => void;
}

/**
 * The approved red sticky cart bar, kept to a single row.
 *
 * Quantities are edited on the cards now, so this no longer needs to carry
 * the item list and its steppers — it states the order and opens it. It
 * stays mounted and slides out of frame when the cart empties, so arrival
 * and departure are both animated and the total can tween rather than pop.
 */
export function CartTray({ count, total, hasSoldOut, onOpen }: Props) {
  const shown = count > 0;
  const animatedTotal = useCountUp(total);

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
          <span
            key={count}
            className="tp-num tp-bump flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-cream)]/15 text-[15px]"
          >
            {count}
          </span>
          <span className="flex min-w-0 flex-col items-start">
            <span className="truncate whitespace-nowrap text-[11px] uppercase leading-[1.4] tracking-[0.2em] opacity-80">
              訂單 · Your order
            </span>
            <span className="tp-num text-[17px] leading-[1.3]">
              ฿{animatedTotal.toLocaleString("en-US")}
            </span>
          </span>
        </span>
        <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold uppercase tracking-[0.18em]">
          {hasSoldOut ? "Remove sold-out" : "View Cart →"}
        </span>
      </button>
    </div>
  );
}
