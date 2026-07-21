import { useEffect, useRef, useState, type ReactNode } from "react";

interface CartItem {
  id: string;
  name: string;
  qty: number;
  subtotal: number;
  /** Item is no longer orderable (sold out / hidden) — blocks checkout. */
  soldOut?: boolean;
}

interface Props {
  items: CartItem[];
  onIncrease: (id: string) => void;
  onDecrease: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  onCheckout: () => void;
}

/** ms the "Tap again to clear" confirmation stays armed before resetting. */
const CLEAR_CONFIRM_MS = 3000;

/* Touch-target note (applies to every `before:` block in this file):
   the visible circle stays 24px so the compact preview is unchanged, while an
   absolutely-positioned transparent ::before extends the hit area to 44x44.
   Because ::before is out of flow it adds no layout height, so rows stay 24px.
   Geometry is chosen so hit areas tile without ever overlapping:
     vertical   — 24px row + `space-y-5` (20px) = 44px pitch = exactly the hit
                  height, so adjacent rows touch but never overlap.
     horizontal — `gap-2` puts the -/+ centres 56px apart, 12px of clearance. */
function QtyButton({
  onClick,
  children,
  label,
}: {
  onClick: () => void;
  children: ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="relative h-6 w-6 rounded-full bg-[var(--color-cream)]/10 text-[var(--color-cream)] flex items-center justify-center text-[14px] leading-none hover:bg-[var(--color-cream)]/20 active:scale-90 transition-[transform,background-color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] before:absolute before:-inset-2.5 before:content-['']"
    >
      {children}
    </button>
  );
}

export function CartBar({ items, onIncrease, onDecrease, onRemove, onClear, onCheckout }: Props) {
  // Two-step clear: the first tap arms the confirmation, a second tap within
  // CLEAR_CONFIRM_MS clears. Anything slower disarms it again.
  const [confirmClear, setConfirmClear] = useState(false);
  const clearTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
    },
    [],
  );

  const handleClear = () => {
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
    if (confirmClear) {
      clearTimer.current = null;
      setConfirmClear(false);
      onClear();
      return;
    }
    setConfirmClear(true);
    clearTimer.current = window.setTimeout(() => {
      clearTimer.current = null;
      setConfirmClear(false);
    }, CLEAR_CONFIRM_MS);
  };

  const count = items.reduce((s, i) => s + i.qty, 0);
  const hasSoldOut = items.some((i) => i.soldOut);

  if (count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 pointer-events-none">
      <div className="mx-auto max-w-[680px] px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto mb-2 rounded-2xl bg-[var(--color-ink)] border border-[var(--color-gold)]/20 px-4 pt-3 pb-2">
          {/* The scroller clips anything outside its padding box, and each
              ::before hit area extends 10px past its button on every side, so
              the padding here is load-bearing: without py-2.5 the first and
              last rows lose 10px of tap height, and without pr-2.5 the "+"
              loses 10px of width (overflow-y:auto makes overflow-x auto too).
              Measured: 3 rows = 132px, so no scrollbar until a 4th item. */}
          <div className="overflow-y-auto max-h-[140px] space-y-5 py-2.5 pr-2.5">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-2">
                <span
                  className={`font-display text-[14px] flex-1 truncate ${item.soldOut ? "text-[var(--color-cream)]/45 line-through" : "text-[var(--color-cream)]"}`}
                >
                  {item.name}
                </span>
                {item.soldOut ? (
                  // Sold out can't be re-ordered, so the stepper is replaced by
                  // the only action left: remove it and unblock checkout.
                  <button
                    onClick={() => onRemove(item.id)}
                    className="relative shrink-0 h-6 px-2.5 rounded-full flex items-center text-[10px] uppercase tracking-[0.14em] bg-[var(--color-vermillion)]/20 text-[var(--color-vermillion-text)] border border-[var(--color-vermillion)]/40 hover:bg-[var(--color-vermillion)]/30 active:scale-95 transition-[transform,background-color] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] before:absolute before:-inset-2.5 before:content-['']"
                  >
                    Remove
                  </button>
                ) : (
                  <div className="flex items-center gap-2 shrink-0">
                    <QtyButton onClick={() => onDecrease(item.id)} label={`Decrease ${item.name}`}>
                      −
                    </QtyButton>
                    <span className="staff-num text-[13px] text-[var(--color-cream)] w-4 text-center">
                      {item.qty}
                    </span>
                    <QtyButton onClick={() => onIncrease(item.id)} label={`Increase ${item.name}`}>
                      +
                    </QtyButton>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="pt-1.5 border-t border-[var(--color-gold)]/15 flex justify-end">
            <button
              onClick={handleClear}
              className={`relative text-[11px] uppercase tracking-[0.18em] transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] before:absolute before:-inset-y-2.5 before:-inset-x-2 before:content-[''] ${
                confirmClear
                  ? "text-[var(--color-vermillion-text)]"
                  : "text-[var(--color-cream)]/65 hover:text-[var(--color-cream)]/85"
              }`}
            >
              {confirmClear ? "Tap again to clear" : "Clear cart"}
            </button>
          </div>
        </div>

        <button
          onClick={onCheckout}
          disabled={hasSoldOut}
          className="pointer-events-auto w-full flex items-center justify-between gap-3 rounded-2xl bg-[var(--color-vermillion)] text-[var(--color-cream)] px-5 py-3.5 shadow-[0_20px_40px_-18px_oklch(0.45_0.18_27/0.7)] border border-[var(--color-vermillion-deep)] active:scale-[0.98] transition-transform duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] disabled:opacity-70 disabled:cursor-not-allowed disabled:active:scale-100"
        >
          <span className="flex items-center gap-3 min-w-0">
            <span className="h-9 w-9 shrink-0 rounded-full bg-[var(--color-cream)]/15 flex items-center justify-center staff-num text-[15px]">
              {count}
            </span>
            <span className="flex flex-col items-start min-w-0">
              {/* nowrap: the longer "Remove sold-out" CTA squeezes this column
                  at 375px and would otherwise break it across two lines. */}
              <span className="whitespace-nowrap text-[11px] uppercase tracking-[0.2em] leading-[1.4] opacity-80">
                Your order
              </span>
              <span className="staff-num text-[15px] font-normal uppercase tracking-[0.12em] leading-[1.35] truncate">
                {count} {count === 1 ? "item" : "items"}
              </span>
            </span>
          </span>
          <span className="shrink-0 whitespace-nowrap text-[13px] uppercase tracking-[0.18em] font-semibold">
            {hasSoldOut ? "Remove sold-out" : "View Cart →"}
          </span>
        </button>
      </div>
    </div>
  );
}
