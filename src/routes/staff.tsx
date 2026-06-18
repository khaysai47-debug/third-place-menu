import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExpenseView } from "@/components/staff/ExpenseView";
import { ManualOrderForm } from "@/components/staff/ManualOrderForm";
import { MenuAvailabilityBoard } from "@/components/staff/MenuAvailabilityBoard";
import { OrderDetailDrawer } from "@/components/staff/OrderDetailDrawer";
import { StaffOrderCard } from "@/components/staff/StaffOrderCard";
import { STATUS_META, STATUS_ORDER } from "@/components/staff/orderStatus";
import {
  getStaffOrders,
  nextStaffOrderStatus,
  updateOrderPayment,
  updateStaffOrderStatus,
  type StaffOrder,
  type StaffOrderStatus,
  type StaffPaymentMethod,
} from "@/lib/staffOrders";

export const Route = createFileRoute("/staff")({
  head: () => ({
    meta: [{ title: "The Third Place — Staff Orders" }, { name: "robots", content: "noindex" }],
  }),
  component: StaffPage,
});

type LoadState = "loading" | "error" | "ready";

type StaffView = "orders" | "menu" | "manual" | "expenses";

const STAFF_VIEWS: { view: StaffView; labelEn: string; labelZh: string }[] = [
  { view: "orders", labelEn: "Orders", labelZh: "訂單" },
  { view: "menu", labelEn: "Menu", labelZh: "菜單" },
  { view: "manual", labelEn: "Add Order", labelZh: "加單" },
  { view: "expenses", labelEn: "Expenses", labelZh: "支出" },
];

const STAFF_VIEW_TITLES: Record<StaffView, string> = {
  orders: "Staff Orders",
  menu: "Menu Availability",
  manual: "Add Order",
  expenses: "Expense Log",
};

const SUMMARY_STATUSES: StaffOrderStatus[] = ["new", "preparing", "ready", "done"];

const SUMMARY_CARD_STYLE: Partial<Record<StaffOrderStatus, { inactive: string; active: string }>> =
  {
    new: {
      inactive:
        "bg-[var(--color-vermillion)]/10 border-[var(--color-vermillion)]/25 hover:bg-[var(--color-vermillion)]/15",
      active: "bg-[var(--color-vermillion)]/18 border-[var(--color-vermillion)]/55",
    },
    preparing: {
      inactive: "bg-amber-500/10 border-amber-500/25 hover:bg-amber-500/15",
      active: "bg-amber-500/18 border-amber-500/55",
    },
    ready: {
      inactive: "bg-emerald-500/10 border-emerald-500/25 hover:bg-emerald-500/15",
      active: "bg-emerald-500/18 border-emerald-500/55",
    },
    done: {
      inactive: "bg-stone-500/8 border-stone-400/18 hover:bg-stone-500/12",
      active: "bg-stone-500/14 border-stone-400/35",
    },
  };

