import { useEffect, useRef, useState } from "react";
import type { MenuItem } from "@/data/menu";
import { MinusIcon, PlusIcon } from "./Icons";

interface Props {
  item: MenuItem;
  variant?: "feature" | "list";
  /** Quantity already in the cart. 0 collapses the control back to "add". */
  qty: number;
  onAdd: (item: MenuItem) => void;
  onIncrease: (id: string) => void;
  onDecrease: (id: string) => void;
}

const tagClass = (tag: string) => {
  switch (tag) {
    case "Spicy":
    case "Mala":
      return "border-[var(--color-vermillion)]/35 bg-[var(--color-vermillion)]/12 text-[var(--color-vermillion)]";
    case "Seafood":
      return "border-sky-800/25 bg-sky-600/10 text-sky-900";
    case "Vegetable":
      return "border-emerald-900/25 bg-emerald-700/10 text-emerald-900";
    default:
      return "border-[var(--color-gold)]/55 bg-[var(--color-gold)]/20 text-[var(--color-ink)]/80";
  }
};

function Price({ value, size = "sm" }: { value?: number; size?: "sm" | "lg" }) {
  if (value === undefined) {
    // Short on purpose: this sits in the price column of the list row, where
    // a longer phrase is clipped by the leader.
    return (
      <span className="whitespace-nowrap text-[12.5px] italic leading-none text-[var(--color-ink)]/55">
        Ask staff
      </span>
    );
  }
  return (
    <span
      className={`tp-num leading-none text-[var(--color-ink)] ${
        size === "lg" ? "text-[19px]" : "text-[15px]"
      }`}
    >
      ฿{value.toLocaleString("en-US")}
    </span>
  );
}

/**
 * Add control. At qty 0 it is a single ink button; from qty 1 it becomes a
 * stepper in place, so the whole quantity conversation happens on the card
 * the customer is already looking at instead of down in the cart.
 */
function AddControl({ item, qty, onAdd, onIncrease, onDecrease }: Omit<Props, "variant">) {
  // Remounting the figure on every change replays the bump, which is the
  // acknowledgement that the tap registered.
  const bumpKey = qty;

  if (!item.available) {
    return (
      <span className="flex h-10 shrink-0 items-center rounded-full border border-[var(--color-ink)]/15 bg-[var(--color-ink)]/10 px-3 text-[10px] uppercase tracking-[0.16em] text-[var(--color-ink)]/55">
        售罄
      </span>
    );
  }

  if (qty > 0) {
    return (
      <div className="flex h-10 shrink-0 items-center gap-1 rounded-full border border-[var(--color-gold)]/35 bg-[var(--color-ink)] px-1 text-[var(--color-cream)] shadow-[0_8px_18px_-10px_oklch(0_0_0/0.8)] animate-in zoom-in-95 fade-in duration-200 motion-reduce:animate-none">
        <button
          onClick={() => onDecrease(item.id)}
          aria-label={`Remove one ${item.nameEn}`}
          className="flex h-8 w-8 items-center justify-center rounded-full transition-[transform,background-color] duration-150 ease-[var(--ease-fluid)] active:scale-90 hover:bg-[var(--color-cream)]/12 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-gold)]"
        >
          <MinusIcon className="h-3.5 w-3.5" />
        </button>
        <span key={bumpKey} className="tp-num tp-bump w-5 text-center text-[14px] tabular-nums">
          {qty}
        </span>
        <button
          onClick={() => onIncrease(item.id)}
          aria-label={`Add another ${item.nameEn}`}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-vermillion)] transition-[transform,background-color] duration-150 ease-[var(--ease-fluid)] active:scale-90 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-gold)]"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => onAdd(item)}
      aria-label={`Add ${item.nameEn} to your order`}
      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--color-gold)]/35 bg-[var(--color-ink)] text-[var(--color-cream)] shadow-[0_8px_18px_-10px_oklch(0_0_0/0.8)] transition-[transform,background-color] duration-150 ease-[var(--ease-fluid)] active:scale-90 hover:bg-[var(--color-vermillion)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] before:absolute before:-inset-1 before:content-['']"
    >
      <PlusIcon className="h-4 w-4" />
    </button>
  );
}

/** Fires a single vermillion ring on the card the moment it enters the cart. */
function useAddPulse(qty: number) {
  const [pulsing, setPulsing] = useState(false);
  const previous = useRef(qty);

  useEffect(() => {
    const wasEmpty = previous.current === 0;
    previous.current = qty;
    if (!wasEmpty || qty === 0) return;
    setPulsing(true);
    const t = window.setTimeout(() => setPulsing(false), 640);
    return () => window.clearTimeout(t);
  }, [qty]);

  return pulsing;
}

