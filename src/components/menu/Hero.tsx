import logo from "@/assets/logo.jpg";
import { SmokeMotif } from "./Icons";

export function Hero() {
  return (
    <header className="relative overflow-hidden">
      {/* Decorative smoke */}
      <SmokeMotif className="absolute -top-2 left-0 w-full text-[var(--color-gold)]/20 pointer-events-none" />

      <div className="relative px-5 pt-6 pb-5">
        {/* Top bar */}
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[var(--color-gold-soft)]/80">
          <span>菜單 · Menu</span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Open now
          </span>
        </div>

        {/* Logo + Chinese vertical accent */}
        <div className="mt-5 flex items-start gap-4">
          <div className="relative shrink-0">
            <div className="absolute inset-0 rounded-full bg-[var(--color-vermillion)]/20 blur-xl" />
            <img
              src={logo}
              alt="The Third Place — Chinese BBQ & Lounge"
              className="relative h-24 w-24 rounded-full object-cover ring-1 ring-[var(--color-gold)]/40 shadow-[0_10px_30px_-10px_oklch(0_0_0/0.6)]"
            />
          </div>
          <div className="flex-1 pt-1">
            <p className="font-display text-xs tracking-[0.3em] text-[var(--color-vermillion)] uppercase">
              Est. — A Warm Table
            </p>
            <h1 className="font-display text-[34px] leading-[1.05] text-balance text-[var(--color-cream)]">
              The <span className="text-[var(--color-vermillion)]">Third</span> Place
            </h1>
            <p className="mt-1 text-[12px] tracking-[0.22em] uppercase text-[var(--color-gold-soft)]">
              Chinese BBQ &amp; Lounge
            </p>
          </div>
          <div className="vertical-cn font-display text-[18px] text-[var(--color-gold)]/70 pt-1">
            第三空間
          </div>
        </div>

        {/* Tagline card */}
        <div className="relative mt-6 paper-grain rounded-2xl border border-[var(--color-gold)]/30 px-5 py-5 text-[var(--color-ink)] shadow-[0_20px_40px_-25px_oklch(0_0_0/0.8)]">
          {/* stamp corners */}
          <span className="absolute -top-2 -left-2 h-4 w-4 rounded-sm bg-[var(--color-vermillion)] rotate-12" aria-hidden />
          <span className="absolute -bottom-2 -right-2 h-4 w-4 rounded-sm bg-[var(--color-vermillion)] -rotate-12" aria-hidden />

          <p className="font-display italic text-[19px] leading-snug text-balance">
            “A warm table after class, work, and everything in between.”
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
