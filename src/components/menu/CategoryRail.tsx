import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

interface Props {
  active: MenuCategoryId;
  onChange: (id: MenuCategoryId) => void;
}

/** Shared by the chip and the buttons so the moving panel lands exactly on
 *  the label it is covering. Any padding change has to happen in one place. */
const CELL = "flex flex-col items-center gap-1.5 px-3 pb-4 pt-3";

/**
 * Sections as one shared tray with a parchment chip that slides beneath the
 * current one.
 *
 * Parchment rather than vermillion, deliberately: the service selector above
 * already carries a vermillion panel, and stacking two red blocks turns the
 * top of the page into a warning light. Parchment-on-charcoal is the
 * approved menu's core motif, and it separates "how you are eating" (a
 * decision, in red) from "where you are in the menu" (a position, in paper).
 * A short vermillion underline inside the chip keeps the accent present.
 *
 * The chip rides IN FRONT and carries its own copy of the active icon and
 * labels in ink. Behind the buttons it would slide under cream text on
 * parchment during travel, which is unreadable; in front it simply covers
 * what it crosses and reads as a physical button gliding along the tray.
 *
 * Widths follow the real label lengths, so the chip is measured rather than
 * derived, and animates `width` alongside `transform`. It is one absolutely
 * positioned element, so nothing else reflows.
 */
export function CategoryRail({ active, onChange }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<Partial<Record<MenuCategoryId, HTMLButtonElement>>>({});
  const [chip, setChip] = useState({ x: 0, w: 0 });
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
    setChip({ x: a.left - b.left + scroller.scrollLeft, w: a.width });
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
    // The labels are set in a webfont, so cell widths change once it swaps
    // in. Without this the chip keeps its fallback-metric size until the
    // customer happens to change section.
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [measure]);

  // Keep the active section reachable when it sits off-screen in the tray.
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
            className="relative flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <span
              aria-hidden
              className={`pointer-events-none absolute inset-y-0 left-0 z-20 ${
                placed
                  ? "transition-[transform,width] duration-[420ms] ease-[var(--ease-fluid)] motion-reduce:transition-none"
                  : ""
              }`}
              style={{ transform: `translateX(${chip.x}px)`, width: `${chip.w}px` }}
            >
              <span
                className={`paper-grain relative h-full w-full rounded-xl border border-[var(--color-gold)]/45 text-[var(--color-ink)] shadow-[0_8px_20px_-12px_oklch(0_0_0/0.8)] ${CELL}`}
              >
                <span className="h-7 w-7">{ICONS[active]}</span>
                <span className="flex flex-col items-center leading-none">
                  <span className="whitespace-nowrap text-[11px] font-medium uppercase tracking-wide">
                    {CATEGORIES.find((c) => c.id === active)?.nameEn}
                  </span>
                  <span className="mt-1 text-[10px] text-[var(--color-ink)]/60">
                    {CATEGORY_ZH[active]}
                  </span>
                </span>
                <span className="absolute bottom-1.5 left-1/2 h-[2px] w-5 -translate-x-1/2 rounded-full bg-[var(--color-vermillion)]" />
              </span>
            </span>

            {CATEGORIES.map((c) => {
              const isActive = active === c.id;
              return (
                <button
                  key={c.id}
                  ref={(el) => {
                    if (el) itemsRef.current[c.id] = el;
                  }}
                  onClick={() => onChange(c.id)}
                  aria-current={isActive ? "true" : undefined}
                  className={`${CELL} shrink-0 rounded-xl transition-[transform,color] duration-200 ease-[var(--ease-fluid)] active:scale-[0.96] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-gold)] ${
                    isActive ? "text-[var(--color-cream)]" : "text-[var(--color-cream)]/70"
                  }`}
                >
                  <span className="h-7 w-7">{ICONS[c.id]}</span>
                  <span className="flex flex-col items-center leading-none">
                    <span className="whitespace-nowrap text-[11px] font-medium uppercase tracking-wide">
                      {c.nameEn}
                    </span>
                    <span className="mt-1 text-[10px] text-[var(--color-cream)]/45">
                      {CATEGORY_ZH[c.id]}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
