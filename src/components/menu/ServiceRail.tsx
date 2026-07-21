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
 * Selection is a vermillion chip that slides across the first three tiles.
 * It rides ABOVE the parchment boxes and carries a copy of the active icon,
 * so it stays visible while it travels past the tile in between — a chip
 * sliding underneath would be occluded by the opaque parchment it crosses.
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
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--color-vermillion-deep)] bg-[var(--color-vermillion)] text-[var(--color-cream)] shadow-[0_6px_18px_-8px_oklch(0.45_0.18_27/0.6)]">
            <span className="h-8 w-8">{ORDER_ICONS[orderType]}</span>
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
