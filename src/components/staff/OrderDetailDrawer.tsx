import { useEffect } from "react";
import type { StaffOrder, StaffPaymentMethod } from "@/lib/staffOrders";
import { NEXT_ACTION, PAYMENT_META, STATUS_META } from "./orderStatus";
import { OrderLocationTitle } from "./StaffOrderCard";

interface Props {
  order: StaffOrder;
  updating?: boolean;
  paying?: boolean;
  updateError?: string | null;
  onAdvance: (orderId: string) => void;
  onMarkPaid: (orderId: string, method: StaffPaymentMethod) => void;
  onClose: () => void;
}

const METHOD_ZH: Record<StaffPaymentMethod, string> = {
  Cash: "現金",
  Transfer: "轉帳",
};

function formatPaidAt(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function OrderDetailDrawer({
  order,
  updating = false,
  paying = false,
  updateError = null,
  onAdvance,
  onMarkPaid,
  onClose,
}: Props) {
  const meta = STATUS_META[order.status];
  const payMeta = PAYMENT_META[order.paymentStatus];
  const action = NEXT_ACTION[order.status];
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
  const paid = order.paymentStatus === "paid";
  const paidAtLabel = order.paidAt ? formatPaidAt(order.paidAt) : null;
  const canTakePayment = !paid && !!order.airtableRecordId && order.status !== "cancelled";

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
              <h2>
                <OrderLocationTitle order={order} tone="cream" />
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
                <li key={item.id ?? item.name} className="flex items-baseline gap-3">
                  <span className="staff-num w-9 shrink-0 text-right font-semibold text-[16px] text-[var(--color-vermillion)]">
                    {item.quantity}
                    <span className="ml-0.5 text-[11px] font-normal text-[var(--color-cream)]/35">
                      ×
                    </span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[16px] leading-snug text-[var(--color-cream)] truncate">
                      {item.name}
                    </p>
                    <p className="staff-num text-[12px] text-[var(--color-cream)]/40">
                      ฿{item.unitPrice.toLocaleString("en-US")} each
                    </p>
                  </div>
                  <span className="staff-num shrink-0 text-[16px] text-[var(--color-gold-soft)]">
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

          {/* Delivery info */}
          {order.orderType === "delivery" && (
            <section>
              <h3 className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-cream)]/45 mb-3">
                Delivery · 外送
              </h3>
              <div className="rounded-xl bg-[var(--color-ink)] border border-[var(--color-gold)]/20 px-4 py-3 space-y-2 text-[14px]">
                {order.customerName && (
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-cream)]/50">Name</span>
                    <span className="text-[var(--color-cream)]">{order.customerName}</span>
                  </div>
                )}
                {order.customerPhone && (
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-cream)]/50">Phone</span>
                    <span className="staff-num text-[var(--color-cream)]">{order.customerPhone}</span>
                  </div>
                )}
                {order.deliveryAddress && (
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-cream)]/50 shrink-0">Address</span>
                    <span className="text-[var(--color-cream)] text-right">{order.deliveryAddress}</span>
                  </div>
                )}
                <div className="border-t border-[var(--color-gold)]/10 pt-2 space-y-1.5">
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-cream)]/50">Subtotal</span>
                    <span className="staff-num text-[var(--color-cream)]/75">฿{(order.subtotalPrice ?? 0).toLocaleString("en-US")}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-cream)]/50">Delivery fee</span>
                    <span className="staff-num text-[var(--color-cream)]/75">฿{(order.deliveryFee ?? 0).toLocaleString("en-US")}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-cream)]/50">Total</span>
                    <span className="staff-num text-[var(--color-vermillion)]">฿{order.totalPrice.toLocaleString("en-US")}</span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Total */}
          <div className="flex justify-between items-baseline pt-3 border-t border-[var(--color-gold)]/15">
            <span className="text-[11px] uppercase tracking-[0.18em] font-medium text-[var(--color-cream)]/50">
              Total · 合計
            </span>
            <span className="staff-num inline-flex items-baseline text-[24px] leading-none text-[var(--color-vermillion)]">
              <span className="mr-0.5 text-[15px]">฿</span>
              {order.totalPrice.toLocaleString("en-US")}
            </span>
          </div>

          {/* Payment */}
          <div className="flex justify-between items-center pt-3 border-t border-[var(--color-gold)]/15">
            <span className="text-[11px] uppercase tracking-[0.18em] font-medium text-[var(--color-cream)]/50">
              Payment · 付款
            </span>
            <span className="pl-2 pr-2.5 py-1 rounded-full border border-[var(--color-gold)]/25 flex items-center gap-1.5 text-[12px] font-medium tracking-[0.06em] text-[var(--color-cream)]/85">
              <span className={`h-1.5 w-1.5 rounded-full ${payMeta.dotClass}`} />
              {payMeta.labelZh} {payMeta.labelEn}
              {paid && order.paymentMethod
                ? ` · ${METHOD_ZH[order.paymentMethod]} ${order.paymentMethod}`
                : ""}
              {paid && paidAtLabel ? ` · ${paidAtLabel}` : ""}
            </span>
          </div>
        </div>

        {/* Action */}
        <div className="px-5 py-4 border-t border-[var(--color-gold)]/15 shrink-0 space-y-2">
          {updateError && (
            <p className="text-[13px] text-[var(--color-vermillion)] text-center">{updateError}</p>
          )}
          {canTakePayment && (
            <div className="flex gap-2">
              {(["Cash", "Transfer"] as StaffPaymentMethod[]).map((method) => (
                <button
                  key={method}
                  onClick={() => onMarkPaid(order.orderId, method)}
                  disabled={paying}
                  className="flex-1 h-12 rounded-xl border border-emerald-500/35 bg-emerald-500/10 text-emerald-300 text-[15px] font-semibold tracking-[0.02em] active:scale-[0.98] transition hover:bg-emerald-500/20 disabled:opacity-60 disabled:cursor-wait disabled:active:scale-100"
                >
                  {paying ? "更新中…" : `${METHOD_ZH[method]}已付 · Paid ${method}`}
                </button>
              ))}
            </div>
          )}
          {action ? (
            <button
              onClick={() => onAdvance(order.orderId)}
              disabled={updating}
              className={`w-full h-14 rounded-xl text-[16px] font-semibold tracking-[0.02em] active:scale-[0.98] transition shadow-[0_10px_20px_-12px_oklch(0_0_0/0.7)] disabled:opacity-60 disabled:cursor-wait disabled:active:scale-100 ${action.buttonClass}`}
            >
              {updating ? "更新中 · Updating…" : `${action.labelZh} · ${action.labelEn}`}
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