function StaffPage() {
  const [view, setView] = useState<StaffView>("orders");
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [activeTab, setActiveTab] = useState<StaffOrderStatus>("new");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [updatingIds, setUpdatingIds] = useState<ReadonlySet<string>>(new Set());
  const [payingIds, setPayingIds] = useState<ReadonlySet<string>>(new Set());
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Skip overlapping background refreshes, and never let a poll clobber an
  // in-flight optimistic action (it would briefly revert the card).
  const refreshingRef = useRef(false);
  const pendingActionsRef = useRef(0);
  // After a successful action, ignore refreshes for a short window so a poll
  // (or an in-flight fetch) can't overwrite the optimistic state with a stale
  // read before the backend reflects the change. Timestamp in ms; 0 = open.
  const suppressRefreshUntilRef = useRef(0);

  // True while an action is in flight or its quiet window is still open.
  const refreshBlocked = () =>
    pendingActionsRef.current > 0 || Date.now() < suppressRefreshUntilRef.current;

  const loadOrders = useCallback(async () => {
    setLoadState("loading");
    try {
      setOrders(await getStaffOrders());
      setLoadState("ready");
    } catch (error) {
      console.error("Failed to load staff orders", error);
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  // Background re-sync; keeps local state on failure. Guarded at both ends:
  // before fetching, and again after — an action may have started (or its quiet
  // window opened) while this fetch was in flight, making the result stale.
  const refreshOrders = useCallback(async () => {
    if (refreshingRef.current || refreshBlocked()) return;
    refreshingRef.current = true;
    try {
      const data = await getStaffOrders();
      if (!refreshBlocked()) setOrders(data);
    } catch (error) {
      console.error("Background refresh failed", error);
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  // Auto-update the board so new customer orders appear without a manual
  // reload. Silent (reuses refreshOrders, no loading spinner); paused while
  // the tab is hidden; overlap-guarded inside refreshOrders.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void refreshOrders();
    }, 5000);
    return () => window.clearInterval(id);
  }, [refreshOrders]);

  const counts = useMemo(() => {
    const c: Record<StaffOrderStatus, number> = {
      new: 0,
      preparing: 0,
      ready: 0,
      done: 0,
      cancelled: 0,
    };
    for (const o of orders) c[o.status] += 1;
    return c;
  }, [orders]);

  const visible = orders.filter((o) => o.status === activeTab);
  const selectedOrder = orders.find((o) => o.orderId === selectedId);

  const advanceOrder = async (orderId: string) => {
    const current = orders.find((o) => o.orderId === orderId);
    const next = current ? nextStaffOrderStatus(current.status) : null;
    if (!current || !next || updatingIds.has(orderId)) return;
    if (!current.airtableRecordId) {
      setUpdateError("此訂單無法更新 · This order can't be updated.");
      return;
    }

    const previousStatus = current.status;
    setUpdateError(null);
    setUpdatingIds((prev) => new Set(prev).add(orderId));
    pendingActionsRef.current += 1;
    // Optimistic: advance the card immediately, reconcile/revert after the API.
    setOrders((prev) => prev.map((o) => (o.orderId === orderId ? { ...o, status: next } : o)));

    try {
      const result = await updateStaffOrderStatus(current.airtableRecordId, next);
      if (result.success) {
        // Keep the optimistic state; let polling reconcile after a quiet window
        // so a not-yet-updated backend read can't bounce the card back.
        suppressRefreshUntilRef.current = Date.now() + 2500;
      } else {
        setOrders((prev) =>
          prev.map((o) => (o.orderId === orderId ? { ...o, status: previousStatus } : o)),
        );
        setUpdateError(result.error);
      }
    } catch (error) {
      console.error("Status update threw unexpectedly", error);
      setOrders((prev) =>
        prev.map((o) => (o.orderId === orderId ? { ...o, status: previousStatus } : o)),
      );
      setUpdateError("Failed to update order. Please try again.");
    } finally {
      pendingActionsRef.current -= 1;
      setUpdatingIds((prev) => {
        const nextSet = new Set(prev);
        nextSet.delete(orderId);
        return nextSet;
      });
    }
  };

  const markPaid = async (orderId: string, method: StaffPaymentMethod) => {
    const current = orders.find((o) => o.orderId === orderId);
    if (!current || current.paymentStatus === "paid" || payingIds.has(orderId)) return;
    if (!current.airtableRecordId) {
      setUpdateError("此訂單無法更新 · This order can't be updated.");
      return;
    }

    const previousPaymentStatus = current.paymentStatus;
    const previousPaymentMethod = current.paymentMethod;
    setUpdateError(null);
    setPayingIds((prev) => new Set(prev).add(orderId));
    pendingActionsRef.current += 1;
    // Optimistic: mark paid immediately, reconcile/revert after the API.
    setOrders((prev) =>
      prev.map((o) =>
        o.orderId === orderId ? { ...o, paymentStatus: "paid", paymentMethod: method } : o,
      ),
    );

    try {
      const result = await updateOrderPayment(current.airtableRecordId, method);
      if (result.success) {
        // Keep the optimistic state; let polling reconcile after a quiet window
        // so a not-yet-updated backend read can't bounce the card back.
        suppressRefreshUntilRef.current = Date.now() + 2500;
      } else {
        setOrders((prev) =>
          prev.map((o) =>
            o.orderId === orderId
              ? { ...o, paymentStatus: previousPaymentStatus, paymentMethod: previousPaymentMethod }
              : o,
          ),
        );
        setUpdateError(result.error);
      }
    } catch (error) {
      console.error("Payment update threw unexpectedly", error);
      setOrders((prev) =>
        prev.map((o) =>
          o.orderId === orderId
            ? { ...o, paymentStatus: previousPaymentStatus, paymentMethod: previousPaymentMethod }
            : o,
        ),
      );
      setUpdateError("Failed to update payment. Please try again.");
    } finally {
      pendingActionsRef.current -= 1;
      setPayingIds((prev) => {
        const next = new Set(prev);
        next.delete(orderId);
        return next;
      });
    }
  };

  return (
    <div className="min-h-screen ink-grain">
      <main className="mx-auto max-w-[1100px] pb-16">
        {/* Header */}
        <header className="px-5 pt-6 pb-4">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.18em] text-[var(--color-gold-soft)]/80">
            <span>員工 · Staff</span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Live
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-3">
            <h1 className="font-display text-[26px] sm:text-[30px] leading-tight text-[var(--color-cream)]">
              The <span className="text-[var(--color-vermillion)]">Third</span> Place —{" "}
              {STAFF_VIEW_TITLES[view]}
            </h1>
            <span className="hidden sm:block divider-stamp flex-1 translate-y-[-6px] opacity-60" />
          </div>

          {/* View switcher — scrollable on small screens, comfortable on iPad */}
          <div className="mt-4 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="inline-flex rounded-full border border-[var(--color-gold)]/25 bg-[var(--color-charcoal-soft)]/60 p-1 min-w-max">
              {STAFF_VIEWS.map(({ view: v, labelEn, labelZh }) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`h-11 px-4 rounded-full text-[14px] font-medium tracking-[0.02em] transition active:scale-[0.97] ${
                    view === v
                      ? "bg-[var(--color-vermillion)] text-[var(--color-cream)]"
                      : "text-[var(--color-gold-soft)]/90 hover:text-[var(--color-cream)]"
                  }`}
                >
                  {labelEn} <span className="opacity-70">{labelZh}</span>
                </button>
              ))}
            </div>
          </div>
        </header>

        {view === "expenses" ? (
          <ExpenseView />
        ) : view === "menu" ? (
          <MenuAvailabilityBoard />
        ) : view === "manual" ? (
          <ManualOrderForm onSubmitted={() => void refreshOrders()} />
        ) : (
          <>
            {/* Summary cards */}
            <div className="px-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {SUMMARY_STATUSES.map((status) => {
                const meta = STATUS_META[status];
                const active = activeTab === status;
                return (
                  <button
                    key={status}
                    onClick={() => setActiveTab(status)}
                    className={`rounded-2xl border px-4 py-3.5 text-left transition active:scale-[0.98] ${
                      active
                        ? (SUMMARY_CARD_STYLE[status]?.active ?? "bg-[var(--color-charcoal-soft)] border-[var(--color-gold)]/60")
                        : (SUMMARY_CARD_STYLE[status]?.inactive ?? "bg-[var(--color-charcoal-soft)]/50 border-[var(--color-gold)]/20")
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] uppercase tracking-[0.2em] font-medium text-[var(--color-gold-soft)]/90">
                        {meta.labelEn}
                      </span>
                      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                    </div>
                    <div className="mt-2 flex items-baseline justify-between gap-2">
                      <span className="staff-num text-[34px] leading-none text-[var(--color-cream)]">
                        {counts[status]}
                      </span>
                      <span className="text-[12px] text-[var(--color-muted-foreground)]">
                        {meta.labelZh}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Status filter tabs */}
            <nav className="sticky top-0 z-30 mt-4 backdrop-blur supports-[backdrop-filter]:bg-[var(--color-charcoal)]/85 bg-[var(--color-charcoal)] border-y border-[var(--color-gold)]/15">
              <div className="px-5 py-2.5 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {STATUS_ORDER.map((status) => {
                  const meta = STATUS_META[status];
                  const active = activeTab === status;
                  return (
                    <button
                      key={status}
                      onClick={() => setActiveTab(status)}
                      className={`shrink-0 h-12 px-4 rounded-full border text-[14px] font-medium tracking-[0.02em] flex items-center gap-2 transition active:scale-[0.97] ${
                        active
                          ? "bg-[var(--color-vermillion)] border-[var(--color-vermillion)] text-[var(--color-cream)]"
                          : "border-[var(--color-gold)]/25 text-[var(--color-gold-soft)]/90 hover:border-[var(--color-gold)]/50"
                      }`}
                    >
                      <span>
                        {meta.labelEn} {meta.labelZh}
                      </span>
                      <span
                        className={`staff-num min-w-6 h-6 px-1.5 rounded-full text-[12px] font-semibold flex items-center justify-center ${
                          active
                            ? "bg-[var(--color-cream)]/20 text-[var(--color-cream)]"
                            : "bg-[var(--color-charcoal-soft)] text-[var(--color-gold-soft)]"
                        }`}
                      >
                        {counts[status]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </nav>

            {/* Status update error */}
            {updateError && loadState === "ready" && (
              <div className="mt-4 mx-5 rounded-xl border border-[var(--color-vermillion)]/40 bg-[var(--color-vermillion)]/10 px-4 py-3 flex items-center justify-between gap-3">
                <p className="text-[14px] text-[var(--color-cream)]/90">{updateError}</p>
                <button
                  onClick={() => setUpdateError(null)}
                  aria-label="Dismiss 關閉"
                  className="h-9 w-9 shrink-0 rounded-full bg-[var(--color-cream)]/10 text-[var(--color-cream)]/60 flex items-center justify-center hover:bg-[var(--color-cream)]/20 transition"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Order cards */}
            {loadState === "loading" ? (
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
                  載入訂單 · Loading orders…
                </p>
              </div>
            ) : loadState === "error" ? (
              <div className="mt-10 px-5">
                <div className="mx-auto max-w-[440px] rounded-2xl border border-[var(--color-vermillion)]/40 bg-[var(--color-charcoal-soft)]/70 px-6 py-8 text-center">
                  <p className="font-display text-[22px] text-[var(--color-cream)]">
                    無法載入訂單 · Can't load orders
                  </p>
                  <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
                    Check the order server, then try again.
                  </p>
                  <button
                    onClick={() => void loadOrders()}
                    className="mt-5 h-12 px-8 rounded-full bg-[var(--color-vermillion)] text-[var(--color-cream)] text-[15px] font-semibold tracking-[0.02em] active:scale-[0.97] transition"
                  >
                    重試 · Retry
                  </button>
                </div>
              </div>
            ) : orders.length === 0 ? (
              <div className="mt-12 px-5 text-center">
                <div className="flex items-center justify-center gap-3 mb-3">
                  <span className="h-px w-10 bg-[var(--color-gold)]/40" />
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-gold)]/50" />
                  <span className="h-px w-10 bg-[var(--color-gold)]/40" />
                </div>
                <p className="font-display text-[20px] text-[var(--color-gold-soft)]/80">
                  目前沒有訂單 · No orders yet
                </p>
              </div>
            ) : visible.length > 0 ? (
              <div className="mt-5 px-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 auto-rows-fr gap-4">
                {visible.map((order) => (
                  <StaffOrderCard
                    key={order.orderId}
                    order={order}
                    updating={updatingIds.has(order.orderId)}
                    onAdvance={advanceOrder}
                    onOpen={setSelectedId}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-12 px-5 text-center">
                <div className="flex items-center justify-center gap-3 mb-3">
                  <span className="h-px w-10 bg-[var(--color-gold)]/40" />
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${STATUS_META[activeTab].dotClass} opacity-60`}
                  />
                  <span className="h-px w-10 bg-[var(--color-gold)]/40" />
                </div>
                <p className="font-display text-[20px] text-[var(--color-gold-soft)]/80">
                  沒有訂單 · No {STATUS_META[activeTab].labelEn.toLowerCase()} orders
                </p>
              </div>
            )}
          </>
        )}
      </main>

      {selectedOrder && (
        <OrderDetailDrawer
          order={selectedOrder}
          updating={updatingIds.has(selectedOrder.orderId)}
          paying={payingIds.has(selectedOrder.orderId)}
          updateError={updateError}
          onAdvance={advanceOrder}
          onMarkPaid={markPaid}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
