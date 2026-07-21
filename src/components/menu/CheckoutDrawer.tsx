import { type ReactElement, useEffect, useState } from "react";
import { type OrderPayload, submitOrder } from "@/lib/orders";

interface CartItem {
  id: string;
  name: string;
  qty: number;
  subtotal: number;
  /** Item is no longer orderable (sold out / hidden) — blocks placing the order. */
  soldOut?: boolean;
}

interface Props {
  items: CartItem[];
  total: number;
  onClose: () => void;
  initialOrderType?: OrderType;
}

export type OrderType = "dine-in" | "pickup" | "delivery";
type OrderTypePayload = "dine_in" | "pickup" | "delivery";

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  "dine-in": "Dine In",
  pickup: "Pickup",
  delivery: "Delivery",
};

const ORDER_TYPE_PAYLOAD: Record<OrderType, OrderTypePayload> = {
  "dine-in": "dine_in",
  pickup: "pickup",
  delivery: "delivery",
};

const DELIVERY_FEE = 30;

function makeOrderId(): string {
  const now = new Date();
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `TP-${date}-${time}`;
}

/** Persistent visible label + input + inline error. The label stays after the
 *  field is filled — placeholders are examples only, never the label. */
function Field({
  label,
  htmlFor,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: ReactElement;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 block text-[11px] uppercase tracking-[0.18em] text-[var(--color-cream)]/75"
      >
        {label}
      </label>
      {children}
      {error && (
        <p className="mt-1 text-[11px] text-[var(--color-vermillion-text)]">{error}</p>
      )}
    </div>
  );
}

const inputClass =
  "w-full bg-[var(--color-ink)] border border-[var(--color-gold)]/20 rounded-xl px-4 py-3 text-[14px] text-[var(--color-cream)] placeholder:text-[var(--color-cream)]/45 focus:outline-none focus:border-[var(--color-gold)]/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] transition-colors duration-150 ease-out";

