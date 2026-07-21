import { useEffect, useRef } from "react";
import type { ReactElement } from "react";
import { CATEGORIES, type MenuCategoryId } from "@/data/menu";
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

/** Narrowest a column may get before the tray starts scrolling instead of
 *  crushing the labels.
 *
 *  104px, not the 84px this started at, because the column's proportions are
 *  the indicator's proportions. At 84 wide the cell was 104 tall — portrait —
 *  and the parchment surface read as a card standing on the tray. At 104 wide
 *  and ~75 tall it reads as a landscape plate lying in it. It also happens to
 *  be the width the six columns settle at on desktop, so the shape is the
 *  same on every screen; only the count you can see at once changes. */
const MIN_COLUMN_PX = 104;

interface Props {
  active: MenuCategoryId;
  onChange: (id: MenuCategoryId) => void;
}

/**
 * Sections as one balanced segmented selector.
 *
 * Layout: six `minmax(MIN_COLUMN_PX, 1fr)` columns in a grid that is at
 * least as wide as its scroller. Where there is room the columns share the
 * width equally and the tray is filled edge to edge; where there is not they
 * hold the minimum and the tray scrolls. Nothing is ever crushed and no gap
 * is left at the right.
 *
 * Because every column is identical, the indicator needs no measurement at
 * all: it is exactly `w-1/6` and steps by whole multiples of its own width.
 * That removed the rect maths, the ResizeObserver and the font-ready
 * re-measure this component used to carry, and it means only `transform`
 * animates — never `width`.
 *
 * The indicator is background only. Every icon and label stays put; the
 * parchment surface glides underneath them and the text simply changes
 * colour, so no content is duplicated and nothing travels across its
 * neighbours.
 */
export function CategoryRail({ active, onChange }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const index = CATEGORIES.findIndex((c) => c.id === active);

  // Keep the active section reachable when the tray is scrolling. Derived
  // from the column width rather than a per-item ref, since the columns are
  // equal by construction. scrollLeft is set directly rather than via
  // scrollIntoView, which would also scroll the page vertically.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const column = scroller.scrollWidth / CATEGORIES.length;
    scroller.scrollTo({
      left: index * column - scroller.clientWidth / 2 + column / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  }, [index]);

  return (
    // Opaque base first: the opacity modifier alone does nothing without
    // backdrop-filter support, which is what left the original nav
    // transparent on browsers that lack it.
    <nav
      aria-label="Menu sections"
      className="sticky top-0 z-30 border-y border-[var(--color-gold)]/15 bg-[var(--color-charcoal)]/95 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-charcoal)]/85"
    >
      <div className="px-5 py-3">
        <div className="mb-2.5 flex items-center justify-between">
          <p className="font-display text-[13px] uppercase tracking-[0.3em] text-[var(--color-gold-soft)]">
            Menu · 菜譜
          </p>
          <span className="divider-stamp mx-3 flex-1" />
          <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-muted-foreground)]">
            {CATEGORIES.length} sections
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--color-gold)]/25 bg-[var(--color-ink)] p-1.5">
          <div
            ref={scrollerRef}
            className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {/* `w-max` is load-bearing, not decoration. Without it the grid
                box stays at the scroller's width while its columns overflow
                it, so the indicator's `w-1/6` resolved against 306px instead
                of 624px and came out at less than half a cell on mobile.
                With `w-max` the box matches its columns, and `min-w-full`
                still lets the fr tracks stretch to fill a wide tray. */}
            <div
              className="relative grid w-max min-w-full"
              style={{
                gridTemplateColumns: `repeat(${CATEGORIES.length}, minmax(${MIN_COLUMN_PX}px, 1fr))`,
              }}
            >
              {/* Background only, and beneath the labels. Its border box is
                  exactly one column, so a whole-number translate lands it on
                  the cell every time. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 z-0 w-1/6 p-0.5 transition-transform duration-[340ms] ease-[var(--ease-fluid)] [will-change:transform] motion-reduce:transition-none"
                style={{ transform: `translate3d(${index * 100}%, 0, 0)` }}
              >
                {/* Inlaid rather than floating: no drop shadow, a softer
                    border and a smaller radius, with a single inset highlight
                    along the top edge so the surface reads as set into the
                    tray instead of resting on top of it. */}
                <span className="paper-grain relative block h-full w-full rounded-lg border border-[var(--color-gold)]/25 shadow-[inset_0_1px_0_oklch(1_0_0/0.28)]">
                  <span className="absolute bottom-1.5 left-1/2 h-[2px] w-5 -translate-x-1/2 rounded-full bg-[var(--color-vermillion)]" />
                </span>
              </span>

              {CATEGORIES.map((c) => {
                const isActive = active === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => onChange(c.id)}
                    aria-current={isActive ? "true" : undefined}
                    // The colour swap is deliberately asymmetric. Turning
                    // active is delayed until the surface has almost arrived,
                    // while turning inactive happens at once as it leaves —
                    // otherwise ink text sits on the dark tray, or cream text
                    // on parchment, for the length of the slide.
                    className={`relative z-10 flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg px-1.5 py-2.5 transition-colors duration-200 ease-[var(--ease-fluid)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-gold)] ${
                      isActive
                        ? "text-[var(--color-ink)] delay-[170ms] motion-reduce:delay-0"
                        : "text-[var(--color-cream)]/70 delay-0"
                    }`}
                  >
                    <span className="h-6 w-6 shrink-0">{ICONS[c.id]}</span>
                    <span className="flex flex-col items-center leading-none">
                      {/* 10px keeps "Rice & Noodles", the longest label, on a
                          single line inside the 104px column. Wrapping is
                          still allowed as a graceful fallback if the webfont
                          renders wider than expected — the grid equalises
                          every cell, so it degrades in height, never by
                          spilling into a neighbour. */}
                      <span className="text-center text-[10px] font-medium uppercase leading-[1.2] tracking-[0.02em]">
                        {c.nameEn}
                      </span>
                      <span
                        className={`mt-0.5 text-[9.5px] transition-colors duration-200 ease-[var(--ease-fluid)] ${
                          isActive
                            ? "text-[var(--color-ink)]/60 delay-[170ms] motion-reduce:delay-0"
                            : "text-[var(--color-cream)]/45 delay-0"
                        }`}
                      >
                        {CATEGORY_ZH[c.id]}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
