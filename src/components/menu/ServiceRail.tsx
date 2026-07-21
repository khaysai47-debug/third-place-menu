import type { ReactElement } from "react";
import { ScooterIcon, ShopBagIcon, StampStarIcon, TableChopsticksIcon } from "./Icons";
import { ORDER_TYPES, ORDER_TYPE_LABELS, ORDER_TYPE_ZH, type OrderType } from "./orderType";

const ORDER_ICONS: Record<OrderType, ReactElement> = {
  "dine-in": <TableChopsticksIcon className="h-full w-full" />,
  pickup: <ShopBagIcon className="h-full w-full" />,
  delivery: <ScooterIcon className="h-full w-full" />,
};

interface Props {
  orderType: OrderType;
  onOrderTypeChange: (type: OrderType) => void;
  /** Popular jumps to the Signature section. It is not an order type. */
  onPopularClick: () => void;
}

/**
 * Order type as one shared selector: a dark lacquered tray with a vermillion
 * panel that slides beneath the chosen option. The panel is the active state
 * — a real filled button that moves — rather than an outline drawn around a
 * tile.
 *
 * Popular sits OUTSIDE the tray as its own parchment shortcut, because it
 * answers a different question ("show me the good stuff") from the three
 * inside it ("how are you eating"). Putting it in the same container would
 * imply tapping it changes your order type; it never does.
 *
 * Geometry: the tray carries no padding, so its three grid cells and the
 * panel's `w-1/3` resolve against the same box and `translateX(index*100%)`
 * lands exactly. The panel's inset comes from padding on its own wrapper,
 * which does not affect that maths.
 *
 * The panel sits BEHIND the labels. Cream reads acceptably on both the ink
 * tray and the vermillion panel, so a label crossed mid-travel stays legible
 * and the colour shift happens naturally as the fill arrives.
 */
export function ServiceRail({ orderType, onOrderTypeChange, onPopularClick }: Props) {
  const index = ORDER_TYPES.indexOf(orderType);

  return (
    <section className="px-5">
      <div className="flex items-stretch gap-3">
        <div
          role="radiogroup"
          aria-label="Order type"
          className="relative grid flex-1 grid-cols-3 rounded-2xl border border-[var(--color-gold)]/30 bg-[var(--color-ink)]"
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 p-1.5 transition-transform duration-[380ms] ease-[var(--ease-fluid)] motion-reduce:transition-none"
            style={{ transform: `translateX(${index * 100}%)` }}
          >
            <span className="block h-full w-full rounded-xl border border-[var(--color-vermillion-deep)] bg-[var(--color-vermillion)] shadow-[0_8px_20px_-10px_oklch(0.45_0.18_27/0.75)]" />
          </span>

          {ORDER_TYPES.map((type) => {
            const active = orderType === type;
            return (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onOrderTypeChange(type)}
                className={`relative z-10 flex flex-col items-center gap-1.5 rounded-xl py-3.5 transition-[transform,color] duration-200 ease-[var(--ease-fluid)] active:scale-[0.96] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-gold)] ${
                  active ? "text-[var(--color-cream)]" : "text-[var(--color-cream)]/70"
                }`}
              >
                <span className="h-7 w-7">{ORDER_ICONS[type]}</span>
                <span className="flex flex-col items-center leading-none">
                  <span className="text-[11px] font-medium uppercase tracking-wide">
                    {ORDER_TYPE_LABELS[type]}
                  </span>
                  <span
                    className={`mt-1 text-[10px] transition-colors duration-200 ease-[var(--ease-fluid)] ${
                      active ? "text-[var(--color-cream)]/75" : "text-[var(--color-cream)]/45"
                    }`}
                  >
                    {ORDER_TYPE_ZH[type]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={onPopularClick}
          className="paper-grain flex w-[78px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border border-[var(--color-gold)]/40 text-[var(--color-ink)] shadow-[inset_0_-2px_0_oklch(0.7_0.05_75/0.25)] transition-transform duration-150 ease-[var(--ease-fluid)] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)]"
        >
          <span className="h-7 w-7">
            <StampStarIcon className="h-full w-full" />
          </span>
          <span className="flex flex-col items-center leading-none">
            <span className="text-[11px] font-medium uppercase tracking-wide">Popular</span>
            <span className="mt-1 text-[10px] text-[var(--color-ink)]/60">人氣</span>
          </span>
        </button>
      </div>
    </section>
  );
}
