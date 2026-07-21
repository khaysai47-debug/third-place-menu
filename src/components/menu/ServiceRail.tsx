import type { ReactElement } from "react";
import { IconTile } from "./IconTile";
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
  /** Popular is a jump to the Signature section, not a fourth order type. */
  onPopularClick: () => void;
}

/**
 * The approved four-up service row: Dine In, Pick Up, Delivery, Popular.
 *
 * Selection is a thin gold frame that slides across the first three tiles,
 * with a small vermillion seal pinned to its corner. Because the frame is
 * transparent it rides ABOVE the parchment boxes without hiding them — the
 * tile keeps its parchment surface and dark ink icon throughout, and the
 * frame stays visible as it travels past the tile in between.
 *
 * Geometry: the grid carries no gap, so its cells and the chip's `w-1/4`
 * resolve against the same box and `translateX(index * 100%)` lands exactly.
 * The visual gutter comes from the 64px box being narrower than its cell.
 */
export function ServiceRail({ orderType, onOrderTypeChange, onPopularClick }: Props) {
  const index = ORDER_TYPES.indexOf(orderType);

  return (
    <section className="px-5">
      <div className="relative grid grid-cols-4">
        <span
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 z-10 flex w-1/4 justify-center transition-transform duration-[380ms] ease-[var(--ease-fluid)] motion-reduce:transition-none"
          style={{ transform: `translateX(${index * 100}%)` }}
        >
          <span className="relative h-16 w-16 rounded-2xl border-2 border-[var(--color-gold)]/75 shadow-[0_0_0_3px_oklch(0.72_0.11_75/0.10)]">
            {/* Seal, echoing the stamp corners on the hero quote card. */}
            <span className="absolute -right-1.5 -top-1.5 h-3 w-3 rotate-12 rounded-[2px] bg-[var(--color-vermillion)]" />
          </span>
        </span>

        {ORDER_TYPES.map((type) => (
          <IconTile
            key={type}
            icon={ORDER_ICONS[type]}
            label={ORDER_TYPE_LABELS[type]}
            sublabel={ORDER_TYPE_ZH[type]}
            active={orderType === type}
            onClick={() => onOrderTypeChange(type)}
          />
        ))}

        <IconTile
          icon={<StampStarIcon className="h-full w-full" />}
          label="Popular"
          sublabel="人氣"
          onClick={onPopularClick}
        />
      </div>
    </section>
  );
}
