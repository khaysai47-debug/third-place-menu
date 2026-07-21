import type { ReactElement } from "react";
import { CATEGORIES, type MenuCategoryId } from "@/data/menu";
import { StarChopsticksIcon, SkewerFlameIcon, WokIcon, NoodleBowlIcon, SoupBowlIcon } from "./Icons";
import { IconTile } from "./IconTile";

const ICONS: Record<MenuCategoryId, ReactElement> = {
  signature: <StarChopsticksIcon className="h-full w-full" />,
  skewers: <SkewerFlameIcon className="h-full w-full" />,
  "skewers-veg": <SkewerFlameIcon className="h-full w-full" />,
  "stir-fried": <WokIcon className="h-full w-full" />,
  "rice-noodles": <NoodleBowlIcon className="h-full w-full" />,
  soup: <SoupBowlIcon className="h-full w-full" />,
};

interface Props {
  active: MenuCategoryId;
  onChange: (id: MenuCategoryId) => void;
}

export function CategoryNav({ active, onChange }: Props) {
  return (
    // `ink-grain/95` was inert: the opacity modifier only applies to colour
    // utilities, and .ink-grain is a plain custom utility, so the nav had no
    // background at all without backdrop-filter support. Opaque base + the
    // translucent supports- override is the standard pairing.
    <nav className="sticky top-0 z-30 bg-[var(--color-charcoal)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-charcoal)]/85 border-y border-[var(--color-gold)]/15">
      <div className="px-5 py-3">
        <div className="flex items-center justify-between mb-2">
          <p className="font-display text-[13px] tracking-[0.3em] uppercase text-[var(--color-gold-soft)]">
            Menu · 菜譜
          </p>
          <span className="divider-stamp flex-1 mx-3" />
          <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted-foreground)]">{CATEGORIES.length} sections</p>
        </div>
        <div className="flex gap-3 overflow-x-auto -mx-1 px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CATEGORIES.map((c) => (
            <div key={c.id} className="shrink-0">
              <IconTile
                size="sm"
                icon={ICONS[c.id]}
                label={c.nameEn}
                active={active === c.id}
                onClick={() => onChange(c.id)}
              />
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}
