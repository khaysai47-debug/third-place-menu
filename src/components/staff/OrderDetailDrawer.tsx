import { useEffect } from "react";
import type { StaffOrder } from "@/data/staffOrders";
import { NEXT_ACTION, STATUS_META } from "./orderStatus";
import { orderLocation } from "./StaffOrderCard";

interface Props {
  order: StaffOrder;
  onAdvance: (orderId: string) => void;
  onClose: () => void;
}

export function OrderDetailDrawer({ order, onAdvance, onClose }: Props) {
  const meta = STATUS_META[order.status];
  const action = NEXT_ACTION[order.status];
  const location = orderLocation(order);
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative mx-auto w-full max-w-[680px] bg-[var(--color-charcoal-soft)] rounded-t-3xl border-t border-x border-[var(--color-gold)]/20 max-h-[92vh] flex flex-col overflow-hidden shadow-[0_-20px_60px_-20px_oklch(0_0_0/0.7)]">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-[var(--color-gold)]/15 shrink-0">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] font-medium text-[var(--color-gold-soft)]/70 tabular-nums">
              {order.orderId} · {order.time} · {totalQty} items
            </p>
            <div className="mt-1.5 flex items-center gap-3">
              <h2 className="font-display text-[28px] leading-none text-[var(--color-cream)]">
                {location.big}
                <span className="ml-2 font-sans text-[13px] tracking-[0.08em] text-[var(--color-cream)]/50">
                  {location.zh}
                </span>
              </h2>
              <span className="shrink-0 pl-2 pr-2.5 py-1 rounded-full border border-[var(--color-gold)]/25 flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] text-[var(--color-cream)]/80">
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                {meta.labelZh} {meta.labelEn}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close 關閉"
            className="h-11 w-11 shrink-0 rounded-full bg-[var(--color-cream)]/10 text-[var(--color-cream)]/60 flex items-center justify-center text-[18px] hover:bg-[var(--color-cream)]/20 transition"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-6">
          {/* Items */}
          <section>
            <h3 className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-cream)]/45 mb-3">
              Items · 餐點
            </h3>
            <ul className="space-y-3">
              {order.items.map((item) => (
                <li key={item.name} className="flex items-baseline gap-3">
                  <span className="w-9 shrink-0 text-right font-semibold tabular-nums text-[16px] text-[var(--color-vermillion)]">
                    {item.quantity}
                    <span className="ml-0.5 text-[11px] font-normal text-[var(--color-cream)]/35">
                      ×
                    </span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[16px] leading-snug text-[var(--color-cream)] truncate">
                      {item.name}
                    </p>
                    <p className="text-[12px] text-[var(--color-cream)]/40 tabular-nums">
                      ฿{item.unitPrice.toLocaleString("en-US")} each
                    </p>
                  </div>
                  <span className="shrink-0 font-display text-[16px] text-[var(--color-gold-soft)] tabular-nums">
                    ฿{(item.quantity * item.unitPrice).toLocaleString("en-US")}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Notes */}
          {order.notes && (
            <section>
              <h3 className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-cream)]/45 mb-3">
                Notes · 備註
              </h3>
              <p className="rounded-xl bg-[var(--color-ink)] border border-[var(--color-gold)]/20 px-4 py-3 text-[15px] leading-relaxed text-[var(--color-cream)]/85">
                {order.notes}
              </p>
            </section>
          )}

          {/* Total */}
          <div className="flex justify-between items-baseline pt-3 border-t border-[var(--color-gold)]/15">
            <span className="text-[11px] uppercase tracking-[0.18em] font-medium text-[var(--color-cream)]/50">
              Total · 合計
            </span>
            <span className="font-display text-[24px] leading-none text-[var(--color-vermillion)] tabular-nums">
              <span className="mr-0.5 text-[15px]">฿</span>
              {order.totalPrice.toLocaleString("en-US")}
            </span>
          </div>
        </div>

        {/* Action */}
        <div className="px-5 py-4 border-t border-[var(--color-gold)]/15 shrink-0">
          {action ? (
            <button
              onClick={() => onAdvance(order.orderId)}
              className={`w-full h-14 rounded-xl text-[16px] font-semibold tracking-[0.02em] active:scale-[0.98] transition shadow-[0_10px_20px_-12px_oklch(0_0_0/0.7)] ${action.buttonClass}`}
            >
              {action.labelZh} · {action.labelEn}
            </button>
          ) : (
            <p className="w-full h-14 rounded-xl bg-[var(--color-cream)]/5 border border-[var(--color-cream)]/10 flex items-center justify-center gap-2 text-[14px] tracking-[0.06em] text-[var(--color-cream)]/50">
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
              {meta.labelZh} · {meta.labelEn}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