export function CheckoutDrawer({ items, total, onClose, initialOrderType }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [tableNumber, setTableNumber] = useState(
    // Pre-fill from ?table= so QR codes per table set this automatically
    () => new URLSearchParams(window.location.search).get("table") ?? "",
  );
  const [orderType, setOrderType] = useState<OrderType>(initialOrderType ?? "dine-in");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // One idempotency key per drawer session (= per intended order): retries of
  // a failed submit reuse it, so the server can never store the order twice.
  const [requestId] = useState(() => crypto.randomUUID());
  // Authoritative order number returned by the server (Supabase intake).
  const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null);

  const deliveryFee = orderType === "delivery" ? DELIVERY_FEE : 0;
  const finalTotal = total + deliveryFee;

  // Lock the page behind the sheet and wire Escape to close. Escape is ignored
  // while a submit is in flight so the customer can't lose the confirmation
  // for an order the server is already storing.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, isSubmitting]);

  const clearError = (key: string) =>
    setErrors((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });

  const handlePlaceOrder = async () => {
    if (items.some((i) => i.soldOut)) {
      setSubmitError("Some items just sold out — please remove them from your cart first.");
      return;
    }

    const e: Record<string, string> = {};

    if (orderType === "dine-in") {
      if (!tableNumber.trim()) e.tableNumber = "Table number is required";
    } else {
      if (!name.trim()) e.name = "Name is required";
      if (!phone.trim()) e.phone = "Phone is required";
    }
    if (orderType === "delivery" && !address.trim()) e.address = "Delivery address is required";

    if (Object.keys(e).length > 0) {
      setErrors(e);
      return;
    }

    const now = new Date();
    const orderPayload: OrderPayload = {
      requestId,
      orderId: makeOrderId(),
      createdAt: now.toISOString(),
      customer: {
        // Dine-in never collects name/phone — always send null regardless of
        // any value left in state from a prior order-type selection.
        name: orderType === "dine-in" ? null : name.trim() || null,
        phone: orderType === "dine-in" ? null : phone.trim() || null,
      },
      orderType: ORDER_TYPE_PAYLOAD[orderType],
      tableNumber: orderType === "dine-in" ? tableNumber.trim() : null,
      deliveryAddress: orderType === "delivery" ? address.trim() : null,
      notes: notes.trim() || null,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        quantity: item.qty,
        unitPrice: item.subtotal / item.qty,
        lineTotal: item.subtotal,
      })),
      totalItems: items.reduce((s, i) => s + i.qty, 0),
      subtotalPrice: total,
      deliveryFee,
      totalPrice: finalTotal,
      status: "draft",
    };

    setIsSubmitting(true);
    // submitOrder owns the transport (n8n webhook today, backend later) —
    // this screen only builds the OrderPayload contract.
    const result = await submitOrder(orderPayload);
    if (result.success) {
      setSubmitError(null);
      // Server-returned order number is the authoritative one — never assume
      // the client-generated id was stored.
      setConfirmedOrderId(result.orderId);
      setSuccess(true);
    } else {
      // Cart and form state stay intact — the customer can fix and retry.
      setSubmitError(result.error);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop — entry only; closing stays instant. */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200 motion-reduce:animate-none"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative mx-auto w-full max-w-[680px] bg-[var(--color-charcoal-soft)] rounded-t-3xl border-t border-x border-[var(--color-gold)]/20 max-h-[92dvh] flex flex-col overflow-hidden shadow-[0_-20px_60px_-20px_oklch(0_0_0/0.7)] animate-in slide-in-from-bottom duration-300 ease-out motion-reduce:animate-none">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[var(--color-gold)]/15 shrink-0">
          <h2 className="font-display text-[22px] text-[var(--color-cream)]">Review Order</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="relative h-8 w-8 rounded-full bg-[var(--color-cream)]/10 text-[var(--color-cream)]/60 flex items-center justify-center text-[16px] hover:bg-[var(--color-cream)]/20 transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] before:absolute before:-inset-1.5 before:content-['']"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-6">
          {success ? (
            <div className="py-8 text-center space-y-5">
              <div>
                <div className="mx-auto mb-3 flex items-center justify-center gap-3">
                  <span className="h-px w-10 bg-[var(--color-gold)]/40" />
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" />
                  <span className="h-px w-10 bg-[var(--color-gold)]/40" />
                </div>
                <div className="font-display text-[30px] text-[var(--color-gold-soft)]">
                  Order received · 訂單已送出
                </div>
                {confirmedOrderId && (
                  <p className="mt-1 text-[12px] text-[var(--color-cream)]/55">
                    Order <span className="staff-num text-[var(--color-cream)]/80">{confirmedOrderId}</span>
                  </p>
                )}
                <p className="mt-2 text-[13px] text-[var(--color-cream)]/60 leading-relaxed">
                  {orderType === "dine-in"
                    ? "Staff will prepare it shortly."
                    : orderType === "pickup"
                    ? "Staff will confirm when it is ready for pickup."
                    : "Staff will confirm delivery and payment."}
                </p>
              </div>

              {/* Where this order is going */}
              {orderType === "dine-in" && tableNumber.trim() && (
                <div className="inline-flex items-baseline gap-2 rounded-full border border-[var(--color-gold)]/25 bg-[var(--color-ink)]/60 px-4 py-2 text-[13px] text-[var(--color-cream)]/80">
                  Table <span className="staff-num text-[16px] text-[var(--color-gold)]">{tableNumber.trim()}</span>
                  <span className="text-[11px] text-[var(--color-cream)]/45">堂食</span>
                </div>
              )}
              {orderType !== "dine-in" && (name.trim() || phone.trim()) && (
                <p className="text-[13px] text-[var(--color-cream)]/70">
                  {name.trim()}
                  {name.trim() && phone.trim() && " · "}
                  {phone.trim() && <span className="staff-num">{phone.trim()}</span>}
                </p>
              )}

              {orderType === "delivery" && (
                <ul className="mx-auto max-w-[380px] space-y-1.5 text-left text-[12px] leading-relaxed text-[var(--color-cream)]/55">
                  {[
                    "Please keep your phone available — staff may call to confirm.",
                    "The ฿30 delivery fee is included in your total.",
                    "Payment confirmation may happen through staff chat.",
                  ].map((line) => (
                    <li key={line} className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--color-gold)]/60" />
                      {line}
                    </li>
                  ))}
                </ul>
              )}

              {/* Compact order summary */}
              <div className="mx-auto max-w-[420px] rounded-2xl border border-[var(--color-gold)]/15 bg-[var(--color-ink)]/60 px-4 py-4 text-left">
                <h3 className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-cream)]/45 mb-2.5">
                  Your Order
                </h3>
                <div className="space-y-1.5">
                  {items.map((item) => (
                    <div key={item.id} className="flex justify-between items-baseline gap-3">
                      <span className="min-w-0 truncate text-[13px] text-[var(--color-cream)]/85">
                        {item.name}{" "}
                        <span className="text-[11px] text-[var(--color-cream)]/45">×{item.qty}</span>
                      </span>
                      <span className="staff-num shrink-0 text-[13px] text-[var(--color-gold-soft)]">
                        ฿{item.subtotal.toLocaleString("en-US")}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-1 border-t border-[var(--color-gold)]/12 pt-2.5">
                  {orderType === "delivery" && (
                    <>
                      <div className="flex justify-between items-baseline text-[12px] text-[var(--color-cream)]/55">
                        <span>Subtotal</span>
                        <span className="staff-num">฿{total.toLocaleString("en-US")}</span>
                      </div>
                      <div className="flex justify-between items-baseline text-[12px] text-[var(--color-cream)]/55">
                        <span>Delivery fee</span>
                        <span className="staff-num">฿{deliveryFee.toLocaleString("en-US")}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between items-baseline pt-0.5">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--color-cream)]/50">
                      Total
                    </span>
                    <span className="staff-num text-[18px] text-[var(--color-vermillion)]">
                      ฿{finalTotal.toLocaleString("en-US")}
                    </span>
                  </div>
                </div>
              </div>

              <button
                onClick={onClose}
                className="relative text-[12px] uppercase tracking-[0.2em] text-[var(--color-cream)]/65 hover:text-[var(--color-cream)]/85 transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] before:absolute before:-inset-y-2.5 before:-inset-x-2 before:content-['']"
              >
                Close
              </button>
            </div>
          ) : (
            <>
              {/* Order summary */}
              <section>
                <h3 className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-cream)]/45 mb-3">
                  Order Summary
                </h3>
                <div className="space-y-2">
                  {items.map((item) => (
                    <div key={item.id} className="flex justify-between items-baseline">
                      <span className="text-[14px] text-[var(--color-cream)]">
                        {item.name}{" "}
                        <span className="text-[var(--color-cream)]/45 text-[12px]">
                          ×{item.qty}
                        </span>
                      </span>
                      <span className="staff-num text-[14px] text-[var(--color-gold-soft)]">
                        ฿{item.subtotal.toLocaleString("en-US")}
                      </span>
                    </div>
                  ))}
                  <div className="pt-3 border-t border-[var(--color-gold)]/15 space-y-1.5">
                    <div className="flex justify-between items-baseline">
                      <span className="text-[12px] uppercase tracking-wider text-[var(--color-cream)]/50">
                        Subtotal
                      </span>
                      <span className="staff-num text-[14px] text-[var(--color-cream)]/70">
                        ฿{total.toLocaleString("en-US")}
                      </span>
                    </div>
                    {orderType === "delivery" && (
                      <div className="flex justify-between items-baseline">
                        <span className="text-[12px] uppercase tracking-wider text-[var(--color-cream)]/50">
                          Delivery fee
                        </span>
                        <span className="staff-num text-[14px] text-[var(--color-cream)]/70">
                          ฿{deliveryFee.toLocaleString("en-US")}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between items-baseline pt-1.5 border-t border-[var(--color-gold)]/10">
                      <span className="text-[12px] uppercase tracking-wider text-[var(--color-cream)]/50">
                        Total
                      </span>
                      <span className="staff-num text-[20px] text-[var(--color-vermillion)]">
                        ฿{finalTotal.toLocaleString("en-US")}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {/* Customer details */}
              <section className="space-y-3">
                <h3 className="text-[11px] uppercase tracking-[0.22em] text-[var(--color-cream)]/45">
                  Your Details
                </h3>

                {/* Order type — first so fields below react immediately */}
                <div className="flex gap-2">
                  {(["dine-in", "pickup", "delivery"] as OrderType[]).map((type) => (
                    <button
                      key={type}
                      onClick={() => {
                        setOrderType(type);
                        setErrors({});
                      }}
                      className={`flex-1 py-2.5 rounded-xl text-[12px] uppercase tracking-[0.14em] border transition-colors duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] ${
                        orderType === type
                          ? "bg-[var(--color-vermillion)] border-[var(--color-vermillion)] text-[var(--color-cream)]"
                          : "bg-[var(--color-ink)] border-[var(--color-gold)]/20 text-[var(--color-cream)]/55 hover:border-[var(--color-gold)]/40"
                      }`}
                    >
                      {ORDER_TYPE_LABELS[type]}
                    </button>
                  ))}
                </div>

                {/* Table number — Dine In only */}
                {orderType === "dine-in" && (
                  <Field label="Table number" htmlFor="checkout-table" error={errors.tableNumber}>
                    <input
                      id="checkout-table"
                      type="text"
                      placeholder="e.g. 12"
                      value={tableNumber}
                      onChange={(e) => {
                        setTableNumber(e.target.value);
                        clearError("tableNumber");
                      }}
                      className={inputClass}
                    />
                  </Field>
                )}

                {/* Name & Phone — not shown for dine-in (table number is enough) */}
                {orderType !== "dine-in" && (
                  <>
                    <Field label="Name" htmlFor="checkout-name" error={errors.name}>
                      <input
                        id="checkout-name"
                        type="text"
                        placeholder="e.g. Somchai"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value);
                          clearError("name");
                        }}
                        className={inputClass}
                      />
                    </Field>

                    <Field label="Phone number" htmlFor="checkout-phone" error={errors.phone}>
                      <input
                        id="checkout-phone"
                        type="tel"
                        placeholder="e.g. 081 234 5678"
                        value={phone}
                        onChange={(e) => {
                          setPhone(e.target.value);
                          clearError("phone");
                        }}
                        className={inputClass}
                      />
                    </Field>
                  </>
                )}

                {/* Delivery address — Delivery only */}
                {orderType === "delivery" && (
                  <Field
                    label="Delivery address"
                    htmlFor="checkout-address"
                    error={errors.address}
                  >
                    <input
                      id="checkout-address"
                      type="text"
                      placeholder="e.g. 88 Soi Bangna 12, Bang Na"
                      value={address}
                      onChange={(e) => {
                        setAddress(e.target.value);
                        clearError("address");
                      }}
                      className={inputClass}
                    />
                  </Field>
                )}

                {/* Notes */}
                <Field label="Order notes (optional)" htmlFor="checkout-notes">
                  <textarea
                    id="checkout-notes"
                    placeholder="e.g. less spicy, no peanuts"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className={`${inputClass} resize-none`}
                  />
                </Field>
              </section>
            </>
          )}
        </div>

        {/* Place Order button */}
        {!success && (
          <div className="px-5 py-4 border-t border-[var(--color-gold)]/15 shrink-0 space-y-2">
            {submitError && (
              <p className="text-[12px] text-[var(--color-vermillion-text)] text-center">
                {submitError}
              </p>
            )}
            <button
              onClick={handlePlaceOrder}
              disabled={isSubmitting}
              className="w-full rounded-2xl bg-[var(--color-vermillion)] text-[var(--color-cream)] py-4 text-[18px] font-semibold shadow-[0_20px_40px_-18px_oklch(0.45_0.18_27/0.7)] border border-[var(--color-vermillion-deep)] active:scale-[0.98] transition-transform duration-150 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
            >
              {isSubmitting ? "Sending Order…" : `Place Order · ฿${finalTotal.toLocaleString("en-US")}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
