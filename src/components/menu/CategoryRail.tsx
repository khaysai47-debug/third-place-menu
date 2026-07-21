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
 *  crushing the labels. Sized so "Signature", the widest unbreakable word,
 *  still sits on one line. */
const MIN_COLUMN_PX = 84;

interface Props {
  active: MenuCategoryId;
  onChange: (id: MenuCategoryId) => void;
}

/**
 * Sections as one balanced segmented selector.
 *
 * Layout: six `minmax(84px, 1fr)` columns in a grid that is at least as wide
 * as its scroller. Where there is room the columns share the width equally
 * and the tray is filled edge to edge; where there is not they hold 84px and
 * the tray scrolls. Nothing is ever crushed and no gap is left at the right.
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
            <div
              className="relative grid min-w-full"
              style={{
                gridTemplateColumns: `repeat(${CATEGORIES.length}, minmax(${MIN_COLUMN_PX}px, 1fr))`,
              }}
            >
              {/* Background only, and beneath the labels. Its border box is
                  exactly one column, so a whole-number translate lands it on
                  the cell every time. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 z-0 w-1/6 p-0.5 transition-transform duration-[400ms] ease-[var(--ease-fluid)] [will-change:transform] motion-reduce:transition-none"
                style={{ transform: `translate3d(${index * 100}%, 0, 0)` }}
              >
                <span className="paper-grain relative block h-full w-full rounded-xl border border-[var(--color-gold)]/45 shadow-[0_8px_20px_-12px_oklch(0_0_0/0.8)]">
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
                    className={`relative z-10 flex min-w-0 flex-col items-center justify-center gap-1.5 rounded-xl px-2 pb-4 pt-3 transition-colors duration-200 ease-[var(--ease-fluid)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-gold)] ${
                      isActive
                        ? "text-[var(--color-ink)] delay-200 motion-reduce:delay-0"
                        : "text-[var(--color-cream)]/70 delay-0"
                    }`}
                  >
                    <span className="h-7 w-7 shrink-0">{ICONS[c.id]}</span>
                    <span className="flex flex-col items-center leading-none">
                      <span className="text-balance text-center text-[11px] font-medium uppercase leading-[1.25] tracking-[0.02em]">
                        {c.nameEn}
                      </span>
                      <span
                        className={`mt-1 text-[10px] transition-colors duration-200 ease-[var(--ease-fluid)] ${
                          isActive
                            ? "text-[var(--color-ink)]/60 delay-200 motion-reduce:delay-0"
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
