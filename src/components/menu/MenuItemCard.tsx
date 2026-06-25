import type { MenuItem } from "@/data/menu";
import { PlusIcon, SkewerFlameIcon } from "./Icons";

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
    case "Signature":
      return "bg-[var(--color-gold)]/22 text-[var(--color-ink)] border-[var(--color-gold)]/60";
    case "Meat":
    default:
      return "bg-[var(--color-gold)]/20 text-[var(--color-ink)] border-[var(--color-gold)]/50";
  }
};

function Price({ value }: { value?: number }) {
  if (value === undefined) {
    return (
      <span className="text-[13px] leading-none text-[var(--color-ink)]/50 italic">
        Price · ask staff
      </span>
    );
  }
  return (
    <span className="staff-num text-[15px] leading-none text-[var(--color-ink)]">
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


export function MenuItemCard({ item, variant = "compact", onAdd }: Props) {
  const soldOutClass = item.available ? "" : " opacity-70 saturate-[0.85]";

  if (variant === "feature") {
    return (
      <article
        className={`relative paper-grain rounded-2xl border border-[var(--color-gold)]/30 overflow-hidden shadow-[0_24px_50px_-30px_oklch(0_0_0/0.9)]${soldOutClass}`}
      >
        {/* Warm accent line — signals a featured card without needing a photo */}
        <div className="h-[2px] bg-gradient-to-r from-[var(--color-vermillion)]/50 via-[var(--color-gold)]/40 to-transparent" />
        <div className="p-5 flex flex-col">
          {/* Eyebrow row: category on left, popular badge on right */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-ink)]/55">
              {item.category.replace("-", " ")}
            </span>
            {item.popular && (
              <span className="text-[9px] uppercase tracking-[0.18em] bg-[var(--color-vermillion)]/10 text-[var(--color-vermillion)] border border-[var(--color-vermillion)]/40 px-1.5 py-0.5 rounded-sm">
                Best Seller
              </span>
            )}
          </div>

          {/* Name — leads the card */}
          <h3 className="mt-2 font-display font-semibold text-[22px] leading-[1.15] text-[var(--color-ink)]">
            {item.nameEn}
          </h3>

          {/* Tags below name, supporting role */}
          {item.tags && item.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {item.tags.slice(0, 2).map((t) => (
                <span
                  key={t}
                  className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${tagColor(t)}`}
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* Description */}
          <p className="mt-2.5 text-[13px] leading-relaxed text-[var(--color-ink)]/65 line-clamp-3">
            {item.descriptionEn}
          </p>

          {/* Bottom: price + unit inline on left, add button on right */}
          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <Price value={item.price} />
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-ink)]/45">
                {item.unit}
              </span>
            </div>
            <AddButton onClick={() => onAdd(item)} disabled={!item.available} />
          </div>
        </div>
      </article>
    );
  }

  if (variant === "row") {
    // Printed-menu row: name ···dotted leader··· price
    return (
      <article
        className={`paper-grain rounded-xl border border-[var(--color-gold)]/25 px-3.5 py-3 flex items-center gap-3${soldOutClass}`}
      >
        <div className="h-11 w-11 rounded-lg bg-[var(--color-ink)] text-[var(--color-gold-soft)] flex items-center justify-center shrink-0">
          <SkewerFlameIcon className="h-6 w-6" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="font-display font-semibold text-[16px] text-[var(--color-ink)] truncate">
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

  // compact — flat row layout, no large image block
  return (
    <article
      className={`paper-grain rounded-xl border border-[var(--color-gold)]/25 px-3.5 py-3 flex items-center gap-3${soldOutClass}`}
    >
      {/* Small icon tile, same height family as the row variant */}
      <div className="h-11 w-11 rounded-xl bg-[var(--color-ink)] text-[var(--color-gold-soft)] flex items-center justify-center shrink-0">
        <SkewerFlameIcon className="h-6 w-6" />
      </div>

      {/* Text block */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-display font-semibold text-[16px] leading-tight text-[var(--color-ink)]">
            {item.nameEn}
          </h4>
          {item.popular && (
            <span className="shrink-0 text-[9px] bg-[var(--color-vermillion)]/10 text-[var(--color-vermillion)] border border-[var(--color-vermillion)]/35 px-1.5 py-0.5 rounded-sm">
              ★
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-[var(--color-ink)]/55 line-clamp-1">
          {item.descriptionEn}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <Price value={item.price} />
          {item.unit && (
            <span className="text-[10px] uppercase tracking-wider text-[var(--color-ink)]/40">
              {item.unit}
            </span>
          )}
        </div>
      </div>

      <AddButton onClick={() => onAdd(item)} disabled={!item.available} />
    </article>
  );
}
