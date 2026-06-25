import type { OrderType } from "./CheckoutDrawer";
import { IconTile } from "./IconTile";
import { TableChopsticksIcon, ShopBagIcon, ScooterIcon, StampStarIcon } from "./Icons";

interface Props {
  orderType: OrderType;
  onOrderTypeChange: (type: OrderType) => void;
  onPopularClick: () => void;
}

export function ServiceTiles({ orderType, onOrderTypeChange, onPopularClick }: Props) {
  return (
    <section className="px-5">
      <div className="grid grid-cols-4 gap-3">
        <IconTile
          icon={<TableChopsticksIcon className="h-full w-full" />}
          label="Dine In"
          sublabel="堂食"
          active={orderType === "dine-in"}
          onClick={() => onOrderTypeChange("dine-in")}
        />
        <IconTile
          icon={<ShopBagIcon className="h-full w-full" />}
          label="Pick Up"
          sublabel="自取"
          active={orderType === "pickup"}
          onClick={() => onOrderTypeChange("pickup")}
        />
        <IconTile
          icon={<ScooterIcon className="h-full w-full" />}
          label="Delivery"
          sublabel="外送"
          active={orderType === "delivery"}
          onClick={() => onOrderTypeChange("delivery")}
        />
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
