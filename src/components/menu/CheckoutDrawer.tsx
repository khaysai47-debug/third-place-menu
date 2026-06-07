import { type ReactElement, useState } from "react";

interface CartItem {
  id: string;
  name: string;
  qty: number;
  subtotal: number;
}

interface Props {
  items: CartItem[];
  total: number;
  onClose: () => void;
}

type OrderType = "dine-in" | "pickup" | "delivery";
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

function makeOrderId(): string {
  const now = new Date();
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `TP-${date}-${time}`;
}

function Field({
  error,
  children,
}: {
  error?: string;
  children: ReactElement;
}) {
  return (
    <div>
      {children}
      {error && (
        <p className="mt-1 text-[11px] text-[var(--color-vermillion)]">{error}</p>
      )}
    </div>
  );
}

const inputClass =
  "w-full bg-[var(--color-ink)] border border-[var(--color-gold)]/20 rounded-xl px-4 py-3 text-[14px] text-[var(--color-cream)] placeholder:text-[var(--color-cream)]/30 focus:outline-none focus:border-[var(--color-gold)]/50 transition";

export function CheckoutDrawer({ items, total, onClose }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [tableNumber, setTableNumber] = useState(
    // Pre-fill from ?table= so QR codes per table set this automatically
    () => new URLSearchParams(window.location.search).get("table") ?? ""
  );
  const [orderType, setOrderType] = useState<OrderType>("dine-in");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);

  const clearError = (key: string) =>
    setErrors((e) => { const next = { ...e }; delete next[key]; return next; });

  const handlePlaceOrder = () => {
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
    const orderPayload = {
      orderId: makeOrderId(),
      createdAt: now.toISOString(),
      customer: {
        name: name.trim() || null,
        phone: phone.trim() || null,
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
      totalPrice: total,
      status: "draft" as const,
    };

    console.log("ORDER_DRAFT_PAYLOAD", orderPayload);
    setSuccess(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="relative mx-auto w-full max-w-[680px] bg-[var(--color-charcoal-soft)] rounded-t-3xl border-t border-x border-[var(--color-gold)]/20 max-h-[92vh] flex flex-col overflow-hidden shadow-[0_-20px_60px_-20px_oklch(0_0_0/0.7)]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[var(--color-gold)]/15 shrink-0">
          <h2 className="font-display text-[22px] text-[var(--color-cream)]">
            Review Order
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="h-8 w-8 rounded-full bg-[var(--color-cream)]/10 text-[var(--color-cream)]/60 flex items-center justify-center text-[16px] hover:bg-[var(--color-cream)]/20 transition"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 py-5 space-y-6">
          {success ? (
            <div className="py-12 text-center space-y-3">
              <div className="font-display text-[30px] text-[var(--color-gold-soft)]">
                Order drafted
              </div>
              <p className="text-[13px] text-[var(--color-cream)]/55 leading-relaxed">
                Order saved to console.
                <br />
                Backend connection coming next.
              </p>
              <button
                onClick={onClose}
                className="mt-4 text-[12px] uppercase tracking-[0.2em] text-[var(--color-cream)]/40 hover:text-[var(--color-cream)]/70 transition"
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
                      <span className="font-display text-[14px] text-[var(--color-gold-soft)]">
                        ฿{item.subtotal}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between items-baseline pt-3 border-t border-[var(--color-gold)]/15">
                    <span className="text-[12px] uppercase tracking-wider text-[var(--color-cream)]/50">
                      Total
                    </span>
                    <span className="font-display text-[20px] text-[var(--color-vermillion)]">
                      ฿{total.toLocaleString()}
                    </span>
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
                      onClick={() => { setOrderType(type); setErrors({}); }}
                      className={`flex-1 py-2.5 rounded-xl text-[12px] uppercase tracking-[0.14em] border transition ${
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
                  <Field error={errors.tableNumber}>
                    <input
                      type="text"
                      placeholder="Table number"
                      value={tableNumber}
                      onChange={(e) => { setTableNumber(e.target.value); clearError("tableNumber"); }}
                      className={inputClass}
                    />
                  </Field>
                )}

                {/* Name */}
                <Field error={errors.name}>
                  <input
                    type="text"
                    placeholder={orderType === "dine-in" ? "Name (optional)" : "Name"}
                    value={name}
                    onChange={(e) => { setName(e.target.value); clearError("name"); }}
                    className={inputClass}
                  />
                </Field>

                {/* Phone */}
                <Field error={errors.phone}>
                  <input
                    type="tel"
                    placeholder={orderType === "dine-in" ? "Phone (optional)" : "Phone number"}
                    value={phone}
                    onChange={(e) => { setPhone(e.target.value); clearError("phone"); }}
                    className={inputClass}
                  />
                </Field>

                {/* Delivery address — Delivery only */}
                {orderType === "delivery" && (
                  <Field error={errors.address}>
                    <input
                      type="text"
                      placeholder="Delivery address"
                      value={address}
                      onChange={(e) => { setAddress(e.target.value); clearError("address"); }}
                      className={inputClass}
                    />
                  </Field>
                )}

                {/* Notes */}
                <textarea
                  placeholder="Order notes (optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className={`${inputClass} resize-none`}
                />
              </section>
            </>
          )}
        </div>

        {/* Place Order button */}
        {!success && (
          <div className="px-5 py-4 border-t border-[var(--color-gold)]/15 shrink-0">
            <button
              onClick={handlePlaceOrder}
              className="w-full rounded-2xl bg-[var(--color-vermillion)] text-[var(--color-cream)] py-4 font-display text-[18px] shadow-[0_20px_40px_-18px_oklch(0.45_0.18_27/0.7)] border border-[var(--color-vermillion-deep)] active:scale-[0.99] transition"
            >
              Place Order · ฿{total.toLocaleString()}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
