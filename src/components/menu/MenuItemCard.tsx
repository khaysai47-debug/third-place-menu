import type { MenuItem } from "@/data/menu";
import { PlusIcon, SkewerFlameIcon, SmokeMotif } from "./Icons";

interface Props {
  item: MenuItem;
  variant?: "feature" | "compact" | "row";
  onAdd: (item: MenuItem) => void;
}

const tagColor = (tag: string) => {
  switch (tag) {
    case "Spicy":
    case "Mala":
      return "bg-[var(--color-vermillion)]/15 text-[var(--color-vermillion)] border-[var(--color-vermillion)]/30";
    case "Seafood":
      return "bg-sky-500/10 text-sky-800 border-sky-700/20";
    case "Vegetable":
      return "bg-emerald-700/10 text-emerald-900 border-emerald-800/20";
    case "Meat":
    default:
      return "bg-[var(--color-gold)]/15 text-[var(--color-ink)] border-[var(--color-gold)]/40";
  }
};

function Price({ value }: { value?: number }) {
  if (value === undefined) {
    return (
      <span className="font-display text-[13px] leading-none text-[var(--color-ink)]/55 italic">
        Price · ask staff
      </span>
    );
  }
  return (
    <span className="font-display text-[20px] leading-none text-[var(--color-vermillion)]">
      ฿{value}
    </span>
  );
}

function AddButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  if (disabled) {
    return (
      <span className="h-9 px-2.5 rounded-full bg-[var(--color-ink)]/15 text-[var(--color-ink)]/55 flex items-center justify-center text-[10px] uppercase tracking-[0.18em] border border-[var(--color-ink)]/15">
        Sold out
      </span>
    );
  }
  return (
    <button
      onClick={onClick}
      aria-label="Add to cart"
      className="h-9 w-9 rounded-full bg-[var(--color-ink)] text-[var(--color-cream)] flex items-center justify-center shadow-[0_6px_14px_-6px_oklch(0_0_0/0.6)] active:scale-95 transition border border-[var(--color-gold)]/30 hover:bg-[var(--color-vermillion)]"
    >
      <PlusIcon className="h-4 w-4" />
    </button>
  );
}

function Placeholder({ item }: { item: MenuItem }) {
  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-[var(--color-charcoal-soft)] to-[var(--color-ink)]">
      <SmokeMotif className="absolute inset-x-0 bottom-0 w-full text-[var(--color-gold)]/30" />
      <SkewerFlameIcon className="absolute right-2 bottom-2 h-10 w-10 text-[var(--color-gold-soft)]/70" />
      <span className="absolute top-2 left-2 text-[10px] tracking-[0.2em] uppercase text-[var(--color-gold-soft)]/70">
        {item.category.replace("-", " ")}
      </span>
    </div>
  );
}

export function MenuItemCard({ item, variant = "compact", onAdd }: Props) {
  const soldOutClass = item.available ? "" : " opacity-70 saturate-[0.85]";

  if (variant === "feature") {
    return (
      <article
        className={`relative paper-grain rounded-2xl border border-[var(--color-gold)]/30 overflow-hidden shadow-[0_24px_50px_-30px_oklch(0_0_0/0.9)]${soldOutClass}`}
      >
        <div className="grid grid-cols-5">
          <div className="col-span-2 relative aspect-square">
            <Placeholder item={item} />
          </div>
          <div className="col-span-3 p-4 flex flex-col">
            <div className="flex items-start gap-2">
              {item.popular && (
                <span className="text-[10px] uppercase tracking-[0.2em] bg-[var(--color-vermillion)] text-[var(--color-cream)] px-1.5 py-0.5 rounded-sm">
                  Best
                </span>
              )}
              <div className="flex flex-wrap gap-1">
                {item.tags?.slice(0, 2).map((t) => (
                  <span
                    key={t}
                    className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${tagColor(t)}`}
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <h3 className="mt-2 font-display text-[20px] leading-tight text-[var(--color-ink)]">
              {item.nameEn}
            </h3>
            <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-ink)]/70 line-clamp-3">
              {item.descriptionEn}
            </p>
            <div className="mt-auto pt-3 flex items-end justify-between">
              <div>
                <Price value={item.price} />
                <p className="text-[10px] uppercase tracking-wider text-[var(--color-ink)]/60 mt-0.5">
                  {item.unit}
                </p>
              </div>
              <AddButton onClick={() => onAdd(item)} disabled={!item.available} />
            </div>
          </div>
        </div>
      </article>
    );
  }

  if (variant === "row") {
    // Skewer-style compact row, premium printed menu vibe
    return (
      <article
        className={`paper-grain rounded-xl border border-[var(--color-gold)]/25 px-3.5 py-3 flex items-center gap-3${soldOutClass}`}
      >
        <div className="h-11 w-11 rounded-lg bg-[var(--color-ink)] text-[var(--color-gold-soft)] flex items-center justify-center shrink-0">
          <SkewerFlameIcon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="font-display text-[16px] text-[var(--color-ink)] truncate">
              {item.nameEn}
            </h4>
            <span className="flex-1 mx-1 border-b border-dotted border-[var(--color-ink)]/25 translate-y-[-3px]" />
            <Price value={item.price} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--color-ink)]/65">
            <span className="uppercase tracking-wider">{item.unit}</span>
            {item.tags?.slice(0, 2).map((t) => (
              <span key={t} className={`px-1.5 py-px rounded-sm border text-[10px] ${tagColor(t)}`}>
                {t}
              </span>
            ))}
          </div>
        </div>
        <AddButton onClick={() => onAdd(item)} disabled={!item.available} />
      </article>
    );
  }

  // compact
  return (
    <article
      className={`paper-grain rounded-xl border border-[var(--color-gold)]/30 overflow-hidden${soldOutClass}`}
    >
      <div className="flex">
        <div className="relative h-[104px] w-[104px] shrink-0">
          <Placeholder item={item} />
        </div>
        <div className="flex-1 p-3 flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <h4 className="font-display text-[16px] leading-tight text-[var(--color-ink)]">
              {item.nameEn}
            </h4>
            {item.popular && (
              <span className="text-[9px] uppercase tracking-[0.18em] bg-[var(--color-vermillion)] text-[var(--color-cream)] px-1.5 py-0.5 rounded-sm">
                ★
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] leading-snug text-[var(--color-ink)]/65 line-clamp-2">
            {item.descriptionEn}
          </p>
          <div className="mt-auto pt-2 flex items-end justify-between">
            <div className="flex flex-col">
              <Price value={item.price} />
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-ink)]/55">
                {item.unit}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {item.tags?.slice(0, 1).map((t) => (
                <span
                  key={t}
                  className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${tagColor(t)}`}
                >
                  {t}
                </span>
              ))}
              <AddButton onClick={() => onAdd(item)} disabled={!item.available} />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
