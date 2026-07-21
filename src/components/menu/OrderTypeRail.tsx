import { ScooterIcon, ShopBagIcon, TableChopsticksIcon } from "./Icons";
import { ORDER_TYPES, ORDER_TYPE_LABELS, ORDER_TYPE_ZH, type OrderType } from "./orderType";

const ICONS: Record<OrderType, typeof ScooterIcon> = {
  "dine-in": TableChopsticksIcon,
  pickup: ShopBagIcon,
  delivery: ScooterIcon,
};

interface Props {
  value: OrderType;
  onChange: (type: OrderType) => void;
  /** `sm` is the checkout-sheet density; `lg` is the one on the menu page. */
  size?: "sm" | "lg";
}

/**
 * Segmented order-type control with a single vermillion block that slides
 * between the three options instead of three fills switching on and off. The
 * slide is what carries the state change, so the eye follows one object
 * rather than re-finding which tile lit up.
 *
 * Geometry: the track carries NO padding, so its three grid cells and the
 * indicator's `w-1/3` resolve against the same box and the indicator lands
 * exactly on a cell at `translateX(index * 100%)` — no measurement, no
 * resize observer. The visual inset comes from padding on the indicator's
 * own wrapper, which does not affect that maths.
 */
export function OrderTypeRail({ value, onChange, size = "lg" }: Props) {
  const index = ORDER_TYPES.indexOf(value);
  const large = size === "lg";

  return (
    <div
      role="radiogroup"
      aria-label="Order type"
      className="relative grid grid-cols-3 rounded-2xl border border-[var(--color-gold)]/20 bg-[var(--color-lacquer-deep)]/70"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1/3 p-1 transition-transform duration-[380ms] ease-[var(--ease-fluid)]"
        style={{ transform: `translateX(${index * 100}%)` }}
      >
        <span className="block h-full w-full rounded-xl border border-[var(--color-vermillion-deep)] bg-[var(--color-vermillion)] shadow-[0_10px_24px_-12px_oklch(0.45_0.18_27/0.85)]" />
      </span>

      {ORDER_TYPES.map((type) => {
        const Icon = ICONS[type];
        const active = value === type;
        return (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(type)}
            className={`relative z-10 flex flex-col items-center justify-center rounded-xl transition-[transform,color] duration-200 ease-[var(--ease-fluid)] active:scale-[0.96] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-gold)] ${
              large ? "gap-1.5 py-4" : "gap-1 py-3"
            } ${active ? "text-[var(--color-cream)]" : "text-[var(--color-cream)]/50"}`}
          >
            <Icon className={large ? "h-6 w-6" : "h-5 w-5"} />
            <span className="flex flex-col items-center leading-none">
              <span
                className={`${large ? "text-[11px]" : "text-[10px]"} uppercase tracking-[0.16em]`}
              >
                {ORDER_TYPE_LABELS[type]}
              </span>
              {large && (
                <span
                  className={`mt-1.5 text-[10px] ${active ? "text-[var(--color-cream)]/70" : "text-[var(--color-cream)]/35"}`}
                >
                  {ORDER_TYPE_ZH[type]}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
