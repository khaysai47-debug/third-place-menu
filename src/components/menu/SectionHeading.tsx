interface Props {
  eyebrow?: string;
  title: string;
  zh?: string;
  blurb?: string;
}

/** The approved section plate. It re-enters on every section change, so
 *  switching sections reads as turning a page rather than as content
 *  silently swapping underneath a static heading. */
export function SectionHeading({ eyebrow, title, zh, blurb }: Props) {
  return (
    <div className="mb-4 mt-8 px-5">
      <div className="tp-rise">
        <div className="flex items-end justify-between gap-3">
          <div>
            {eyebrow && (
              <p className="text-[11px] uppercase tracking-[0.3em] text-[var(--color-vermillion)]">
                {eyebrow}
              </p>
            )}
            <h2 className="font-display mt-1 text-[28px] leading-none text-[var(--color-cream)]">
              {title}
            </h2>
          </div>
          {zh && <span className="font-display text-[26px] text-[var(--color-gold)]/80">{zh}</span>}
        </div>
        {blurb && (
          <p className="mt-2 max-w-[36ch] text-[12.5px] text-[var(--color-muted-foreground)]">
            {blurb}
          </p>
        )}
      </div>
      <div className="tp-rise mt-3 flex items-center gap-2" style={{ ["--i" as string]: 1 }}>
        <span className="h-px flex-1 bg-[var(--color-gold)]/30" />
        <span className="h-1.5 w-1.5 rotate-45 bg-[var(--color-vermillion)]" />
        <span className="h-px flex-1 bg-[var(--color-gold)]/30" />
      </div>
    </div>
  );
}
