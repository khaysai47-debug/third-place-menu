import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { OrderDetailDrawer } from "@/components/staff/OrderDetailDrawer";
import { StaffOrderCard } from "@/components/staff/StaffOrderCard";
import { STATUS_META, STATUS_ORDER } from "@/components/staff/orderStatus";
import {
  getStaffOrders,
  nextStaffOrderStatus,
  updateStaffOrderStatus,
  type StaffOrder,
  type StaffOrderStatus,
} from "@/lib/staffOrders";

export const Route = createFileRoute("/staff")({
  head: () => ({
    meta: [
      { title: "The Third Place — Staff Orders" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: StaffPage,
});

type LoadState = "loading" | "error" | "ready";

const SUMMARY_STATUSES: StaffOrderStatus[] = ["new", "preparing", "ready", "done"];

function StaffPage() {
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [activeTab, setActiveTab] = useState<StaffOrderStatus>("new");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const advanceOrder = (orderId: string) => {
    const current = orders.find((o) => o.orderId === orderId);
    const next = current ? nextStaffOrderStatus(current.status) : null;
    if (!next) return;
    setOrders((prev) => prev.map((o) => (o.orderId === orderId ? { ...o, status: next } : o)));
    // Mock persistence for now; becomes the real backend call (with rollback
    // on failure) in the integration phase.
    void updateStaffOrderStatus(orderId, next);
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
              The <span className="text-[var(--color-vermillion)]">Third</span> Place — Staff Orders
            </h1>
            <span className="hidden sm:block divider-stamp flex-1 translate-y-[-6px] opacity-60" />
          </div>
        </header>

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
                    ? "border-[var(--color-gold)]/60 bg-[var(--color-charcoal-soft)]"
                    : "border-[var(--color-gold)]/20 bg-[var(--color-charcoal-soft)]/50 hover:border-[var(--color-gold)]/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] font-medium text-[var(--color-gold-soft)]/90">
                    {meta.labelEn}
                  </span>
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="font-display text-[34px] leading-none text-[var(--color-cream)] tabular-nums">
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
                    className={`min-w-6 h-6 px-1.5 rounded-full text-[12px] font-semibold tabular-nums flex items-center justify-center ${
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
                onAdvance={advanceOrder}
                onOpen={setSelectedId}
              />
            ))}
          </div>
        ) : (
          <div className="mt-12 px-5 text-center">
            <div className="flex items-center justify-center gap-3 mb-3">
              <span className="h-px w-10 bg-[var(--color-gold)]/40" />
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[activeTab].dotClass} opacity-60`} />
              <span className="h-px w-10 bg-[var(--color-gold)]/40" />
            </div>
            <p className="font-display text-[20px] text-[var(--color-gold-soft)]/80">
              沒有訂單 · No {STATUS_META[activeTab].labelEn.toLowerCase()} orders
            </p>
          </div>
        )}
      </main>

      {selectedOrder && (
        <OrderDetailDrawer
          order={selectedOrder}
          onAdvance={advanceOrder}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
