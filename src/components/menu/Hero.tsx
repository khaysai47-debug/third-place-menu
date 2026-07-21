import logo from "@/assets/logo.jpg";
import { SmokeMotif } from "./Icons";

/**
 * The approved hero, with the redesign's layered motion.
 *
 * Composition is the original one: status bar, round logo beside the title,
 * vertical 第三空間, and the warm-table quote card with its stamp corners.
 * Three depth planes drift at different rates on scroll (smoke and the
 * Chinese mark slowly, the content block faster) via native scroll timelines
 * in styles.css, so there is no scroll listener and nothing runs on the main
 * thread. `overflow-hidden` on the header is load-bearing: it clips the
 * drifting content instead of letting it slide over the service tiles.
 *
 * The staged entrance is the opening sequence: status line, then the logo
 * seal, then the title, then the quote. Nothing blocks input while it plays.
 */
export function Hero() {
  return (
    <header className="relative overflow-hidden">
      {/* Masked so the smoke dissolves before it reaches the title — unmasked
          it crosses the headline and reads as scribble rather than haze. */}
      <SmokeMotif
        aria-hidden
        className="tp-parallax-slow tp-drift pointer-events-none absolute -top-2 left-0 w-full text-[var(--color-gold)]/25 [mask-image:linear-gradient(to_bottom,black,transparent_80%)]"
      />

      <div className="tp-parallax-fast relative px-5 pb-5 pt-6">
        {/* Status bar */}
        <div className="tp-rise-sm flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[var(--color-gold-soft)]/80">
          <span>菜單 · Menu</span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 motion-reduce:animate-none" />
            Open now
          </span>
        </div>

        {/* Logo + title + vertical Chinese mark */}
        <div className="mt-5 flex items-start gap-4">
          <div className="tp-seal relative shrink-0" style={{ ["--i" as string]: 1 }}>
            <div className="absolute inset-0 rounded-full bg-[var(--color-vermillion)]/20 blur-xl" />
            {/* 88px, not the original 96px: at 375 the extra 8px is what
                pushed the eyebrow and the subtitle onto second lines. */}
            <img
              src={logo}
              alt="The Third Place — Chinese BBQ &amp; Lounge"
              className="relative h-22 w-22 rounded-full object-cover shadow-[0_10px_30px_-10px_oklch(0_0_0/0.6)] ring-1 ring-[var(--color-gold)]/40"
            />
          </div>

          <div className="tp-rise flex-1 pt-1" style={{ ["--i" as string]: 2 }}>
            <h1 className="tp-display text-balance text-[34px] text-[var(--color-cream)]">
              The <span className="text-[var(--color-vermillion)]">Third</span> Place
            </h1>
            {/* Tracking is tightened from the original 0.22em so this line
                survives the narrow column at 375 without wrapping. */}
            <p className="mt-1 text-[11.5px] uppercase tracking-[0.14em] text-[var(--color-gold-soft)]">
              Chinese BBQ &amp; Lounge
            </p>
          </div>

          <div className="tp-parallax-slow vertical-cn font-display pt-1 text-[18px] text-[var(--color-gold)]/70">
            第三空間
          </div>
        </div>

        {/* Warm-table quote card */}
        <div
          className="tp-rise paper-grain relative mt-6 rounded-2xl border border-[var(--color-gold)]/45 px-5 py-5 text-[var(--color-ink)] shadow-[0_20px_40px_-25px_oklch(0_0_0/0.8)]"
          style={{ ["--i" as string]: 3 }}
        >
          <span
            aria-hidden
            className="absolute -left-2 -top-2 h-4 w-4 rotate-12 rounded-sm bg-[var(--color-vermillion)]"
          />
          <span
            aria-hidden
            className="absolute -bottom-2 -right-2 h-4 w-4 -rotate-12 rounded-sm bg-[var(--color-vermillion)]"
          />

          {/* A statement, not a quotation: no quote marks, no italic, and a
              lighter weight than the old slogan carried. */}
          <p className="font-display text-balance text-[22px] font-medium leading-snug tracking-[-0.01em]">
            Chinese BBQ made for sharing.
          </p>
          <div className="mt-4 flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink)]/70">
            <span className="flex items-center gap-1.5">
              <span className="h-1 w-6 bg-[var(--color-vermillion)]" />
              Near Assumption University
            </span>
            <span>11:00 — 23:00</span>
          </div>
        </div>
      </div>
    </header>
  );
}
