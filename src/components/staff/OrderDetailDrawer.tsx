import { useEffect, useState } from "react";
import { isCancellableStatus } from "@/lib/orderRules";
import { fetchProofHistory, type ProofHistoryItem } from "@/lib/data/staffReadClient";
import type { StaffOrder, StaffPaymentMethod } from "@/lib/staffOrders";
import { AlertCircle, Bike, Copy, CreditCard, MapPin, MoreHorizontal, PackageX, Phone, PhoneOff, User, UserX } from "lucide-react";
import { getNextAction, PAYMENT_META, STATUS_META } from "./orderStatus";
import { OrderLocationTitle } from "./StaffOrderCard";

interface Props {
  order: StaffOrder;
  updating?: boolean;
  paying?: boolean;
  cancelling?: boolean;
  reviewing?: boolean;
  updateError?: string | null;
  onAdvance: (orderId: string) => void;
  onMarkPaid: (orderId: string, method: StaffPaymentMethod) => void;
  onCancelOrder: (orderId: string, reason: string) => void;
  onReviewProof: (
    orderId: string,
    proofId: string,
    decision: "approve" | "reject",
    reason?: string,
  ) => void;
  onClose: () => void;
}

const CANCEL_REASONS = [
  { reason: "Customer cancelled",      icon: UserX          },
  { reason: "No payment received",     icon: CreditCard     },
  { reason: "Cannot contact customer", icon: PhoneOff       },
  { reason: "Item unavailable",        icon: PackageX       },
  { reason: "Duplicate order",         icon: Copy           },
  { reason: "Wrong order",             icon: AlertCircle    },
  { reason: "Other",                   icon: MoreHorizontal },
];

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
  cancelling = false,
  reviewing = false,
  updateError = null,
  onAdvance,
  onMarkPaid,
  onCancelOrder,
  onReviewProof,
  onClose,
}: Props) {
  const meta = STATUS_META[order.status];
  const payMeta = PAYMENT_META[order.paymentStatus];
  const action = getNextAction(order);
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
  const paid = order.paymentStatus === "paid";
  const paidAtLabel = order.paidAt ? formatPaidAt(order.paidAt) : null;
  const canTakePayment = !paid && !!order.airtableRecordId && order.status !== "cancelled";
  const canCancel = isCancellableStatus(order.status) && !!order.airtableRecordId;
  const displayDeliveryFee = order.deliveryFee && order.deliveryFee > 0 ? order.deliveryFee : 30;

  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const proofStatus = order.paymentProofStatus; // "pending" | "approved" | "rejected"
  const proofPending = order.hasPaymentProof && proofStatus === "pending" && !!order.paymentProofId;

  // Full proof audit history — signed previews fetched on demand (only when the
  // drawer is open), never signed on the dashboard poll. Refetches when the
  // order's proof state changes (e.g. after an approve/reject reloads orders).
  const [history, setHistory] = useState<ProofHistoryItem[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  useEffect(() => {
    if (!order.hasPaymentProof) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    setHistoryError(false);
    fetchProofHistory(order.orderId).then(
      (data) => {
        if (!cancelled) setHistory(data.proofs);
      },
      () => {
        if (!cancelled) setHistoryError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [order.orderId, order.hasPaymentProof, order.paymentProofId, order.paymentProofStatus]);

  // Newest first for display; the last item is the current/latest proof.
  const historyNewestFirst = history ? [...history].reverse() : [];

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
                  <div className="grid grid-cols-[16px_110px_1fr] items-center gap-2">
                    <User size={12} className="text-[var(--color-cream)]/40" />
                    <span className="text-[var(--color-cream)]/50 uppercase tracking-[0.08em] text-[13px]">Name</span>
                    <span className="text-[var(--color-cream)] text-right">{order.customerName}</span>
                  </div>
                )}
                {order.customerPhone && (
                  <div className="grid grid-cols-[16px_110px_1fr] items-center gap-2">
                    <Phone size={12} className="text-[var(--color-cream)]/40" />
                    <span className="text-[var(--color-cream)]/50 uppercase tracking-[0.08em] text-[13px]">Phone</span>
                    <span className="staff-num text-[var(--color-cream)] text-right">{order.customerPhone}</span>
                  </div>
                )}
                {order.deliveryAddress && (
                  <div className="grid grid-cols-[16px_110px_1fr] items-center gap-2">
                    <MapPin size={12} className="text-[var(--color-cream)]/40" />
                    <span className="text-[var(--color-cream)]/50 uppercase tracking-[0.08em] text-[13px]">Address</span>
                    <span className="text-[var(--color-cream)] text-right">{order.deliveryAddress}</span>
                  </div>
                )}
                <div className="border-t border-[var(--color-gold)]/10 pt-2 space-y-1.5">
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-cream)]/50">Subtotal</span>
                    <span className="staff-num text-[var(--color-cream)]/75">฿{(order.subtotalPrice ?? 0).toLocaleString("en-US")}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-[var(--color-cream)]/50"><Bike size={12} className="shrink-0" />Delivery fee</span>
                    <span className="staff-num text-[var(--color-cream)]/75">฿{displayDeliveryFee.toLocaleString("en-US")}</span>
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

          {/* Payment proof review */}
          {order.hasPaymentProof && (
            <section className="pt-3 border-t border-[var(--color-gold)]/15">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-cream)]/45">
                  Payment Proof · 收據
                </h3>
                <span
                  className={`pl-2 pr-2.5 py-0.5 rounded-full border text-[11px] font-medium tracking-[0.06em] ${
                    proofStatus === "approved"
                      ? "border-emerald-600/40 bg-emerald-500/10 text-emerald-300"
                      : proofStatus === "rejected"
                        ? "border-[var(--color-vermillion)]/40 bg-[var(--color-vermillion)]/10 text-[var(--color-vermillion-text)]"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  }`}
                >
                  {proofStatus === "approved"
                    ? "已核准 Approved"
                    : proofStatus === "rejected"
                      ? "已拒絕 Rejected"
                      : "待審核 Pending"}
                </span>
              </div>

              {/* Audit history — every proof, newest first, signed on demand. */}
              {historyError ? (
                <p className="text-[12.5px] text-[var(--color-cream)]/45">
                  Couldn&apos;t load proof history — refresh to retry.
                </p>
              ) : history === null ? (
                <p className="text-[12.5px] text-[var(--color-cream)]/45">Loading proof history…</p>
              ) : historyNewestFirst.length === 0 ? (
                <p className="text-[12.5px] text-[var(--color-cream)]/45">No slip on file.</p>
              ) : (
                <div className="space-y-2">
                  {historyNewestFirst.map((p, i) => (
                    <div
                      key={p.id}
                      className="rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-ink)]/40 px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] text-[var(--color-cream)]/70">
                          {i === 0 ? "Latest" : "Earlier"} ·{" "}
                          <span
                            className={
                              p.status === "approved"
                                ? "text-emerald-300"
                                : p.status === "rejected"
                                  ? "text-[var(--color-vermillion-text)]"
                                  : "text-amber-300"
                            }
                          >
                            {p.status}
                          </span>
                        </span>
                        {/* Preview links are short-lived signed URLs minted per
                            fetch. A legacy proof (no private object) shows a
                            clear unavailable state — its old permanent public
                            link is never served to the client. */}
                        {p.proof_url ? (
                          <a
                            href={p.proof_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[12px] text-teal-300 hover:underline"
                          >
                            View slip
                          </a>
                        ) : (
                          <span className="text-[11px] text-[var(--color-cream)]/40">
                            {p.hasFile
                              ? "Preview unavailable — refresh"
                              : "Legacy proof preview unavailable"}
                          </span>
                        )}
                      </div>
                      {p.status === "rejected" && p.rejection_reason && (
                        <p className="mt-1 text-[12px] text-[var(--color-cream)]/55">
                          Reason: {p.rejection_reason}
                        </p>
                      )}
                      {p.reviewed_by && (
                        <p className="mt-0.5 text-[11px] text-[var(--color-cream)]/40">
                          reviewed by {p.reviewed_by}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {proofPending &&
                order.paymentProofId &&
                (showRejectForm ? (
                  <div className="mt-3 space-y-2">
                    <input
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Reason (required) · 拒絕原因"
                      className="w-full h-11 rounded-xl bg-[var(--color-ink)] border border-[var(--color-gold)]/25 px-3 text-[14px] text-[var(--color-cream)] placeholder:text-[var(--color-cream)]/35 focus:outline-none focus:border-[var(--color-gold)]/50"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setShowRejectForm(false);
                          setRejectReason("");
                        }}
                        className="flex-1 h-11 rounded-xl border border-[var(--color-gold)]/20 text-[var(--color-cream)]/60 text-[14px] font-medium hover:border-[var(--color-gold)]/40 transition"
                      >
                        返回 · Back
                      </button>
                      <button
                        onClick={() => {
                          if (rejectReason.trim())
                            onReviewProof(
                              order.orderId,
                              order.paymentProofId!,
                              "reject",
                              rejectReason.trim(),
                            );
                        }}
                        disabled={!rejectReason.trim() || reviewing}
                        className="flex-1 h-11 rounded-xl border border-[var(--color-vermillion)]/40 bg-[var(--color-vermillion)]/10 text-[var(--color-vermillion-text)] text-[14px] font-semibold hover:bg-[var(--color-vermillion)]/20 transition disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {reviewing ? "處理中…" : "確認拒絕 · Reject"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setShowRejectForm(true)}
                      disabled={reviewing}
                      className="flex-1 h-12 rounded-xl border border-[var(--color-vermillion)]/35 bg-[var(--color-vermillion)]/8 text-[var(--color-vermillion-text)] text-[14px] font-semibold active:scale-[0.98] transition hover:bg-[var(--color-vermillion)]/16 disabled:opacity-50"
                    >
                      拒絕 · Reject
                    </button>
                    <button
                      onClick={() => onReviewProof(order.orderId, order.paymentProofId!, "approve")}
                      disabled={reviewing}
                      className="flex-1 h-12 rounded-xl border border-emerald-500/40 bg-emerald-500/12 text-emerald-300 text-[14px] font-semibold active:scale-[0.98] transition hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-wait"
                    >
                      {reviewing ? "處理中…" : "核准付款 · Approve"}
                    </button>
                  </div>
                ))}
            </section>
          )}

          {/* Cancellation info */}
          {order.status === "cancelled" && (order.cancellationReason || order.cancelledAt) && (
            <div className="flex justify-between items-start pt-3 border-t border-[var(--color-gold)]/15">
              <span className="text-[11px] uppercase tracking-[0.18em] font-medium text-[var(--color-cream)]/50 shrink-0 mr-3">
                Cancelled · 取消
              </span>
              <div className="text-right space-y-0.5">
                {order.cancellationReason && (
                  <p className="text-[13px] text-[var(--color-cream)]/80">{order.cancellationReason}</p>
                )}
                {order.cancelledAt && (
                  <p className="text-[11px] text-[var(--color-cream)]/45 tabular-nums">
                    {formatPaidAt(order.cancelledAt)}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Action */}
        <div className="px-5 py-4 border-t border-[var(--color-gold)]/15 shrink-0 space-y-2">
          {updateError && (
            <p className="text-[13px] text-[var(--color-vermillion)] text-center">{updateError}</p>
          )}
          {/* Manual payment is CASH ONLY. Transfer is confirmed by approving
              the customer's payment slip (the proof section above) — there is
              no manual Transfer button, and the server refuses one. */}
          {canTakePayment && (
            <button
              onClick={() => onMarkPaid(order.orderId, "Cash")}
              disabled={paying}
              className="w-full h-12 rounded-xl border border-emerald-500/35 bg-emerald-500/10 text-emerald-300 text-[15px] font-semibold tracking-[0.02em] active:scale-[0.98] transition hover:bg-emerald-500/20 disabled:opacity-60 disabled:cursor-wait disabled:active:scale-100"
            >
              {paying ? "更新中…" : `${METHOD_ZH.Cash}已付 · Paid Cash`}
            </button>
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
          {canCancel && (
            showCancelForm ? (
              <div className="space-y-2 pt-1">
                <p className="text-[11px] uppercase tracking-[0.14em] font-medium text-[var(--color-cream)]/40">
                  Select reason · 取消原因
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {CANCEL_REASONS.map(({ reason, icon: Icon }, i) => (
                    <button
                      key={reason}
                      onClick={() => setCancelReason(reason)}
                      className={[
                        "min-h-9 px-3 py-2 rounded-xl text-[12px] font-medium leading-tight text-left transition border flex items-center gap-2",
                        i === CANCEL_REASONS.length - 1 ? "col-span-2" : "",
                        cancelReason === reason
                          ? "bg-[var(--color-vermillion)]/15 border-[var(--color-vermillion)]/55 text-[var(--color-cream)]"
                          : "bg-[var(--color-ink)]/50 border-[var(--color-gold)]/15 text-[var(--color-cream)]/50 hover:border-[var(--color-gold)]/30 hover:text-[var(--color-cream)]/80",
                      ].join(" ")}
                    >
                      <Icon size={12} className="shrink-0 opacity-75" />
                      {reason}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 pt-0.5">
                  <button
                    onClick={() => { setShowCancelForm(false); setCancelReason(""); }}
                    className="flex-1 h-11 rounded-xl border border-[var(--color-gold)]/20 text-[var(--color-cream)]/60 text-[14px] font-medium hover:border-[var(--color-gold)]/40 transition"
                  >
                    返回 · Back
                  </button>
                  <button
                    onClick={() => { if (cancelReason) onCancelOrder(order.orderId, cancelReason); }}
                    disabled={!cancelReason || cancelling}
                    className="flex-1 h-11 rounded-xl border border-[var(--color-vermillion)]/40 bg-[var(--color-vermillion)]/10 text-[var(--color-vermillion)] text-[14px] font-semibold hover:bg-[var(--color-vermillion)]/20 transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {cancelling ? "取消中…" : "確認取消 · Confirm"}
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowCancelForm(true)}
                disabled={updating || cancelling}
                className="w-full h-10 rounded-xl border border-[var(--color-vermillion)]/25 text-[var(--color-vermillion)]/65 text-[13px] font-medium tracking-[0.04em] hover:border-[var(--color-vermillion)]/50 hover:text-[var(--color-vermillion)]/90 transition disabled:opacity-40 disabled:cursor-wait"
              >
                取消訂單 · Cancel Order
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
