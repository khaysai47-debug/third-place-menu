import logo from "@/assets/logo.jpg";
import { SmokeMotif } from "./Icons";

interface Props {
  /** Scrolls to the menu. The hero's only CTA — one intent, one label. */
  onEnter: () => void;
}

/**
 * Layered opening composition. Four depth planes drift at different rates as
 * the customer scrolls into the menu:
 *   watermark 第三空間  → slow  (furthest back)
 *   smoke motif        → slow
 *   title block        → fast  (nearest, clears out first)
 * The parallax is a native scroll timeline in styles.css, so there is no
 * scroll listener and nothing runs on the main thread.
 *
 * The staged entrance IS the opening sequence: seal, then title, then the
 * quote, then the CTA. Nothing is pointer-blocked while it plays, and every
 * element is at its final position within ~700ms.
 */
export function Hero({ onEnter }: Props) {
  return (
    <header className="relative overflow-hidden px-5 pt-8 pb-10">
      {/* Watermark — the deepest plane, never reads as content. */}
      <span
        aria-hidden
        className="tp-parallax-slow tp-display pointer-events-none absolute -right-3 top-16 select-none text-[124px] leading-[0.8] text-[var(--color-gold)]/[0.055] [writing-mode:vertical-rl]"
      >
        第三空間
      </span>

      {/* Masked so the smoke dissolves before it reaches the headline —
          unmasked it crosses the title and reads as scribble, not haze. */}
      <SmokeMotif
        aria-hidden
        className="tp-parallax-slow tp-drift pointer-events-none absolute -top-6 left-0 w-[130%] text-[var(--color-gold)]/25 [mask-image:linear-gradient(to_bottom,black,transparent_75%)]"
      />

      <div className="tp-parallax-fast relative">
        {/* Status line */}
        <div className="tp-rise-sm flex items-center justify-between text-[10.5px] uppercase tracking-[0.24em] text-[var(--color-gold-soft)]/70">
          <span>菜單 · Menu</span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/90" />
            Open · 11:00 to 23:00
          </span>
        </div>

        {/* Seal — the logo pressed as a chop rather than floated as a bubble. */}
        <div className="tp-seal mt-9 relative w-fit" style={{ ["--i" as string]: 1 }}>
          <span
            aria-hidden
            className="absolute -inset-2 rounded-[14px] bg-[var(--color-vermillion)]/25 blur-2xl"
          />
          <img
            src={logo}
            alt="The Third Place — Chinese BBQ &amp; Lounge"
            className="relative h-[72px] w-[72px] rounded-[14px] object-cover ring-1 ring-[var(--color-gold)]/45 shadow-[0_18px_40px_-18px_oklch(0_0_0/0.9)]"
          />
          <span
            aria-hidden
            className="absolute -bottom-1.5 -right-1.5 h-5 w-5 rotate-12 rounded-[3px] border border-[var(--color-vermillion)]/70 bg-[var(--color-vermillion)]"
          />
        </div>

        {/* Title block */}
        <div className="tp-rise mt-7" style={{ ["--i" as string]: 2 }}>
          <p className="text-[10.5px] uppercase tracking-[0.34em] text-[var(--color-vermillion-text)]">
            Charcoal · Yunnan spice
          </p>
          <h1 className="tp-display mt-3 text-[clamp(46px,15vw,68px)] text-[var(--color-cream)]">
            The <span className="italic text-[var(--color-vermillion-text)]">Third</span>
            <br />
            Place
          </h1>
          <p className="mt-3 text-[11px] uppercase tracking-[0.3em] text-[var(--color-gold-soft)]/85">
            Chinese BBQ &amp; Lounge
          </p>
        </div>

        {/* Quote — the one parchment surface up here, so paper reads as an
            arrival rather than the default background. */}
        <div
          className="tp-rise paper-grain relative mt-8 rounded-[18px] border border-[var(--color-gold)]/45 px-5 py-5 text-[var(--color-ink)] shadow-[0_28px_60px_-34px_oklch(0_0_0/0.95)]"
          style={{ ["--i" as string]: 3 }}
        >
          <span
            aria-hidden
            className="absolute -left-1.5 -top-1.5 h-3.5 w-3.5 rotate-12 rounded-[2px] bg-[var(--color-vermillion)]"
          />
          <span
            aria-hidden
            className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 -rotate-12 rounded-[2px] bg-[var(--color-vermillion)]"
          />
          <p className="font-display text-[21px] font-semibold italic leading-[1.25] text-balance">
            “A warm table after class, work, and everything in between.”
          </p>
          <p className="mt-3.5 flex items-center gap-2 text-[10.5px] uppercase tracking-[0.2em] text-[var(--color-ink)]/70">
            <span className="h-px w-6 bg-[var(--color-vermillion)]" />
            Near Assumption University
          </p>
        </div>

        <button
          onClick={onEnter}
          style={{ ["--i" as string]: 4 }}
          className="tp-rise group mt-6 flex w-full items-center justify-between gap-3 rounded-[18px] border border-[var(--color-gold)]/30 bg-[var(--color-charcoal-soft)]/70 px-5 py-4 text-left transition-[transform,border-color,background-color] duration-200 ease-[var(--ease-fluid)] active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] hover:border-[var(--color-gold)]/55"
        >
          <span className="flex flex-col">
            <span className="text-[10.5px] uppercase tracking-[0.24em] text-[var(--color-gold-soft)]/70">
              開始點餐
            </span>
            <span className="font-display text-[19px] leading-tight text-[var(--color-cream)]">
              Read the menu
            </span>
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-gold)]/35 text-[var(--color-gold-soft)] transition-transform duration-200 ease-[var(--ease-fluid)] group-hover:translate-y-0.5">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
            >
              <path d="M12 5v14M6 13l6 6 6-6" />
            </svg>
          </span>
        </button>
      </div>
    </header>
  );
}
