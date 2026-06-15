// Staff manual order form: builds a dine-in order from the live menu and
// submits it through the same order intake webhook as customer checkout
// (same OrderPayload shape — n8n sets the status to "new" itself).
import { useCallback, useEffect, useMemo, useState } from "react";
import { getMenuAvailability, type MenuAvailabilityItem } from "@/lib/menuAvailability";
import { submitOrder, type OrderPayload } from "@/lib/orders";

type LoadState = "loading" | "error" | "ready";

interface OrderLine {
  menuItemId: string;
  name: string;
  unitPrice: number;
  qty: number;
}

// Same convention as the customer makeOrderId, with an -S- marker so staff
// orders are distinguishable and don't collide with a same-second customer order.
function makeStaffOrderId(): string {
  const now = new Date();
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `TP-S-${date}-${time}`;
}

const inputClass =
  "w-full rounded-xl border border-[var(--color-ink)]/25 bg-transparent px-4 py-3 text-[15px] text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/35 focus:outline-none focus:border-[var(--color-ink)]/55 transition";

interface Props {
  /** Called after a successful submit so the order board can re-sync. */
  onSubmitted?: () => void;
}

export function ManualOrderForm({ onSubmitted }: Props) {
  const [menuItems, setMenuItems] = useState<MenuAvailabilityItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  const [tableNumber, setTableNumber] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [note, setNote] = useState("");

  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);

  const loadMenu = useCallback(async () => {
    setLoadState("loading");
    try {
      setMenuItems(await getMenuAvailability());
      setLoadState("ready");
    } catch (error) {
      console.error("Failed to load menu for manual order", error);
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadMenu();
  }, [loadMenu]);

  // Hidden items are not offered; Sold Out and unpriced items show but are disabled.
  const pickerItems = useMemo(
    () => menuItems.filter((i) => i.availability !== "Hidden"),
    [menuItems],
  );

  const categories = useMemo(() => {
    const order: string[] = [];
    for (const item of pickerItems) {
      if (!order.includes(item.category)) order.push(item.category);
    }
    return order;
  }, [pickerItems]);

  // First category is the default tab once the menu loads.
  const currentCategory = activeCategory ?? categories[0] ?? "";
  // While searching (by item code or English name), match across all
  // categories so staff can jump straight to an item; otherwise show the tab.
  const query = search.trim().toLowerCase();
  const searching = query.length > 0;
  const visibleItems = searching
    ? pickerItems.filter(
        (i) => i.menuItemId.toLowerCase().includes(query) || i.name.toLowerCase().includes(query),
      )
    : pickerItems.filter((i) => i.category === currentCategory);

  const total = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const totalItems = lines.reduce((s, l) => s + l.qty, 0);

  const addLine = (item: MenuAvailabilityItem) => {
    if (item.availability !== "Available" || item.price <= 0) return;
    setFormError(null);
    setSuccessId(null);
    setLines((prev) => {
      const existing = prev.find((l) => l.menuItemId === item.menuItemId);
      if (existing) {
        return prev.map((l) => (l.menuItemId === item.menuItemId ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...prev,
        { menuItemId: item.menuItemId, name: item.name, unitPrice: item.price, qty: 1 },
      ];
    });
  };

  const changeQty = (menuItemId: string, delta: number) =>
    setLines((prev) =>
      prev.flatMap((l) => {
        if (l.menuItemId !== menuItemId) return [l];
        const qty = l.qty + delta;
        return qty <= 0 ? [] : [{ ...l, qty }];
      }),
    );

  const handleSubmit = async () => {
    if (submitting) return;
    if (!tableNumber.trim()) {
      setFormError("請輸入桌號 · Table number is required.");
      return;
    }
    if (lines.length === 0) {
      setFormError("請先加入餐點 · Add at least one item.");
      return;
    }

    const trimmedNote = note.trim();
    const payload: OrderPayload = {
      orderId: makeStaffOrderId(),
      createdAt: new Date().toISOString(),
      customer: { name: null, phone: null },
      orderType: "dine_in",
      tableNumber: tableNumber.trim(),
      deliveryAddress: null,
      notes: trimmedNote ? `Staff manual order — ${trimmedNote}` : "Staff manual order",
      items: lines.map((l) => ({
        id: l.menuItemId,
        name: l.name,
        quantity: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.unitPrice * l.qty,
      })),
      totalItems,
      totalPrice: total,
      status: "draft",
    };

    setFormError(null);
    setSuccessId(null);
    setSubmitting(true);
    const result = await submitOrder(payload);
    setSubmitting(false);

    if (result.success) {
      setSuccessId(result.orderId);
      setTableNumber("");
      setLines([]);
      setNote("");
      onSubmitted?.();
    } else {
      setFormError(result.error);
    }
  };

  if (loadState === "loading") {
    return (
      <div className="mt-12 px-5 text-center">
        <div className="flex items-center justify-center gap-1.5 mb-4">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 rounded-full bg-[var(--color-gold)]/60 animate-pulse"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
        <p className="font-display text-[20px] text-[var(--color-gold-soft)]/80">
          載入菜單 · Loading menu…
        </p>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="mt-10 px-5">
        <div className="mx-auto max-w-[440px] rounded-2xl border border-[var(--color-vermillion)]/40 bg-[var(--color-charcoal-soft)]/70 px-6 py-8 text-center">
          <p className="font-display text-[22px] text-[var(--color-cream)]">
            無法載入菜單 · Can't load menu
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
            Check the menu server, then try again.
          </p>
          <button
            onClick={() => void loadMenu()}
            className="mt-5 h-12 px-8 rounded-full bg-[var(--color-vermillion)] text-[var(--color-cream)] text-[15px] font-semibold tracking-[0.02em] active:scale-[0.97] transition"
          >
            重試 · Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5 px-5">
      <div className="mx-auto max-w-[640px] paper-grain rounded-2xl border border-[var(--color-gold)]/30 overflow-hidden shadow-[0_20px_40px_-25px_oklch(0_0_0/0.8)]">
        <div className="px-5 pt-5 pb-4 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[22px] leading-none text-[var(--color-ink)]">
            Manual Order
            <span className="ml-2 font-sans text-[13px] tracking-[0.08em] text-[var(--color-ink)]/55">
              加單
            </span>
          </h2>
          <span className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-ink)]/50">
            Dine In · 堂食
          </span>
        </div>

        <div className="px-5 pb-5 space-y-4 border-t border-dotted border-[var(--color-ink)]/25 pt-4">
          {/* Table number */}
          <input
            type="text"
            inputMode="numeric"
            placeholder="桌號 · Table number"
            value={tableNumber}
            onChange={(e) => {
              setTableNumber(e.target.value);
              setFormError(null);
            }}
            className={inputClass}
          />

          {/* Item picker: search, category chips, then tappable item cards */}
          <div className="space-y-2.5">
            <input
              type="text"
              inputMode="search"
              placeholder="搜尋 · Search code or name (e.g. A01)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={inputClass}
            />

            {!searching && (
              <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {categories.map((category) => {
                  const active = category === currentCategory;
                  return (
                    <button
                      key={category}
                      onClick={() => setActiveCategory(category)}
                      className={`shrink-0 h-11 px-4 rounded-full border text-[13px] font-semibold tracking-[0.02em] transition active:scale-[0.97] ${
                        active
                          ? "bg-[var(--color-ink)] border-[var(--color-ink)] text-[var(--color-cream)]"
                          : "border-[var(--color-ink)]/25 text-[var(--color-ink)]/70 hover:border-[var(--color-ink)]/50"
                      }`}
                    >
                      {category}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {visibleItems.map((item) => {
                const soldOut = item.availability !== "Available";
                const unpriced = item.price <= 0;
                const disabled = soldOut || unpriced;
                const qty = lines.find((l) => l.menuItemId === item.menuItemId)?.qty ?? 0;
                return (
                  <button
                    key={item.menuItemId}
                    onClick={() => addLine(item)}
                    disabled={disabled}
                    aria-label={disabled ? `${item.name} — unavailable` : `Add ${item.name}`}
                    className={`relative rounded-xl border p-3 text-left transition ${
                      disabled
                        ? "border-[var(--color-ink)]/15 bg-[var(--color-ink)]/5 opacity-55 cursor-not-allowed"
                        : "border-[var(--color-ink)]/25 hover:border-[var(--color-ink)]/50 active:scale-[0.97]"
                    }`}
                  >
                    {qty > 0 && (
                      <span className="staff-num absolute -top-1.5 -right-1.5 min-w-6 h-6 px-1.5 rounded-full bg-[var(--color-vermillion)] text-[var(--color-cream)] text-[12px] font-semibold flex items-center justify-center shadow-[0_4px_10px_-4px_oklch(0_0_0/0.6)]">
                        {qty}
                      </span>
                    )}
                    <span className="block min-h-[2.6em] text-[14px] font-semibold leading-snug text-[var(--color-ink)] line-clamp-2">
                      {item.name}
                    </span>
                    <span className="mt-1.5 flex items-center justify-between gap-2">
                      <span className="staff-num inline-flex items-center rounded-md border border-[var(--color-ink)]/30 bg-[var(--color-ink)]/8 px-1.5 py-0.5 text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--color-ink)]/80">
                        {item.menuItemId}
                      </span>
                      {soldOut ? (
                        <span className="text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-sm bg-[var(--color-vermillion)]/10 text-[var(--color-vermillion)] border border-[var(--color-vermillion)]/25">
                          售完 Sold Out
                        </span>
                      ) : unpriced ? (
                        <span className="text-[10px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-sm bg-[var(--color-ink)]/8 text-[var(--color-ink)]/55 border border-[var(--color-ink)]/15">
                          Price TBC
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <span className="staff-num text-[16px] leading-none text-[var(--color-vermillion)]">
                            ฿{item.price}
                          </span>
                          <span className="h-7 w-7 rounded-full bg-[var(--color-ink)] text-[var(--color-cream)] flex items-center justify-center text-[15px] leading-none">
                            +
                          </span>
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
            {searching && visibleItems.length === 0 && (
              <p className="px-1 py-6 text-center text-[14px] text-[var(--color-ink)]/55">
                找不到餐點 · No items match “{search.trim()}”
              </p>
            )}
          </div>

          {/* Order lines */}
          {lines.length > 0 && (
            <ul className="rounded-xl border border-[var(--color-ink)]/15 divide-y divide-dotted divide-[var(--color-ink)]/20">
              {lines.map((line) => (
                <li key={line.menuItemId} className="px-3.5 py-2.5 flex items-center gap-3">
                  <span className="flex-1 min-w-0 truncate text-[15px] text-[var(--color-ink)]/90">
                    {line.name}
                  </span>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => changeQty(line.menuItemId, -1)}
                      aria-label={`Remove one ${line.name}`}
                      className="h-9 w-9 rounded-full bg-[var(--color-ink)]/10 text-[var(--color-ink)] text-[16px] leading-none flex items-center justify-center active:scale-90 transition"
                    >
                      −
                    </button>
                    <span className="staff-num w-6 text-center font-semibold text-[var(--color-ink)]">
                      {line.qty}
                    </span>
                    <button
                      onClick={() => changeQty(line.menuItemId, 1)}
                      aria-label={`Add one ${line.name}`}
                      className="h-9 w-9 rounded-full bg-[var(--color-ink)]/10 text-[var(--color-ink)] text-[16px] leading-none flex items-center justify-center active:scale-90 transition"
                    >
                      +
                    </button>
                  </div>
                  <span className="staff-num w-16 text-right text-[15px] text-[var(--color-vermillion)] shrink-0">
                    ฿{(line.unitPrice * line.qty).toLocaleString("en-US")}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Note */}
          <textarea
            placeholder="備註 · Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className={`${inputClass} resize-none`}
          />

          {/* Total */}
          <div className="flex items-baseline justify-between pt-1">
            <span className="text-[11px] uppercase tracking-[0.18em] font-medium text-[var(--color-ink)]/50">
              Total · 合計{totalItems > 0 ? ` · ${totalItems} items` : ""}
            </span>
            <span className="staff-num text-[24px] leading-none text-[var(--color-vermillion)]">
              <span className="mr-0.5 text-[15px]">฿</span>
              {total.toLocaleString("en-US")}
            </span>
          </div>

          {formError && (
            <p className="rounded-xl border border-[var(--color-vermillion)]/35 bg-[var(--color-vermillion)]/10 px-4 py-2.5 text-[13px] text-[var(--color-ink)]/85">
              {formError}
            </p>
          )}

          {successId && (
            <p className="rounded-xl border border-emerald-700/30 bg-emerald-600/10 px-4 py-2.5 text-[13px] text-emerald-900">
              已送出 · Order {successId} sent — it will appear under New orders.
            </p>
          )}

          <button
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="w-full h-14 rounded-xl bg-[var(--color-vermillion)] text-[var(--color-cream)] text-[16px] font-semibold tracking-[0.02em] shadow-[0_10px_20px_-12px_oklch(0_0_0/0.7)] active:scale-[0.98] transition disabled:opacity-60 disabled:cursor-wait disabled:active:scale-100"
          >
            {submitting ? "送出中 · Sending…" : "送出訂單 · Submit Order"}
          </button>
        </div>
      </div>
    </div>
  );
}
