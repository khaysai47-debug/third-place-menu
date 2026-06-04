import { IconTile } from "./IconTile";
import { TableChopsticksIcon, ShopBagIcon, ScooterIcon, StampStarIcon } from "./Icons";

export function ServiceTiles() {
  return (
    <section className="px-5">
      <div className="grid grid-cols-4 gap-3">
        <IconTile icon={<TableChopsticksIcon className="h-full w-full" />} label="Dine In" sublabel="堂食" />
        <IconTile icon={<ShopBagIcon className="h-full w-full" />} label="Pick Up" sublabel="自取" />
        <IconTile icon={<ScooterIcon className="h-full w-full" />} label="Delivery" sublabel="外送" />
        <IconTile icon={<StampStarIcon className="h-full w-full" />} label="Popular" sublabel="人氣" />
      </div>
    </section>
  );
}