export function MenuItemCard({
  item,
  variant = "list",
  qty,
  onAdd,
  onIncrease,
  onDecrease,
}: Props) {
  const pulsing = useAddPulse(qty);
  const inCart = qty > 0;
  const dim = item.available ? "" : " opacity-65 saturate-[0.8]";

  const ring = pulsing ? (
    <span
      aria-hidden
      className="tp-ring pointer-events-none absolute -inset-px rounded-[inherit] border-2 border-[var(--color-vermillion)]"
    />
  ) : null;

  // A gold hairline on the left edge marks everything already on the order,
  // so the customer can scan what they have picked without opening the cart.
  const cartEdge = inCart
    ? " before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:bg-[var(--color-vermillion)] before:content-['']"
    : "";

  if (variant === "feature") {
    return (
      <article
        className={`relative overflow-hidden rounded-[20px] border border-[var(--color-gold)]/35 paper-grain shadow-[0_30px_60px_-34px_oklch(0_0_0/0.95)]${dim}${cartEdge}`}
      >
        {ring}
        <div className="h-[3px] bg-gradient-to-r from-[var(--color-vermillion)] via-[var(--color-gold)]/60 to-transparent" />
        <div className="p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="tp-num text-[10px] uppercase tracking-[0.26em] text-[var(--color-ink)]/45">
              {item.id}
            </span>
            {item.popular && (
              <span className="rounded-sm border border-[var(--color-vermillion)]/45 bg-[var(--color-vermillion)]/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.2em] text-[var(--color-vermillion)]">
                招牌 · Best seller
              </span>
            )}
          </div>

          <h3 className="tp-display mt-2.5 text-[27px] font-semibold text-[var(--color-ink)]">
            {item.nameEn}
          </h3>

          {item.tags && item.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className={`rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] ${tagClass(t)}`}
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-ink)]/75">
            {item.descriptionEn}
          </p>

          <div className="mt-5 flex items-end justify-between gap-3 border-t border-dashed border-[var(--color-ink)]/20 pt-4">
            <span className="flex items-baseline gap-2">
              <Price value={item.price} size="lg" />
              {item.unit && (
                <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-ink)]/60">
                  {item.unit}
                </span>
              )}
            </span>
            <AddControl
              item={item}
              qty={qty}
              onAdd={onAdd}
              onIncrease={onIncrease}
              onDecrease={onDecrease}
            />
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      className={`relative flex items-center gap-3.5 overflow-hidden rounded-2xl border border-[var(--color-gold)]/25 paper-grain px-4 py-3.5${dim}${cartEdge}`}
    >
      {ring}
      <div className="min-w-0 flex-1">
        {/* The name owns its own line so it can wrap in full — a truncated
            dish name is the one thing a menu may never do. */}
        <h4 className="tp-display text-[17px] font-semibold text-[var(--color-ink)]">
          <span className="tp-num mr-1.5 align-[3px] text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink)]/40">
            {item.id}
          </span>
          {item.nameEn}
        </h4>
        <p className="mt-1 line-clamp-1 text-[12px] leading-snug text-[var(--color-ink)]/65">
          {item.descriptionEn}
        </p>
        {/* Printed bill-of-fare line. The leader rides the metadata row, not
            the name row, so it can never be crushed by a long dish name. */}
        <div className="mt-1.5 flex items-center gap-1.5 overflow-hidden">
          {item.unit && (
            <span className="shrink-0 text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-ink)]/55">
              {item.unit}
            </span>
          )}
          {/* One tag only on this row: unit + two tags + leader + price
              overruns the text column at 375px and the price spills under
              the stepper. The feature card, which has a full row to itself,
              still shows three. */}
          {item.tags?.slice(0, 1).map((t) => (
            <span
              key={t}
              className={`shrink-0 rounded-sm border px-1.5 py-px text-[9.5px] uppercase tracking-[0.1em] ${tagClass(t)}`}
            >
              {t}
            </span>
          ))}
          <span
            aria-hidden
            className="mb-[3px] min-w-4 flex-1 border-b border-dotted border-[var(--color-ink)]/30"
          />
          <span className="shrink-0">
            <Price value={item.price} />
          </span>
        </div>
      </div>

      <AddControl
        item={item}
        qty={qty}
        onAdd={onAdd}
        onIncrease={onIncrease}
        onDecrease={onDecrease}
      />
    </article>
  );
}
