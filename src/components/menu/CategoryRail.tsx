import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { CATEGORIES, type MenuCategoryId } from "@/data/menu";
import { IconTile, TILE_PX } from "./IconTile";
import {
  NoodleBowlIcon,
  SkewerFlameIcon,
  SoupBowlIcon,
  StarChopsticksIcon,
  WokIcon,
} from "./Icons";

const ICONS: Record<MenuCategoryId, ReactElement> = {
  signature: <StarChopsticksIcon className="h-full w-full" />,
  skewers: <SkewerFlameIcon className="h-full w-full" />,
  "skewers-veg": <SkewerFlameIcon className="h-full w-full" />,
  "stir-fried": <WokIcon className="h-full w-full" />,
  "rice-noodles": <NoodleBowlIcon className="h-full w-full" />,
  soup: <SoupBowlIcon className="h-full w-full" />,
};

const CATEGORY_ZH: Record<MenuCategoryId, string> = {
  signature: "招牌",
  skewers: "串燒",
  "skewers-veg": "素串",
  "stir-fried": "小炒",
  "rice-noodles": "飯麵",
  soup: "湯品",
};

interface Props {
  active: MenuCategoryId;
  onChange: (id: MenuCategoryId) => void;
}

/**
 * The approved icon-tile section nav, with the redesign's travelling
 * indicator: one thin gold frame with a vermillion seal slides between
 * category tiles instead of six fills switching on and off. Same selection
 * language as the service rail above it.
 *
 * Tile widths vary with their labels, so the chip's position is measured
 * rather than derived. Rect maths (not offsetLeft) keeps it correct inside a
 * horizontally scrolled, padded container.
 */
export function CategoryRail({ active, onChange }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<Partial<Record<MenuCategoryId, HTMLDivElement>>>({});
  const [chipX, setChipX] = useState(0);
  // The chip must not slide in from x=0 on first paint; it only animates once
  // it has been placed.
  const placedRef = useRef(false);
  const [placed, setPlaced] = useState(false);

  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    const el = itemsRef.current[active];
    if (!scroller || !el) return;
    const a = el.getBoundingClientRect();
    const b = scroller.getBoundingClientRect();
    setChipX(a.left - b.left + scroller.scrollLeft + (a.width - TILE_PX.sm) / 2);
    if (!placedRef.current) {
      placedRef.current = true;
      setPlaced(true);
    }
  }, [active]);

  useLayoutEffect(measure, [measure]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    // The labels are set in a webfont, so tile widths change once it swaps
    // in. Without this the chip keeps its fallback-metric offset until the
    // customer happens to change section.
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [measure]);

  // Keep the active section reachable when it sits off-screen in the rail.
  // scrollLeft is set directly rather than via scrollIntoView, which would
  // also scroll the page vertically.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const el = itemsRef.current[active];
    if (!scroller || !el) return;
    scroller.scrollTo({
      left: el.offsetLeft - scroller.clientWidth / 2 + el.offsetWidth / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [active]);

  return (
    // Opaque base first: the opacity modifier alone does nothing without
    // backdrop-filter support, which is what left the original nav
    // transparent on browsers that lack it.
    <nav
      aria-label="Menu sections"
      className="sticky top-0 z-30 border-y border-[var(--color-gold)]/15 bg-[var(--color-charcoal)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-charcoal)]/85"
    >
      <div className="px-5 py-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-display text-[13px] uppercase tracking-[0.3em] text-[var(--color-gold-soft)]">
            Menu · 菜譜
          </p>
          <span className="divider-stamp mx-3 flex-1" />
          <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted-foreground)]">
            {CATEGORIES.length} sections
          </p>
        </div>

        <div
          ref={scrollerRef}
          className="relative -mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <span
            aria-hidden
            className={`pointer-events-none absolute left-0 top-0 z-10 h-14 w-14 rounded-2xl border-2 border-[var(--color-gold)]/75 shadow-[0_0_0_3px_oklch(0.72_0.11_75/0.10)] ${
              placed
                ? "transition-transform duration-[420ms] ease-[var(--ease-fluid)] motion-reduce:transition-none"
                : ""
            }`}
            style={{ transform: `translateX(${chipX}px)` }}
          >
            <span className="absolute -right-1.5 -top-1.5 h-3 w-3 rotate-12 rounded-[2px] bg-[var(--color-vermillion)]" />
          </span>

          {CATEGORIES.map((c) => (
            <div
              key={c.id}
              ref={(el) => {
                if (el) itemsRef.current[c.id] = el;
              }}
              className="shrink-0"
            >
              <IconTile
                size="sm"
                icon={ICONS[c.id]}
                label={c.nameEn}
                sublabel={CATEGORY_ZH[c.id]}
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
