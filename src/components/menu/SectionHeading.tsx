interface Props {
  title: string;
  zh: string;
  blurb?: string;
  /** Number of orderable items in this chapter. */
  count: number;
}

/** Chapter plate. Sits between the rail and the cards and re-enters on every
 *  chapter change, so the switch reads as turning a page. */
export function SectionHeading({ title, zh, blurb, count }: Props) {
  return (
    <div className="px-5 pt-9 pb-5">
      <div className="tp-rise flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="tp-display text-[34px] text-[var(--color-cream)]">{title}</h2>
          {blurb && (
            <p className="mt-2 max-w-[34ch] text-[12.5px] leading-relaxed text-[var(--color-cream)]/50">
              {blurb}
            </p>
          )}
        </div>
        <span
          aria-hidden
          className="tp-display shrink-0 text-[40px] leading-none text-[var(--color-gold)]/22"
        >
          {zh}
        </span>
      </div>
      <div className="tp-rise mt-5 flex items-center gap-3" style={{ ["--i" as string]: 1 }}>
        <span className="h-px flex-1 bg-gradient-to-r from-[var(--color-gold)]/45 to-transparent" />
        <span className="tp-num text-[10px] uppercase tracking-[0.24em] text-[var(--color-gold-soft)]/55">
          {count} {count === 1 ? "dish" : "dishes"}
        </span>
      </div>
    </div>
  );
}
