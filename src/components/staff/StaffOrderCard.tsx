import type { StaffOrder } from "@/lib/staffOrders";
import { NEXT_ACTION, PAYMENT_META, STATUS_META } from "./orderStatus";

interface Props {
  order: StaffOrder;
  updating?: boolean;
  onAdvance: (orderId: string) => void;
  onOpen: (orderId: string) => void;
}

export function orderLocation(order: StaffOrder): { big: string; num?: string; zh: string } {
  if (order.orderType === "dine_in") {
    return { big: "Table", num: order.tableNumber ?? "?", zh: "堂食" };
  }
  if (order.orderType === "pickup") {
    return { big: "Pickup", zh: "自取" };
  }
  return { big: "Delivery", zh: "外送" };
}

export function StaffOrderCard({ order, updating = false, onAdvance, onOpen }: Props) {
  const meta = STATUS_META[order.status];
  const payMeta = PAYMENT_META[order.paymentStatus];
  const action = NEXT_ACTION[order.status];
  const location = orderLocation(order);
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
  const cancelled = order.status === "cancelled";

  return (
    <article
      onClick={() => onOpen(order.orderId)}
      className={`paper-grain h-full rounded-2xl border border-[var(--color-gold)]/30 overflow-hidden flex flex-col shadow-[0_20px_40px_-25px_oklch(0_0_0/0.8)] cursor-pointer transition hover:border-[var(--color-gold)]/60 active:scale-[0.995] ${cancelled ? "opacity-60" : ""}`}
    >
      <div className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.18em] font-medium text-[var(--color-ink)]/50 tabular-nums">
              {order.orderId} · {order.time} · {totalQty} items
            </p>
            <h3 className="mt-1.5 font-display lining-nums text-[28px] leading-none text-[var(--color-ink)]">
              <span className="inline-flex items-baseline gap-2 leading-none">
                <span>{location.big}</span>
                {location.num !== undefined && (
                  <span className="relative -top-[1px] tabular-nums">{location.num}</span>
                )}
              </span>
              <span className="ml-2 font-sans text-[13px] tracking-[0.08em] text-[var(--color-ink)]/55">
                {location.zh}
              </span>
            </h3>
          </div>
          <div className="shrink-0 mt-0.5 flex flex-col items-end gap-1">
            <span
              className={`pl-2 pr-2.5 py-1 rounded-full border flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] ${meta.badgeClass}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
              {meta.labelZh} {meta.labelEn}
            </span>
            <span
              className={`pl-2 pr-2.5 py-1 rounded-full border flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] ${payMeta.badgeClass}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${payMeta.dotClass}`} />
              {payMeta.labelZh} {payMeta.labelEn}
              {order.paymentStatus === "paid" && order.paymentMethod
                ? ` · ${order.paymentMethod}`
                : ""}
            </span>
          </div>
        </div>
      </div>

      <ul className="px-4 py-3 border-t border-dotted border-[var(--color-ink)]/25 space-y-2 flex-1 min-h-[5.5rem] max-h-[7.5rem] overflow-y-auto [scrollbar-width:thin]">
        {order.items.map((item) => (
          <li
            key={item.id ?? item.name}
            className="flex items-baseline gap-2.5 text-[15px] leading-snug text-[var(--color-ink)]/90"
          >
            <span className="w-8 shrink-0 text-right font-semibold tabular-nums text-[var(--color-vermillion)]">
              {item.quantity}
              <span className="ml-0.5 text-[11px] font-normal text-[var(--color-ink)]/40">×</span>
            </span>
            <span className="truncate">{item.name}</span>
          </li>
        ))}
      </ul>

      <div className="mt-auto px-4 pb-4 pt-1 border-t border-dotted border-[var(--color-ink)]/25">
        <div className="flex items-baseline justify-between mb-3 pt-2.5">
          <span className="text-[11px] uppercase tracking-[0.18em] font-medium text-[var(--color-ink)]/50">
            Total · 合計
          </span>
          <span className="font-display text-[22px] leading-none text-[var(--color-vermillion)] tabular-nums">
            <span className="mr-0.5 text-[14px]">฿</span>
            {order.totalPrice.toLocaleString("en-US")}
          </span>
        </div>
        {action ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAdvance(order.orderId);
            }}
            disabled={updating}
            className={`w-full h-14 rounded-xl text-[16px] font-semibold tracking-[0.02em] active:scale-[0.98] transition shadow-[0_10px_20px_-12px_oklch(0_0_0/0.7)] disabled:opacity-60 disabled:cursor-wait disabled:active:scale-100 ${action.buttonClass}`}
          >
            {updating ? "更新中 · Updating…" : `${action.labelZh} · ${action.labelEn}`}
          </button>
        ) : (
          <p className="w-full h-14 rounded-xl bg-[var(--color-ink)]/5 border border-[var(--color-ink)]/10 flex items-center justify-center gap-2 text-[14px] tracking-[0.06em] text-[var(--color-ink)]/50">
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
            {meta.labelZh} · {meta.labelEn}
          </p>
        )}
      </div>
    </article>
  );
}
