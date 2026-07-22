import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
import { Drawer } from "vaul";
import { type OrderPayload, submitOrder, submitSessionOrder } from "@/lib/orders";
import type { MenuSessionContext } from "./MenuScreen";
import { MinusIcon, PlusIcon } from "./Icons";
import { OrderTypeRail } from "./OrderTypeRail";
import type { OrderType } from "./orderType";

export type { OrderType };

interface CartItem {
  id: string;
  name: string;
  qty: number;
  subtotal: number;
  /** Item is no longer orderable (sold out / hidden) — blocks placing the order. */
  soldOut?: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bumped by the page every time the sheet is opened. Remounts the form so
   *  each drawer session is a fresh intended order with its own requestId. */
  sessionKey: number;
  items: CartItem[];
  total: number;
  onIncrease: (id: string) => void;
  onDecrease: (id: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  initialOrderType?: OrderType;
  /** Present only when the menu was opened through a secure bot-session link.
   *  Routes checkout to /api/order/submit-session, where the order's channel
   *  is resolved server-side from the locked session row. */
  session?: MenuSessionContext;
}

type OrderTypePayload = "dine_in" | "pickup" | "delivery";

const ORDER_TYPE_PAYLOAD: Record<OrderType, OrderTypePayload> = {
  "dine-in": "dine_in",
  pickup: "pickup",
  delivery: "delivery",
};

const DELIVERY_FEE = 30;

/** ms the "Tap again to clear" confirmation stays armed before resetting. */
const CLEAR_CONFIRM_MS = 3000;

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
  zh,
  htmlFor,
  error,
  children,
}: {
  label: string;
  zh?: string;
  htmlFor: string;
  error?: string;
  children: ReactElement;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1.5 flex items-baseline gap-2 text-[11px] uppercase tracking-[0.18em] text-[var(--color-cream)]/75"
      >
        {label}
        {zh && <span className="tracking-[0.1em] text-[var(--color-gold-soft)]/45">{zh}</span>}
      </label>
      {children}
      {error && (
        <p className="tp-rise-sm mt-1.5 text-[11.5px] text-[var(--color-vermillion-text)]">
          {error}
        </p>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-[var(--color-gold)]/20 bg-[var(--color-ink)] px-4 py-3.5 text-[15px] text-[var(--color-cream)] placeholder:text-[var(--color-cream)]/40 transition-colors duration-150 ease-[var(--ease-fluid)] focus:border-[var(--color-gold)]/55 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)]";

function LineStepper({
  item,
  onIncrease,
  onDecrease,
}: {
  item: CartItem;
  onIncrease: (id: string) => void;
  onDecrease: (id: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-full border border-[var(--color-gold)]/20 bg-[var(--color-ink)]">
      <button
        onClick={() => onDecrease(item.id)}
        aria-label={`Remove one ${item.name}`}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-cream)]/80 transition-[transform,background-color] duration-150 ease-[var(--ease-fluid)] active:scale-90 hover:bg-[var(--color-cream)]/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-gold)] before:absolute before:-inset-1.5 before:content-['']"
      >
        <MinusIcon className="h-3.5 w-3.5" />
      </button>
      <span
        key={item.qty}
        className="tp-num tp-bump w-5 text-center text-[13px] text-[var(--color-cream)]"
      >
        {item.qty}
      </span>
      <button
        onClick={() => onIncrease(item.id)}
        aria-label={`Add another ${item.name}`}
        className="relative flex h-8 w-8 items-center justify-center rounded-full text-[var(--color-cream)]/80 transition-[transform,background-color] duration-150 ease-[var(--ease-fluid)] active:scale-90 hover:bg-[var(--color-cream)]/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-gold)] before:absolute before:-inset-1.5 before:content-['']"
      >
        <PlusIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Everything below the sheet chrome. Remounted per drawer session (see
 * `sessionKey`) so form state, validation and — critically — the idempotency
 * key belong to exactly one intended order.
 */
