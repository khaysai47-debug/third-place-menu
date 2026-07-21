import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CATEGORIES, type MenuCategoryId } from "@/data/menu";

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
 * Chapter rail. One vermillion bar travels between chapters rather than six
 * underlines fading in and out — the movement is what says "you are here".
 *
 * The bar is a 1px element scaled and translated, so both the position and
 * the width change ride on `transform` alone and stay on the compositor.
 * Widths are measured because the labels are real words, not equal cells.
 */
export function CategoryRail({ active, onChange }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<Partial<Record<MenuCategoryId, HTMLButtonElement>>>({});
  const [bar, setBar] = useState({ x: 0, w: 0 });
  // The bar must not slide in from x=0 on first paint; it only animates once
  // it has been placed.
  const placedRef = useRef(false);
  const [placed, setPlaced] = useState(false);

  const measure = useCallback(() => {
    const el = itemsRef.current[active];
    if (!el) return;
    setBar({ x: el.offsetLeft, w: el.offsetWidth });
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
    // The labels are set in a webfont, so their widths change once it swaps
    // in. Without this the bar keeps its fallback-metric width until the
    // customer happens to change chapter.
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [measure]);

  // Keep the active chapter reachable when it sits off-screen in the rail.
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
    // Translucent chrome: the menu scrolls under it instead of the bar
    // claiming an opaque strip. Opaque base first, because the opacity
    // modifier alone does nothing without backdrop-filter support.
    <nav
      aria-label="Menu sections"
      className="sticky top-0 z-30 border-b border-[var(--color-gold)]/15 bg-[var(--color-lacquer)] supports-[backdrop-filter]:bg-[var(--color-lacquer)]/80 supports-[backdrop-filter]:backdrop-blur-xl"
    >
      <div
        ref={scrollerRef}
        className="relative flex gap-7 overflow-x-auto px-5 pt-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
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
              className={`shrink-0 pb-3 text-left transition-colors duration-200 ease-[var(--ease-fluid)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-gold)] ${
                isActive ? "text-[var(--color-cream)]" : "text-[var(--color-cream)]/45"
              }`}
            >
              <span className="block font-display text-[17px] leading-none whitespace-nowrap">
                {c.nameEn}
              </span>
              <span
                className={`mt-1.5 block text-[11px] leading-none tracking-[0.2em] transition-colors duration-200 ease-[var(--ease-fluid)] ${
                  isActive
                    ? "text-[var(--color-vermillion-text)]"
                    : "text-[var(--color-gold-soft)]/35"
                }`}
              >
                {CATEGORY_ZH[c.id]}
              </span>
            </button>
          );
        })}

        <span
          aria-hidden
          className={`pointer-events-none absolute bottom-0 left-0 h-[2px] w-px origin-left bg-[var(--color-vermillion)] ${
            placed ? "transition-transform duration-[420ms] ease-[var(--ease-fluid)]" : ""
          }`}
          style={{ transform: `translateX(${bar.x}px) scaleX(${bar.w})` }}
        />
      </div>
    </nav>
  );
}
