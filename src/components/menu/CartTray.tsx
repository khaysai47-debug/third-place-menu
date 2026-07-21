import { ArrowRightIcon } from "./Icons";
import { useCountUp } from "./useCountUp";

interface Props {
  count: number;
  total: number;
  /** Something in the cart is no longer orderable — the tray says so here
   *  rather than letting the customer find out at the last step. */
  hasSoldOut: boolean;
  onOpen: () => void;
}

/**
 * The order tray. Replaces the tall sticky cart panel: quantities are edited
 * on the cards now, so all this has to do is state the order and open it.
 *
 * It stays mounted and slides out of frame when the cart empties, so the
 * arrival and the departure are both animated and the total can tween rather
 * than pop.
 */
export function CartTray({ count, total, hasSoldOut, onOpen }: Props) {
  const shown = count > 0;
  const animatedTotal = useCountUp(total);

  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[680px] px-4 pb-[max(0.875rem,env(safe-area-inset-bottom))] transition-[transform,opacity] duration-[420ms] ease-[var(--ease-drawer)] motion-reduce:transition-none ${
        shown ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-[140%] opacity-0"
      }`}
      aria-hidden={!shown}
    >
      {hasSoldOut && (
        <p className="tp-rise-sm mb-2 rounded-xl border border-[var(--color-vermillion)]/35 bg-[var(--color-lacquer-deep)]/90 px-3.5 py-2 text-center text-[11.5px] leading-relaxed text-[var(--color-vermillion-text)]">
          剛剛售罄 · An item just sold out. Open your order to remove it.
        </p>
      )}

      <button
        onClick={onOpen}
        tabIndex={shown ? undefined : -1}
        className="flex w-full items-center gap-3 rounded-[20px] border border-[var(--color-gold)]/25 bg-[var(--color-lacquer-deep)]/95 py-2.5 pl-3 pr-2.5 text-left shadow-[0_26px_50px_-20px_oklch(0_0_0/0.95)] transition-transform duration-200 ease-[var(--ease-fluid)] active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] supports-[backdrop-filter]:bg-[var(--color-lacquer-deep)]/80 supports-[backdrop-filter]:backdrop-blur-xl"
      >
        <span
          key={count}
          className="tp-num tp-bump flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-[var(--color-vermillion-deep)] bg-[var(--color-vermillion)] text-[16px] text-[var(--color-cream)]"
        >
          {count}
        </span>

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[10px] uppercase tracking-[0.24em] text-[var(--color-gold-soft)]/60">
            訂單 · Your order
          </span>
          <span className="tp-num mt-0.5 truncate text-[20px] leading-tight text-[var(--color-cream)]">
            ฿{animatedTotal.toLocaleString("en-US")}
          </span>
        </span>

        <span className="flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-[var(--color-vermillion)] px-4 text-[var(--color-cream)]">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em]">
            {hasSoldOut ? "Fix" : "Review"}
          </span>
          <ArrowRightIcon className="h-4 w-4" />
        </span>
      </button>
    </div>
  );
}