function CheckoutForm({
  items,
  total,
  onIncrease,
  onDecrease,
  onRemove,
  onClear,
  onClose,
  initialOrderType,
  session,
  onSubmittingChange,
  onConfirmedItemCount,
}: Omit<Props, "open" | "onOpenChange" | "sessionKey"> & {
  onClose: () => void;
  onSubmittingChange: (submitting: boolean) => void;
  /** Freezes the sheet header's item count at the moment of confirmation, so
   *  clearing the cart on success cannot blank it on the confirmation screen. */
  onConfirmedItemCount: (count: number) => void;
}) {
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
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // One idempotency key per drawer session (= per intended order): retries of
  // a failed submit reuse it, so the server can never store the order twice.
  const [requestId] = useState(() => crypto.randomUUID());
  // Snapshot of the placed order, and the "we are on the confirmation screen"
  // flag in one value. The cart is CLEARED on success (Phase 3D — a completed
  // order must never sit one tap away from being re-submitted, which matters
  // most on a single-use bot-session link), and clearing would otherwise empty
  // this screen, so the lines and totals are captured before it happens.
  // orderId is the authoritative server-returned number — never the
  // client-generated one.
  const [confirmed, setConfirmed] = useState<{
    orderId: string;
    items: CartItem[];
    subtotal: number;
    total: number;
  } | null>(null);

  // Two-step clear: the first tap arms the confirmation, a second tap within
  // CLEAR_CONFIRM_MS clears. Anything slower disarms it again.
  const [confirmClear, setConfirmClear] = useState(false);
  const clearTimer = useRef<number | null>(null);

  // The scroll container survives the swap from form to confirmation, so
  // without this the customer lands mid-way down the confirmation with the
  // seal already scrolled off the top.
  const successRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (confirmed) successRef.current?.scrollTo(0, 0);
  }, [confirmed]);

  const deliveryFee = orderType === "delivery" ? DELIVERY_FEE : 0;
  const finalTotal = total + deliveryFee;

  // The sheet must not be draggable or escapable mid-flight, or the customer
  // loses the confirmation for an order the server is already storing.
  useEffect(() => onSubmittingChange(isSubmitting), [isSubmitting, onSubmittingChange]);

  useEffect(
    () => () => {
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
    },
    [],
  );

  const handleClear = () => {
    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current);
    if (confirmClear) {
      clearTimer.current = null;
      setConfirmClear(false);
      onClear();
      onClose();
      return;
    }
    setConfirmClear(true);
    clearTimer.current = window.setTimeout(() => {
      clearTimer.current = null;
      setConfirmClear(false);
    }, CLEAR_CONFIRM_MS);
  };

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
    // this screen only builds the OrderPayload contract. On a secure
    // bot-session link the token routes it to the session endpoint instead;
    // the payload is identical, and the channel is decided server-side.
    const result = session
      ? await submitSessionOrder(orderPayload, session.token)
      : await submitOrder(orderPayload);
    if (result.success) {
      setSubmitError(null);
      setConfirmed({
        orderId: result.orderId,
        items,
        subtotal: total,
        total: finalTotal,
      });
      onConfirmedItemCount(items.reduce((s, i) => s + i.qty, 0));
      // Only after the snapshots: an order that succeeded must not stay in the
      // cart, or reopening the sheet offers to place it again.
      onClear();
    } else {
      // Cart and form state stay intact — the customer can fix and retry.
      setSubmitError(result.error);
      setIsSubmitting(false);
    }
  };

  if (confirmed) {
    return (
      <div ref={successRef} className="flex-1 overflow-y-auto px-5 pb-10 pt-4">
        <div className="flex flex-col items-center text-center">
          {/* Chop mark. Presses in with an overshoot, the way a seal is
              actually stamped, and a single gold sheen crosses it once. */}
          <div className="tp-seal relative h-[74px] w-[74px] overflow-hidden rounded-[14px] border border-[var(--color-vermillion-deep)] bg-[var(--color-vermillion)] shadow-[0_20px_44px_-18px_oklch(0.45_0.18_27/0.9)]">
            <span className="font-display absolute inset-0 flex items-center justify-center text-[38px] leading-none text-[var(--color-cream)]">
              訂
            </span>
            <span
              aria-hidden
              className="tp-sheen absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-[var(--color-cream)]/45 to-transparent"
            />
          </div>

          <h3
            className="tp-display tp-rise mt-6 text-[30px] text-[var(--color-gold-soft)]"
            style={{ ["--i" as string]: 6 }}
          >
            Order received
          </h3>
          <p
            className="tp-rise mt-1 text-[13px] tracking-[0.22em] text-[var(--color-cream)]/45"
            style={{ ["--i" as string]: 7 }}
          >
            訂單已送出
          </p>

          {confirmed.orderId && (
            <p
              className="tp-rise mt-4 rounded-full border border-[var(--color-gold)]/25 bg-[var(--color-ink)]/60 px-4 py-1.5 text-[12px] text-[var(--color-cream)]/55"
              style={{ ["--i" as string]: 8 }}
            >
              Order <span className="tp-num text-[var(--color-cream)]/85">{confirmed.orderId}</span>
            </p>
          )}

          <p
            className="tp-rise mt-4 max-w-[38ch] text-[13.5px] leading-relaxed text-[var(--color-cream)]/60"
            style={{ ["--i" as string]: 9 }}
          >
            {orderType === "dine-in"
              ? "Staff will prepare it shortly."
              : orderType === "pickup"
                ? "Staff will confirm when it is ready for pickup."
                : "Staff will confirm delivery and payment."}
          </p>

          {orderType === "dine-in" && tableNumber.trim() && (
            <div
              className="tp-rise mt-4 inline-flex items-baseline gap-2 rounded-full border border-[var(--color-gold)]/25 bg-[var(--color-ink)]/60 px-4 py-2 text-[13px] text-[var(--color-cream)]/80"
              style={{ ["--i" as string]: 10 }}
            >
              Table{" "}
              <span className="tp-num text-[17px] text-[var(--color-gold)]">
                {tableNumber.trim()}
              </span>
              <span className="text-[11px] text-[var(--color-cream)]/45">堂食</span>
            </div>
          )}
          {orderType !== "dine-in" && (name.trim() || phone.trim()) && (
            <p
              className="tp-rise mt-4 text-[13px] text-[var(--color-cream)]/70"
              style={{ ["--i" as string]: 10 }}
            >
              {name.trim()}
              {name.trim() && phone.trim() && " · "}
              {phone.trim() && <span className="tp-num">{phone.trim()}</span>}
            </p>
          )}
        </div>

        {orderType === "delivery" && (
          <ul
            className="tp-rise mx-auto mt-5 max-w-[380px] space-y-1.5 text-left text-[12.5px] leading-relaxed text-[var(--color-cream)]/55"
            style={{ ["--i" as string]: 11 }}
          >
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

        <div
          className="tp-rise mx-auto mt-6 max-w-[420px] rounded-2xl border border-[var(--color-gold)]/15 bg-[var(--color-ink)]/60 px-4 py-4 text-left"
          style={{ ["--i" as string]: 12 }}
        >
          <h4 className="mb-3 text-[10px] uppercase tracking-[0.24em] text-[var(--color-cream)]/45">
            Your Order
          </h4>
          <div className="space-y-1.5">
            {confirmed.items.map((item) => (
              <div key={item.id} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[13px] text-[var(--color-cream)]/85">
                  {item.name}{" "}
                  <span className="tp-num text-[11px] text-[var(--color-cream)]/45">
                    ×{item.qty}
                  </span>
                </span>
                <span className="tp-num shrink-0 text-[13px] text-[var(--color-gold-soft)]">
                  ฿{item.subtotal.toLocaleString("en-US")}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 border-t border-[var(--color-gold)]/12 pt-2.5">
            {orderType === "delivery" && (
              <>
                <div className="flex items-baseline justify-between text-[12px] text-[var(--color-cream)]/55">
                  <span>Subtotal</span>
                  <span className="tp-num">฿{confirmed.subtotal.toLocaleString("en-US")}</span>
                </div>
                <div className="flex items-baseline justify-between text-[12px] text-[var(--color-cream)]/55">
                  <span>Delivery fee</span>
                  <span className="tp-num">฿{deliveryFee.toLocaleString("en-US")}</span>
                </div>
              </>
            )}
            <div className="flex items-baseline justify-between pt-0.5">
              <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--color-cream)]/50">
                Total
              </span>
              <span className="tp-num text-[19px] text-[var(--color-vermillion-text)]">
                ฿{confirmed.total.toLocaleString("en-US")}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-7 text-center">
          <button
            onClick={onClose}
            className="relative text-[12px] uppercase tracking-[0.2em] text-[var(--color-cream)]/65 transition-colors duration-150 ease-[var(--ease-fluid)] hover:text-[var(--color-cream)]/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] before:absolute before:-inset-x-3 before:-inset-y-3 before:content-['']"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {/* ── Order lines ─────────────────────────────────────────────── */}
        <section>
          <div className="flex items-baseline justify-between">
            <h3 className="text-[10.5px] uppercase tracking-[0.24em] text-[var(--color-cream)]/45">
              菜品 · Items
            </h3>
            {items.length > 0 && (
              <button
                onClick={handleClear}
                className={`relative text-[10.5px] uppercase tracking-[0.16em] transition-colors duration-150 ease-[var(--ease-fluid)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] ${
                  confirmClear
                    ? "text-[var(--color-vermillion-text)]"
                    : "text-[var(--color-cream)]/45 hover:text-[var(--color-cream)]/70"
                }`}
              >
                {confirmClear ? "Tap again to clear" : "Clear"}
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <p className="mt-4 rounded-2xl border border-dashed border-[var(--color-gold)]/25 px-4 py-8 text-center text-[13px] leading-relaxed text-[var(--color-cream)]/45">
              空的 · Your order is empty.
              <span className="mt-1 block text-[12px] text-[var(--color-cream)]/35">
                Close this and add a dish to begin.
              </span>
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-[var(--color-gold)]/10">
              {items.map((item, i) => (
                <li
                  key={item.id}
                  className="tp-rise-sm flex items-center gap-3 py-3"
                  style={{ ["--i" as string]: i }}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={`font-display text-[16px] leading-tight ${
                        item.soldOut
                          ? "text-[var(--color-cream)]/40 line-through"
                          : "text-[var(--color-cream)]"
                      }`}
                    >
                      {item.name}
                    </p>
                    <p className="tp-num mt-0.5 text-[12px] text-[var(--color-gold-soft)]/65">
                      ฿{item.subtotal.toLocaleString("en-US")}
                    </p>
                  </div>
                  {item.soldOut ? (
                    // Sold out cannot be re-ordered, so the stepper is replaced
                    // by the only action left: remove it and unblock checkout.
                    <button
                      onClick={() => onRemove(item.id)}
                      className="relative shrink-0 rounded-full border border-[var(--color-vermillion)]/40 bg-[var(--color-vermillion)]/18 px-3 py-1.5 text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-vermillion-text)] transition-[transform,background-color] duration-150 ease-[var(--ease-fluid)] active:scale-95 hover:bg-[var(--color-vermillion)]/28 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] before:absolute before:-inset-2 before:content-['']"
                    >
                      Remove
                    </button>
                  ) : (
                    <LineStepper item={item} onIncrease={onIncrease} onDecrease={onDecrease} />
                  )}
                </li>
              ))}
            </ul>
          )}

          {items.length > 0 && (
            <div className="mt-4 space-y-1.5 rounded-2xl border border-[var(--color-gold)]/15 bg-[var(--color-ink)]/60 px-4 py-3.5">
              <div className="flex items-baseline justify-between text-[12.5px] text-[var(--color-cream)]/55">
                <span className="uppercase tracking-[0.14em]">Subtotal</span>
                <span className="tp-num">฿{total.toLocaleString("en-US")}</span>
              </div>
              {orderType === "delivery" && (
                <div className="tp-rise-sm flex items-baseline justify-between text-[12.5px] text-[var(--color-cream)]/55">
                  <span className="uppercase tracking-[0.14em]">Delivery fee</span>
                  <span className="tp-num">฿{deliveryFee.toLocaleString("en-US")}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t border-[var(--color-gold)]/12 pt-2.5">
                <span className="text-[12.5px] uppercase tracking-[0.14em] text-[var(--color-cream)]/60">
                  Total
                </span>
                <span className="tp-num text-[22px] leading-none text-[var(--color-vermillion-text)]">
                  ฿{finalTotal.toLocaleString("en-US")}
                </span>
              </div>
            </div>
          )}
        </section>

        {/* ── Details ─────────────────────────────────────────────────── */}
        <section className="mt-8 space-y-4">
          <h3 className="text-[10.5px] uppercase tracking-[0.24em] text-[var(--color-cream)]/45">
            取餐方式 · How to serve it
          </h3>

          {/* Order type first, so the fields below react immediately. */}
          <OrderTypeRail
            size="sm"
            value={orderType}
            onChange={(type) => {
              setOrderType(type);
              setErrors({});
            }}
          />

          {orderType === "dine-in" && (
            <Field
              label="Table number"
              zh="桌號"
              htmlFor="checkout-table"
              error={errors.tableNumber}
            >
              <input
                id="checkout-table"
                type="text"
                inputMode="numeric"
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
              <Field label="Name" zh="姓名" htmlFor="checkout-name" error={errors.name}>
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

              <Field label="Phone number" zh="電話" htmlFor="checkout-phone" error={errors.phone}>
                <input
                  id="checkout-phone"
                  type="tel"
                  inputMode="tel"
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

          {orderType === "delivery" && (
            <Field
              label="Delivery address"
              zh="地址"
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

          <Field label="Order notes (optional)" zh="備註" htmlFor="checkout-notes">
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
      </div>

      {/* ── Commit ────────────────────────────────────────────────────── */}
      <div className="shrink-0 space-y-2.5 border-t border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/85 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        {submitError && (
          <p className="tp-rise-sm text-center text-[12.5px] leading-relaxed text-[var(--color-vermillion-text)]">
            {submitError}
          </p>
        )}
        <button
          onClick={handlePlaceOrder}
          disabled={isSubmitting || items.length === 0}
          className="relative flex w-full items-center justify-center gap-3 overflow-hidden rounded-2xl border border-[var(--color-vermillion-deep)] bg-[var(--color-vermillion)] py-4 text-[var(--color-cream)] shadow-[0_22px_44px_-20px_oklch(0.45_0.18_27/0.8)] transition-transform duration-150 ease-[var(--ease-fluid)] active:scale-[0.985] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
        >
          {isSubmitting && (
            // Sending state reads as work in progress rather than a frozen
            // button: one light pass crossing the fill, on a loop.
            <span
              aria-hidden
              className="tp-sheen-loop absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-[var(--color-cream)]/25 to-transparent"
            />
          )}
          <span className="relative text-[17px] font-semibold tracking-[0.01em]">
            {isSubmitting ? "Sending order…" : "Place order"}
          </span>
          {!isSubmitting && (
            // The figure the customer commits to is never tweened — it is the
            // exact total, always.
            <span className="tp-num relative text-[17px] font-semibold">
              ฿{finalTotal.toLocaleString("en-US")}
            </span>
          )}
        </button>
      </div>
    </>
  );
}

/**
 * Checkout as a real bottom sheet: draggable, velocity-aware, interruptible.
 * Vaul owns the physics and the scroll lock; this file owns the surface and
 * the order contract.
 */
export function CheckoutSheet({
  open,
  onOpenChange,
  sessionKey,
  items,
  total,
  onIncrease,
  onDecrease,
  onRemove,
  onClear,
  initialOrderType,
  session,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  // Frozen at confirmation time. Without it, clearing the cart on success
  // would drop this header to "0 items" while the confirmation is on screen.
  const [confirmedCount, setConfirmedCount] = useState<number | null>(null);
  useEffect(() => setConfirmedCount(null), [sessionKey]);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const count = confirmedCount ?? items.reduce((s, i) => s + i.qty, 0);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      // While the order is in flight the sheet cannot be dragged, escaped or
      // dismissed by tapping away.
      dismissible={!submitting}
      repositionInputs
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-50 mx-auto flex h-[92dvh] max-w-[680px] flex-col rounded-t-3xl border-x border-t border-[var(--color-gold)]/20 bg-[var(--color-charcoal-soft)] shadow-[0_-20px_60px_-20px_oklch(0_0_0/0.7)] outline-none"
        >
          {/* Grabber — the affordance that says this thing is draggable. */}
          <div className="mx-auto mt-3 h-1.5 w-11 shrink-0 rounded-full bg-[var(--color-cream)]/20" />

          <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-4 pt-4">
            <div>
              <Drawer.Title className="font-display text-[22px] text-[var(--color-cream)]">
                Review Order
              </Drawer.Title>
              <p className="tp-num mt-0.5 text-[11px] uppercase tracking-[0.2em] text-[var(--color-gold-soft)]/55">
                訂單 · {count} {count === 1 ? "item" : "items"}
              </p>
            </div>
            <Drawer.Close asChild>
              <button
                aria-label="Close"
                disabled={submitting}
                className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--color-gold)]/20 text-[16px] text-[var(--color-cream)]/60 transition-[transform,background-color] duration-150 ease-[var(--ease-fluid)] active:scale-90 hover:bg-[var(--color-cream)]/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-gold)] disabled:opacity-40 before:absolute before:-inset-1.5 before:content-['']"
              >
                ✕
              </button>
            </Drawer.Close>
          </div>

          <CheckoutForm
            key={sessionKey}
            items={items}
            total={total}
            onIncrease={onIncrease}
            onDecrease={onDecrease}
            onRemove={onRemove}
            onClear={onClear}
            onClose={close}
            initialOrderType={initialOrderType}
            session={session}
            onSubmittingChange={setSubmitting}
            onConfirmedItemCount={setConfirmedCount}
          />
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
