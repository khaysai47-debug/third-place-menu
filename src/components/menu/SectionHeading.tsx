interface Props {
  eyebrow?: string;
  title: string;
  zh?: string;
  blurb?: string;
}

export function SectionHeading({ eyebrow, title, zh, blurb }: Props) {
  return (
    <div className="px-5 mt-8 mb-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          {eyebrow && (
            <p className="text-[11px] tracking-[0.3em] uppercase text-[var(--color-vermillion)]">{eyebrow}</p>
          )}
          <h2 className="font-display text-[28px] leading-none mt-1 text-[var(--color-cream)]">
            {title}
          </h2>
        </div>
        {zh && (
          <span className="font-display text-[26px] text-[var(--color-gold)]/80">{zh}</span>
        )}
      </div>
      {blurb && (
        <p className="mt-2 text-[12.5px] text-[var(--color-muted-foreground)] max-w-[36ch]">{blurb}</p>
      )}
      <div className="mt-3 flex items-center gap-2">
        <span className="h-px flex-1 bg-[var(--color-gold)]/30" />
        <span className="h-1.5 w-1.5 rotate-45 bg-[var(--color-vermillion)]" />
        <span className="h-px flex-1 bg-[var(--color-gold)]/30" />
      </div>
    </div>
  );
}
