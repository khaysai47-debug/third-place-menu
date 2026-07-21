import { useEffect, useRef, useState } from "react";
import type { MenuItem } from "@/data/menu";
import { MinusIcon, PlusIcon, SkewerFlameIcon } from "./Icons";

interface Props {
  item: MenuItem;
  variant?: "feature" | "compact" | "row";
  /** Quantity already in the cart. 0 collapses the control back to "add". */
  qty: number;
  onAdd: (item: MenuItem) => void;
  onIncrease: (id: string) => void;
  onDecrease: (id: string) => void;
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
      <span className="text-[13px] italic leading-none text-[var(--color-ink)]/50">
        Price · ask staff
      </span>
    );
  }
  return (
    <span className="tp-num text-[15px] leading-none text-[var(--color-ink)]">
      ฿{value.toLocaleString("en-US")}
    </span>
  );
}

/**
 * Add control. At qty 0 it is the approved ink circle; from qty 1 it becomes
 * a stepper in place, so the whole quantity conversation happens on the card
 * the customer is already looking at instead of down in the cart.
 *
 * Both states are 36px tall — the same height as the original add button —
 * so a card does not change height when an item enters the order.
 */
function AddControl({ item, qty, onAdd, onIncrease, onDecrease }: Omit<Props, "variant">) {
  if (!item.available) {
    return (
      <span className="flex h-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-ink)]/15 bg-[var(--color-ink)]/15 px-2.5 text-[10px] uppercase tracking-[0.18em] text-[var(--color-ink)]/55">
        Sold out
      </span>
    );
  }

  if (qty > 0) {
    return (
      <div className="flex h-9 shrink-0 items-center gap-0.5 rounded-full border border-[var(--color-gold)]/30 bg-[var(--color-ink)] px-1 text-[var(--color-cream)] shadow-[0_6px_14px_-6px_oklch(0_0_0/0.6)] animate-in fade-in zoom-in-95 duration-200 motion-reduce:animate-none">
        <button
          onClick={() => onDecrease(item.id)}
          aria-label={`Remove one ${item.nameEn}`}
          className="relative flex h-7 w-7 items-center justify-center rounded-full transition-[transform,background-color] duration-150 ease-[var(--ease-fluid)] hover:bg-[var(--color-cream)]/12 active:scale-90 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-gold)] before:absolute before:-inset-1.5 before:content-['']"
        >
          <MinusIcon className="h-3.5 w-3.5" />
        </button>
        {/* Remounting the figure on every change replays the bump, which is
            the acknowledgement that the tap registered. */}
        <span key={qty} className="tp-num tp-bump w-5 text-center text-[13px]">
          {qty}
        </span>
        <button
          onClick={() => onIncrease(item.id)}
          aria-label={`Add another ${item.nameEn}`}
          className="relative flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-vermillion)] transition-[transform,background-color] duration-150 ease-[var(--ease-fluid)] active:scale-90 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-gold)] before:absolute before:-inset-1.5 before:content-['']"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // Visual circle stays 36px; the transparent ::before lifts the hit area to
  // 44x44 without changing card layout or rhythm.
  return (
    <button
      onClick={() => onAdd(item)}
      aria-label={`Add ${item.nameEn} to your order`}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-gold)]/30 bg-[var(--color-ink)] text-[var(--color-cream)] shadow-[0_6px_14px_-6px_oklch(0_0_0/0.6)] transition-[transform,background-color] duration-150 ease-[var(--ease-fluid)] hover:bg-[var(--color-vermillion)] active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] before:absolute before:-inset-1 before:content-['']"
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
  variant = "compact",
  qty,
  onAdd,
  onIncrease,
  onDecrease,
}: Props) {
  const pulsing = useAddPulse(qty);
  const soldOutClass = item.available ? "" : " opacity-70 saturate-[0.85]";

  const ring = pulsing ? (
    <span
      aria-hidden
      className="tp-ring pointer-events-none absolute -inset-px z-10 rounded-[inherit] border-2 border-[var(--color-vermillion)]"
    />
  ) : null;

  // A vermillion hairline on the left edge marks everything already on the
  // order, so the customer can scan what they have picked without opening
  // the cart.
  const cartEdge =
    qty > 0
      ? " before:absolute before:inset-y-3 before:left-0 before:z-10 before:w-[3px] before:rounded-r-full before:bg-[var(--color-vermillion)] before:content-['']"
      : "";

  const control = (
    <AddControl
      item={item}
      qty={qty}
      onAdd={onAdd}
      onIncrease={onIncrease}
      onDecrease={onDecrease}
    />
  );

  if (variant === "feature") {
    return (
      <article
        className={`paper-grain relative overflow-hidden rounded-2xl border border-[var(--color-gold)]/30 shadow-[0_24px_50px_-30px_oklch(0_0_0/0.9)]${soldOutClass}${cartEdge}`}
      >
        {ring}
        {/* Warm accent line — signals a featured card without needing a photo */}
        <div className="h-[2px] bg-gradient-to-r from-[var(--color-vermillion)]/50 via-[var(--color-gold)]/40 to-transparent" />
        <div className="flex flex-col p-5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-[0.2em] text-[var(--color-ink)]/70">
              {item.category.replace("-", " ")}
            </span>
            {item.popular && (
              <span className="rounded-sm border border-[var(--color-vermillion)]/40 bg-[var(--color-vermillion)]/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.18em] text-[var(--color-vermillion)]">
                Best Seller
              </span>
            )}
          </div>

          <h3 className="font-display mt-2 text-[22px] font-semibold leading-[1.15] text-[var(--color-ink)]">
            {item.nameEn}
          </h3>

          {item.tags && item.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {item.tags.slice(0, 2).map((t) => (
                <span
                  key={t}
                  className={`rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tagColor(t)}`}
                >
                  {t}
                </span>
              ))}
            </div>
          )}

          <p className="mt-2.5 line-clamp-3 text-[13px] leading-relaxed text-[var(--color-ink)]/75">
            {item.descriptionEn}
          </p>

          <div className="mt-4 flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <Price value={item.price} />
              <span className="text-[11px] uppercase tracking-wider text-[var(--color-ink)]/70">
                {item.unit}
              </span>
            </div>
            {control}
          </div>
        </div>
      </article>
    );
  }

  if (variant === "row") {
    // Printed-menu row: name ···dotted leader··· price
    return (
      <article
        className={`paper-grain relative flex items-center gap-3 overflow-hidden rounded-xl border border-[var(--color-gold)]/25 px-3.5 py-3${soldOutClass}${cartEdge}`}
      >
        {ring}
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[var(--color-ink)] text-[var(--color-gold-soft)]">
          <SkewerFlameIcon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="font-display truncate text-[16px] font-semibold text-[var(--color-ink)]">
              {item.nameEn}
            </h4>
            <span className="mx-1 min-w-2 flex-1 translate-y-[-3px] border-b border-dotted border-[var(--color-ink)]/25" />
            <Price value={item.price} />
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--color-ink)]/75">
            <span className="uppercase tracking-wider">{item.unit}</span>
            {item.tags?.slice(0, 2).map((t) => (
              <span key={t} className={`rounded-sm border px-1.5 py-px text-[10px] ${tagColor(t)}`}>
                {t}
              </span>
            ))}
          </div>
        </div>
        {control}
      </article>
    );
  }

  // compact — icon tile, name, description, price
  return (
    <article
      className={`paper-grain relative flex items-center gap-3 overflow-hidden rounded-xl border border-[var(--color-gold)]/25 px-3.5 py-3${soldOutClass}${cartEdge}`}
    >
      {ring}
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-ink)] text-[var(--color-gold-soft)]">
        <SkewerFlameIcon className="h-6 w-6" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-display text-[16px] font-semibold leading-tight text-[var(--color-ink)]">
            {item.nameEn}
          </h4>
          {item.popular && (
            <span className="shrink-0 rounded-sm border border-[var(--color-vermillion)]/35 bg-[var(--color-vermillion)]/10 px-1.5 py-0.5 text-[9px] text-[var(--color-vermillion)]">
              ★
            </span>
          )}
        </div>
        <p className="mt-0.5 line-clamp-1 text-[12px] leading-snug text-[var(--color-ink)]/70">
          {item.descriptionEn}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <Price value={item.price} />
          {item.unit && (
            <span className="text-[11px] uppercase tracking-wider text-[var(--color-ink)]/70">
              {item.unit}
            </span>
          )}
        </div>
      </div>

      {control}
    </article>
  );
}
