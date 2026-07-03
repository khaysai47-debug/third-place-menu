// Owner Dashboard v1 — read-only control room. Reuses the same order feed as the
// staff board (getStaffOrders) and derives tonight's money figures with
// summarizeToday. No write actions, no backend changes. Realized (paid) revenue
// is the headline; unpaid and done-but-unpaid are surfaced separately for
// payment auditing. Layout only: 3-column shell (sidebar / main / needs-attention)
// on desktop, single column on mobile. All numbers come from real data.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  Bike,
  ClipboardList,
  ExternalLink,
  Flame,
  LayoutGrid,
  LineChart as LineChartIcon,
  MapPin,
  Phone,
  Receipt,
  RefreshCw,
  Scale,
  Settings,
  Star,
  TrendingDown,
  User,
  UtensilsCrossed,
  Wallet,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from "recharts";
import { orderLocation } from "@/components/staff/StaffOrderCard";
import { PAYMENT_META, STATUS_META } from "@/components/staff/orderStatus";
import { getStaffOrders, type StaffOrder, type StaffOrderStatus } from "@/lib/staffOrders";
import { isSameLocalDay, summarizeToday, todaysOrders } from "@/lib/ownerSummary";
import { getExpenses, type Expense } from "@/lib/expenses";
import { CATEGORIES, MENU, type MenuCategoryId } from "@/data/menu";

export const Route = createFileRoute("/owner")({
  head: () => ({
    meta: [{ title: "The Third Place — Owner" }, { name: "robots", content: "noindex" }],
  }),
  component: OwnerPage,
});

type LoadState = "loading" | "error" | "ready";

const baht = (n: number) => `฿${n.toLocaleString("en-US")}`;
const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function dateLabel(now: Date): string {
  return now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

const OWNER_NAME = "Mike Li";

function greeting(now: Date): string {
  const h = now.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function locText(o: StaffOrder): string {
  const loc = orderLocation(o);
  return loc.num ? `${loc.big} ${loc.num}` : loc.big;
}

function itemsSummary(o: StaffOrder): string {
  const names = o.items.map((i) => i.name).filter(Boolean);
  if (names.length === 0) return "—";
  const head = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${head} +${names.length - 2}` : head;
}

function OwnerPage() {
  const [orders, setOrders] = useState<StaffOrder[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  // Stamped on every (re)load so the "today" window and header date stay correct
  // across midnight without a manual reload. `now` only changes when data does.
  const [nowTs, setNowTs] = useState(() => Date.now());
  const now = useMemo(() => new Date(nowTs), [nowTs]);

  const refreshingRef = useRef(false);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expLoadState, setExpLoadState] = useState<LoadState>("loading");
  const expRefreshingRef = useRef(false);

  const loadOrders = useCallback(async () => {
    setLoadState("loading");
    try {
      setOrders(await getStaffOrders());
      setNowTs(Date.now());
      setLoadState("ready");
    } catch (error) {
      console.error("Failed to load owner dashboard orders", error);
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  const loadExpenses = useCallback(async () => {
    setExpLoadState("loading");
    try {
      setExpenses(await getExpenses());
      setExpLoadState("ready");
    } catch (err) {
      console.error("Owner expense fetch failed", err);
      setExpLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadExpenses();
  }, [loadExpenses]);

  // Silent background re-sync (read-only, no optimistic state to protect).
  // Paused while the tab is hidden; overlap-guarded.
  const refreshOrders = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      setOrders(await getStaffOrders());
      setNowTs(Date.now());
    } catch (error) {
      console.error("Owner dashboard refresh failed", error);
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  const silentRefreshExpenses = useCallback(async () => {
    if (expRefreshingRef.current) return;
    expRefreshingRef.current = true;
    try {
      setExpenses(await getExpenses());
      setExpLoadState("ready");
    } catch { /* silent — order data is still live */ }
    finally { expRefreshingRef.current = false; }
  }, []);

  // Auto-polling disabled — use the manual Refresh button to avoid burning n8n executions.

  // Auto-polling disabled — use the manual Refresh button.

  const summary = useMemo(() => summarizeToday(orders, now), [orders, now]);
  const today = useMemo(() => todaysOrders(orders, now), [orders, now]);
  // Completed (done or delivered) but unpaid — food/delivery out, money not collected.
  const doneUnpaid = useMemo(
    () =>
      today.filter(
        (o) => (o.status === "done" || o.status === "delivered") && o.paymentStatus === "unpaid",
      ),
    [today],
  );
  // Unpaid and still active — exclude completed and cancelled statuses.
  const unpaidOpen = useMemo(
    () =>
      today.filter(
        (o) =>
          o.status !== "done" &&
          o.status !== "delivered" &&
          o.status !== "cancelled" &&
          o.paymentStatus === "unpaid",
      ),
    [today],
  );
  // Delivery pipeline.
  const activeDeliveries = useMemo(
    () =>
      today.filter(
        (o) =>
          o.orderType === "delivery" &&
          (o.status === "new" ||
            o.status === "preparing" ||
            o.status === "ready" ||
            o.status === "out_for_delivery"),
      ),
    [today],
  );
  const outForDeliveryNow = useMemo(
    () => orders.filter((o) => o.status === "out_for_delivery"),
    [orders],
  );
  const deliveredToday = useMemo(
    () => today.filter((o) => o.orderType === "delivery" && o.status === "delivered"),
    [today],
  );
  // Cancelled today — use cancelledAt when available, fall back to createdAt.
  const cancelledToday = useMemo(
    () =>
      orders.filter(
        (o) => o.status === "cancelled" && isSameLocalDay(o.cancelledAt ?? o.createdAt, now),
      ),
    [orders, now],
  );
  const cancelledTodayValue = useMemo(
    () => cancelledToday.reduce((s, o) => s + o.totalPrice, 0),
    [cancelledToday],
  );
  // Recent orders today (including cancelled), newest-first from API sort.
  const recentAll = useMemo(
    () => orders.filter((o) => isSameLocalDay(o.createdAt, now)).slice(0, 12),
    [orders, now],
  );
  // Expenses filtered to today by local calendar day (safe even if API returns more).
  const expensesToday = useMemo(
    () => expenses.filter((e) => isSameLocalDay(e.createdAt, now)),
    [expenses, now],
  );
  const expensesTotalToday = useMemo(
    () => expensesToday.reduce((s, e) => s + e.amount, 0),
    [expensesToday],
  );

  const [selectedOrder, setSelectedOrder] = useState<StaffOrder | null>(null);
  const [activeSection, setActiveSection] = useState<OwnerSection>("overview");

  // All orders today including cancelled — for the Orders view.
  const allTodayOrders = useMemo(
    () => orders.filter((o) => isSameLocalDay(o.createdAt, now)),
    [orders, now],
  );

  return (
    <div
      className="min-h-screen ink-grain lg:flex"
      style={{ backgroundColor: "oklch(0.145 0.005 60)" }}
    >
      {selectedOrder && (
        <OwnerOrderModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}
      <OwnerSidebar activeSection={activeSection} onSectionChange={setActiveSection} />

      <div className="min-w-0 flex-1">
        <OwnerHeader
          now={now}
          live={loadState === "ready"}
          onRefresh={() => { void refreshOrders(); void silentRefreshExpenses(); }}
        />

        {loadState === "loading" ? (
          <LoadingState />
        ) : loadState === "error" ? (
          <ErrorState onRetry={() => void loadOrders()} />
        ) : activeSection === "orders" ? (
          <OwnerOrdersView
            orders={allTodayOrders}
            now={now}
            onSelectOrder={setSelectedOrder}
          />
        ) : activeSection === "payments" ? (
          <OwnerPaymentsView
            orders={allTodayOrders}
            now={now}
            onSelectOrder={setSelectedOrder}
          />
        ) : activeSection === "reports" ? (
          <OwnerReportsView
            orders={allTodayOrders}
            expensesTotal={expensesTotalToday}
            expLoadState={expLoadState}
            now={now}
            onSelectOrder={setSelectedOrder}
          />
        ) : activeSection === "menu" ? (
          <OwnerMenuView />
        ) : (
          <main className="mx-auto w-full max-w-[1600px] px-5 py-6 lg:px-8">
            <p className="mb-4 text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted-foreground)]">
              Today&apos;s operations snapshot · 營運快照
            </p>
            <div className="grid grid-cols-12 gap-6">
            <section className="col-span-12 space-y-6 xl:col-span-8">
              <Hero summary={summary} />
              <MetricsGrid summary={summary} />
              <ExpenseNetRow
                expensesTotal={expensesTotalToday}
                collected={summary.collected}
                expLoadState={expLoadState}
              />
              <RevenueTrend orders={orders} now={now} />
              <RecentOrders recent={recentAll} onSelectOrder={setSelectedOrder} />
            </section>

            <aside className="col-span-12 space-y-6 xl:col-span-4">
              <NeedsAttention
                doneUnpaid={doneUnpaid}
                unpaidOpen={unpaidOpen}
                activeDeliveries={activeDeliveries}
                onSelectOrder={setSelectedOrder}
              />
              <DeliveryWatch
                activeCount={activeDeliveries.length}
                outNowCount={outForDeliveryNow.length}
                deliveredCount={deliveredToday.length}
              />
              {cancelledToday.length > 0 && (
                <CancelledToday
                  orders={cancelledToday}
                  totalValue={cancelledTodayValue}
                  onSelectOrder={setSelectedOrder}
                />
              )}
              <PaymentMix
                collected={summary.collected}
                cash={summary.cash}
                transfer={summary.transfer}
                unpaid={summary.unpaidTotal}
                unpaidCount={summary.unpaidCount}
              />
              <ExpenseSummary
                expenses={expenses}
                loadState={expLoadState}
                onRetry={() => void loadExpenses()}
              />
            </aside>
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

/* ---------- Orders view ---------- */

type OrderFilter = "all" | "active" | "delivery" | "unpaid" | "cancelled" | "completed";

const ORDER_FILTERS: { id: OrderFilter; label: string; labelZh: string }[] = [
  { id: "all",       label: "All",       labelZh: "全部"  },
  { id: "active",    label: "Active",    labelZh: "進行中" },
  { id: "delivery",  label: "Delivery",  labelZh: "外送"  },
  { id: "unpaid",    label: "Unpaid",    labelZh: "未付"  },
  { id: "cancelled", label: "Cancelled", labelZh: "已取消" },
  { id: "completed", label: "Completed", labelZh: "已完成" },
];

function applyOrderFilter(orders: StaffOrder[], filter: OrderFilter): StaffOrder[] {
  switch (filter) {
    case "active":
      return orders.filter(
        (o) =>
          o.status !== "cancelled" &&
          o.status !== "done" &&
          o.status !== "delivered",
      );
    case "delivery":
      return orders.filter((o) => o.orderType === "delivery");
    case "unpaid":
      return orders.filter((o) => o.paymentStatus === "unpaid" && o.status !== "cancelled");
    case "cancelled":
      return orders.filter((o) => o.status === "cancelled");
    case "completed":
      return orders.filter((o) => o.status === "done" || o.status === "delivered");
    default:
      return orders;
  }
}

function OwnerOrdersView({
  orders,
  now,
  onSelectOrder,
}: {
  orders: StaffOrder[];
  now: Date;
  onSelectOrder: (o: StaffOrder) => void;
}) {
  const [filter, setFilter] = useState<OrderFilter>("all");
  const visible = useMemo(() => applyOrderFilter(orders, filter), [orders, filter]);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-6 lg:px-8">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[22px] leading-none text-[var(--color-cream)]">
            Orders · 今日訂單
          </h2>
          <p className="mt-1 text-[12px] uppercase tracking-[0.14em] text-[var(--color-muted-foreground)]">
            {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            {" · "}{orders.length} total · order audit trail
          </p>
        </div>
      </div>

      {/* Filter pills */}
      <div className="mb-5 flex flex-wrap gap-2">
        {ORDER_FILTERS.map(({ id, label, labelZh }) => {
          const count = applyOrderFilter(orders, id).length;
          const isActive = filter === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium tracking-[0.06em] transition-colors ${
                isActive
                  ? "border-[var(--color-gold)]/60 bg-[var(--color-gold)]/12 text-[var(--color-gold)]"
                  : "border-[var(--color-gold)]/15 text-[var(--color-muted-foreground)] hover:border-[var(--color-gold)]/30 hover:text-[var(--color-cream)]/70"
              }`}
            >
              {label} · {labelZh}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                  isActive
                    ? "bg-[var(--color-gold)]/20 text-[var(--color-gold)]"
                    : "bg-[var(--color-gold)]/8 text-[var(--color-muted-foreground)]"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[14px] text-[var(--color-muted-foreground)]">No orders match this filter.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--color-gold)]/12 bg-[var(--color-charcoal-soft)]/40">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-gold)]/12">
                {["Order / Location", "Items", "Payment", "Total", "Status", "Time"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.14em] font-medium text-[var(--color-muted-foreground)]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-gold)]/8">
              {visible.map((order) => (
                <OwnerOrderRow key={order.orderId} order={order} onClick={() => onSelectOrder(order)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Dark-background-appropriate status badge classes for the owner orders table.
// STATUS_META.badgeClass uses text-[var(--color-ink)] for done/delivered/cancelled
// which is near-invisible on the dark charcoal owner dashboard.
const OWNER_STATUS_BADGE: Record<
  StaffOrderStatus,
  { bg: string; text: string; border: string; dot: string }
> = {
  new:              { bg: "bg-[var(--color-vermillion)]/12", text: "text-[var(--color-vermillion)]",  border: "border-[var(--color-vermillion)]/28", dot: "bg-[var(--color-vermillion)]"   },
  preparing:        { bg: "bg-amber-500/12",                 text: "text-amber-300",                  border: "border-amber-400/28",                  dot: "bg-amber-400"                  },
  ready:            { bg: "bg-emerald-500/12",               text: "text-emerald-300",                border: "border-emerald-400/28",                dot: "bg-emerald-400"               },
  out_for_delivery: { bg: "bg-sky-500/12",                   text: "text-sky-300",                    border: "border-sky-400/28",                    dot: "bg-sky-400"                    },
  delivered:        { bg: "bg-emerald-500/8",                text: "text-emerald-300/80",             border: "border-emerald-400/20",                dot: "bg-emerald-400/70"            },
  done:             { bg: "bg-[var(--color-cream)]/6",       text: "text-[var(--color-cream)]/55",    border: "border-[var(--color-cream)]/12",       dot: "bg-[var(--color-cream)]/45"   },
  cancelled:        { bg: "bg-[var(--color-vermillion)]/8",  text: "text-[var(--color-vermillion)]/60", border: "border-[var(--color-vermillion)]/18", dot: "bg-[var(--color-vermillion)]/55" },
};

function OwnerOrderRow({ order, onClick }: { order: StaffOrder; onClick: () => void }) {
  const statusMeta = STATUS_META[order.status];
  const payMeta = PAYMENT_META[order.paymentStatus];
  const statusDark = OWNER_STATUS_BADGE[order.status];
  const loc = orderLocation(order);
  const cancelled = order.status === "cancelled";
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
  const itemSummary =
    order.items.length === 1
      ? `${order.items[0].quantity}× ${order.items[0].name}`
      : `${totalQty} items (${order.items.length} lines)`;

  return (
    <tr
      onClick={onClick}
      className={`group cursor-pointer transition-colors hover:bg-[var(--color-gold)]/[0.04] ${
        cancelled ? "opacity-55" : ""
      }`}
    >
      {/* Order / Location */}
      <td className="px-4 py-3">
        <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-muted-foreground)] tabular-nums">
          {order.orderId}
        </p>
        <p className="mt-0.5 font-medium text-[var(--color-cream)]/85">
          {loc.big}
          {loc.num !== undefined && (
            <span className="ml-1.5 tabular-nums text-[var(--color-gold)]">{loc.num}</span>
          )}
          <span className="ml-2 text-[11px] text-[var(--color-muted-foreground)]">{loc.zh}</span>
        </p>
        {order.orderType === "delivery" && order.customerName && (
          <p className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)] truncate max-w-[160px]">
            {order.customerName}
            {order.customerPhone && ` · ${order.customerPhone}`}
          </p>
        )}
        {cancelled && order.cancellationReason && (
          <p className="mt-0.5 text-[11px] text-[var(--color-vermillion)]/70 truncate max-w-[160px]">
            {order.cancellationReason}
          </p>
        )}
      </td>

      {/* Items */}
      <td className="px-4 py-3 text-[var(--color-cream)]/70 max-w-[180px]">
        <p className="truncate">{itemSummary}</p>
      </td>

      {/* Payment */}
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-[0.05em] ${payMeta.badgeClass}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${payMeta.dotClass}`} />
          {payMeta.labelEn}
        </span>
        {order.paymentStatus === "paid" && order.paymentMethod && (
          <p className="mt-0.5 text-[10px] text-[var(--color-muted-foreground)] uppercase tracking-[0.1em]">
            {order.paymentMethod}
          </p>
        )}
      </td>

      {/* Total */}
      <td className="px-4 py-3 tabular-nums text-[var(--color-cream)]/85 font-medium">
        ฿{order.totalPrice.toLocaleString("en-US")}
      </td>

      {/* Status */}
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-[0.05em] ${statusDark.bg} ${statusDark.text} ${statusDark.border}`}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDark.dot}`} />
          {statusMeta.labelEn} · {statusMeta.labelZh}
        </span>
      </td>

      {/* Time */}
      <td className="px-4 py-3 tabular-nums text-[var(--color-muted-foreground)] text-[12px] whitespace-nowrap">
        {order.time}
      </td>
    </tr>
  );
}

/* ---------- Payments view ---------- */
// Read-only payment audit over today's orders (same data the Orders view uses).
// Cancelled orders never count toward money totals; they only appear under "All"
// so the audit trail stays complete. "Risk" = food handed out (done/delivered)
// but payment_status still unpaid — money should exist but doesn't.

type PaymentFilter = "all" | "paid" | "unpaid" | "cash" | "transfer" | "risk";

const PAYMENT_FILTERS: { id: PaymentFilter; label: string; labelZh: string }[] = [
  { id: "all",      label: "All",      labelZh: "全部" },
  { id: "paid",     label: "Paid",     labelZh: "已付" },
  { id: "unpaid",   label: "Unpaid",   labelZh: "未付" },
  { id: "cash",     label: "Cash",     labelZh: "現金" },
  { id: "transfer", label: "Transfer", labelZh: "轉帳" },
  { id: "risk",     label: "Risk",     labelZh: "風險" },
];

function isPaymentRisk(o: StaffOrder): boolean {
  return (o.status === "done" || o.status === "delivered") && o.paymentStatus === "unpaid";
}

function applyPaymentFilter(orders: StaffOrder[], filter: PaymentFilter): StaffOrder[] {
  switch (filter) {
    case "paid":
      return orders.filter((o) => o.paymentStatus === "paid" && o.status !== "cancelled");
    case "unpaid":
      return orders.filter((o) => o.paymentStatus === "unpaid" && o.status !== "cancelled");
    case "cash":
      return orders.filter(
        (o) => o.paymentStatus === "paid" && o.paymentMethod === "Cash" && o.status !== "cancelled",
      );
    case "transfer":
      return orders.filter(
        (o) =>
          o.paymentStatus === "paid" && o.paymentMethod === "Transfer" && o.status !== "cancelled",
      );
    case "risk":
      return orders.filter(isPaymentRisk);
    default:
      return orders;
  }
}

function OwnerPaymentsView({
  orders,
  now,
  onSelectOrder,
}: {
  orders: StaffOrder[];
  now: Date;
  onSelectOrder: (o: StaffOrder) => void;
}) {
  const [filter, setFilter] = useState<PaymentFilter>("all");
  const visible = useMemo(() => applyPaymentFilter(orders, filter), [orders, filter]);

  // Money totals — cancelled orders excluded, same convention as summarizeToday.
  const totals = useMemo(() => {
    let paid = 0;
    let unpaid = 0;
    let cash = 0;
    let transfer = 0;
    let riskCount = 0;
    for (const o of orders) {
      if (o.status === "cancelled") continue;
      if (o.paymentStatus === "paid") {
        paid += o.totalPrice;
        if (o.paymentMethod === "Cash") cash += o.totalPrice;
        else if (o.paymentMethod === "Transfer") transfer += o.totalPrice;
      } else {
        unpaid += o.totalPrice;
        if (isPaymentRisk(o)) riskCount += 1;
      }
    }
    return { paid, unpaid, cash, transfer, riskCount };
  }, [orders]);

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-6 lg:px-8">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[22px] leading-none text-[var(--color-cream)]">
            Payments · 今日收款
          </h2>
          <p className="mt-1 text-[12px] uppercase tracking-[0.14em] text-[var(--color-muted-foreground)]">
            {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            {" · "}payment audit · read-only
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <SupportCard
          icon={Banknote}
          label="Paid"
          labelZh="已付"
          value={baht(totals.paid)}
          sub="collected today"
          tone="money"
          animDelay={60}
        />
        <SupportCard
          icon={AlertTriangle}
          label="Unpaid"
          labelZh="未付"
          value={baht(totals.unpaid)}
          sub="outstanding"
          tone={totals.unpaid > 0 ? "warn" : "muted"}
          animDelay={120}
        />
        <SupportCard
          icon={Wallet}
          label="Cash"
          labelZh="現金"
          value={baht(totals.cash)}
          sub="paid in cash"
          tone="money"
          animDelay={180}
        />
        <SupportCard
          icon={ArrowLeftRight}
          label="Transfer"
          labelZh="轉帳"
          value={baht(totals.transfer)}
          sub="paid by transfer"
          tone="money"
          animDelay={240}
        />
        <SupportCard
          icon={Receipt}
          label="Risk"
          labelZh="風險"
          value={String(totals.riskCount)}
          sub="done/delivered, unpaid"
          tone={totals.riskCount > 0 ? "alert" : "muted"}
          animDelay={300}
        />
      </div>

      {/* Filter pills */}
      <div className="mb-5 flex flex-wrap gap-2">
        {PAYMENT_FILTERS.map(({ id, label, labelZh }) => {
          const count = applyPaymentFilter(orders, id).length;
          const isActive = filter === id;
          const isRisk = id === "risk";
          return (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium tracking-[0.06em] transition-colors ${
                isActive
                  ? isRisk
                    ? "border-[var(--color-vermillion)]/60 bg-[var(--color-vermillion)]/12 text-[var(--color-vermillion)]"
                    : "border-[var(--color-gold)]/60 bg-[var(--color-gold)]/12 text-[var(--color-gold)]"
                  : "border-[var(--color-gold)]/15 text-[var(--color-muted-foreground)] hover:border-[var(--color-gold)]/30 hover:text-[var(--color-cream)]/70"
              }`}
            >
              {label} · {labelZh}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                  isActive
                    ? isRisk
                      ? "bg-[var(--color-vermillion)]/20 text-[var(--color-vermillion)]"
                      : "bg-[var(--color-gold)]/20 text-[var(--color-gold)]"
                    : "bg-[var(--color-gold)]/8 text-[var(--color-muted-foreground)]"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Table */}
      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[14px] text-[var(--color-muted-foreground)]">
            No payments match this filter.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--color-gold)]/12 bg-[var(--color-charcoal-soft)]/40">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-gold)]/12">
                {["Order / Location", "Payment", "Method", "Total", "Paid At", "Status", "Proof"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.14em] font-medium text-[var(--color-muted-foreground)]"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-gold)]/8">
              {visible.map((order) => (
                <OwnerPaymentRow
                  key={order.orderId}
                  order={order}
                  onClick={() => onSelectOrder(order)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function OwnerPaymentRow({ order, onClick }: { order: StaffOrder; onClick: () => void }) {
  const statusMeta = STATUS_META[order.status];
  const payMeta = PAYMENT_META[order.paymentStatus];
  const statusDark = OWNER_STATUS_BADGE[order.status];
  const loc = orderLocation(order);
  const cancelled = order.status === "cancelled";
  const risk = isPaymentRisk(order);
  const paid = order.paymentStatus === "paid";
  const paidAtLabel = ownerFmtTime(order.paidAt);

  return (
    <tr
      onClick={onClick}
      className={`group cursor-pointer transition-colors hover:bg-[var(--color-gold)]/[0.04] ${
        cancelled ? "opacity-55" : ""
      }`}
    >
      {/* Order / Location */}
      <td
        className={`border-l-2 px-4 py-3 ${
          risk ? "border-[var(--color-vermillion)]" : "border-transparent"
        }`}
      >
        <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--color-muted-foreground)] tabular-nums">
          {order.orderId}
        </p>
        <p className="mt-0.5 font-medium text-[var(--color-cream)]/85">
          {loc.big}
          {loc.num !== undefined && (
            <span className="ml-1.5 tabular-nums text-[var(--color-gold)]">{loc.num}</span>
          )}
          <span className="ml-2 text-[11px] text-[var(--color-muted-foreground)]">{loc.zh}</span>
        </p>
        {order.orderType === "delivery" && order.customerName && (
          <p className="mt-0.5 text-[11px] text-[var(--color-muted-foreground)] truncate max-w-[160px]">
            {order.customerName}
          </p>
        )}
      </td>

      {/* Payment status */}
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-[0.05em] ${payMeta.badgeClass}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${payMeta.dotClass}`} />
          {payMeta.labelEn}
        </span>
        {risk && (
          <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[var(--color-vermillion)]">
            Risk · 風險
          </p>
        )}
      </td>

      {/* Method */}
      <td className="px-4 py-3 text-[12px]">
        {paid && order.paymentMethod ? (
          <span className="inline-flex items-center gap-1.5 text-[var(--color-cream)]/80">
            {order.paymentMethod === "Cash" ? (
              <Wallet className="h-3 w-3" strokeWidth={1.5} />
            ) : (
              <ArrowLeftRight className="h-3 w-3" strokeWidth={1.5} />
            )}
            {order.paymentMethod}
          </span>
        ) : (
          <span className="text-[var(--color-muted-foreground)]/60">—</span>
        )}
      </td>

      {/* Total */}
      <td
        className={`px-4 py-3 tabular-nums font-medium ${
          cancelled
            ? "text-[var(--color-muted-foreground)] line-through"
            : "text-[var(--color-cream)]/85"
        }`}
      >
        ฿{order.totalPrice.toLocaleString("en-US")}
      </td>

      {/* Paid at */}
      <td className="px-4 py-3 tabular-nums text-[12px] whitespace-nowrap">
        {paid && paidAtLabel ? (
          <span className="text-[var(--color-cream)]/75">{paidAtLabel}</span>
        ) : (
          <span className="text-[var(--color-muted-foreground)]/60">—</span>
        )}
      </td>

      {/* Order status */}
      <td className="px-4 py-3">
        <span
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-[0.05em] ${statusDark.bg} ${statusDark.text} ${statusDark.border}`}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDark.dot}`} />
          {statusMeta.labelEn} · {statusMeta.labelZh}
        </span>
      </td>

      {/* Proof */}
      <td className="px-4 py-3 text-[12px] whitespace-nowrap">
        {order.hasPaymentProof ? (
          order.paymentProofUrl ? (
            <a
              href={order.paymentProofUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-teal-700/40 bg-teal-600/10 px-2.5 py-1 text-[11px] font-medium text-teal-300 transition hover:bg-teal-600/20"
            >
              <ExternalLink size={10} strokeWidth={1.5} />
              View
            </a>
          ) : (
            <span className="text-[var(--color-muted-foreground)]">Received</span>
          )
        ) : (
          <span className="text-[var(--color-muted-foreground)]/60">—</span>
        )}
      </td>
    </tr>
  );
}

/* ---------- Reports view ---------- */
// Daily business report v1 — pure math over the same today-orders/expenses state
// the other views use. No fetching, no polling, read-only. Cancelled orders are
// excluded from every money figure (they only appear as counts / audit rows).

const REPORT_STATUS_ROWS: { status: StaffOrderStatus; labelEn: string; labelZh: string }[] = [
  { status: "new",              labelEn: "New",              labelZh: "新單"  },
  { status: "preparing",        labelEn: "Preparing",        labelZh: "製作中" },
  { status: "ready",            labelEn: "Ready",            labelZh: "待取餐" },
  { status: "out_for_delivery", labelEn: "Out for Delivery", labelZh: "配送中" },
  { status: "done",             labelEn: "Done",             labelZh: "已完成" },
  { status: "delivered",        labelEn: "Delivered",        labelZh: "已送達" },
  { status: "cancelled",        labelEn: "Cancelled",        labelZh: "已取消" },
];

function OwnerReportsView({
  orders,
  expensesTotal,
  expLoadState,
  now,
  onSelectOrder,
}: {
  orders: StaffOrder[];
  expensesTotal: number;
  expLoadState: LoadState;
  now: Date;
  onSelectOrder: (o: StaffOrder) => void;
}) {
  const r = useMemo(() => {
    const live = orders.filter((o) => o.status !== "cancelled");
    const cancelled = orders.filter((o) => o.status === "cancelled");

    let gross = 0;
    let collected = 0;
    let cash = 0;
    let transfer = 0;
    let unpaidTotal = 0;
    let paidCount = 0;
    let unpaidCount = 0;
    let deliveryRevenue = 0;
    const typeCounts = { dine_in: 0, pickup: 0, delivery: 0 };
    const statusCounts: Record<StaffOrderStatus, number> = {
      new: 0, preparing: 0, ready: 0, out_for_delivery: 0,
      delivered: 0, done: 0, cancelled: cancelled.length,
    };

    for (const o of live) {
      gross += o.totalPrice;
      typeCounts[o.orderType] += 1;
      statusCounts[o.status] += 1;
      if (o.orderType === "delivery") deliveryRevenue += o.totalPrice;
      if (o.paymentStatus === "paid") {
        paidCount += 1;
        collected += o.totalPrice;
        if (o.paymentMethod === "Cash") cash += o.totalPrice;
        else if (o.paymentMethod === "Transfer") transfer += o.totalPrice;
      } else {
        unpaidCount += 1;
        unpaidTotal += o.totalPrice;
      }
    }

    const doneUnpaid = live.filter(
      (o) => (o.status === "done" || o.status === "delivered") && o.paymentStatus === "unpaid",
    );
    const unpaidActive = live.filter(
      (o) => o.status !== "done" && o.status !== "delivered" && o.paymentStatus === "unpaid",
    );
    const deliveriesPending = live.filter(
      (o) => o.orderType === "delivery" && o.status !== "delivered",
    );

    return {
      gross, collected, cash, transfer, unpaidTotal, paidCount, unpaidCount,
      deliveryRevenue, typeCounts, statusCounts, cancelled,
      doneUnpaid, unpaidActive, deliveriesPending,
      orderCount: live.length,
    };
  }, [orders]);

  // Top items by quantity from the item lines already on today's loaded orders.
  const bestSellers = useMemo(() => {
    const acc = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const o of orders) {
      if (o.status === "cancelled") continue;
      for (const it of o.items) {
        if (!it.name) continue;
        const cur = acc.get(it.name) ?? { name: it.name, qty: 0, revenue: 0 };
        cur.qty += it.quantity;
        cur.revenue += it.quantity * it.unitPrice;
        acc.set(it.name, cur);
      }
    }
    return [...acc.values()].sort((a, b) => b.qty - a.qty || b.revenue - a.revenue).slice(0, 8);
  }, [orders]);

  const expLoading = expLoadState !== "ready";
  const net = r.collected - expensesTotal;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-6 lg:px-8">
      {/* Header */}
      <div className="mb-5">
        <h2 className="font-display text-[22px] leading-none text-[var(--color-cream)]">
          Reports · 每日報表
        </h2>
        <p className="mt-1 text-[12px] uppercase tracking-[0.14em] text-[var(--color-muted-foreground)]">
          {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
          {" · "}daily business report · read-only
        </p>
      </div>

      {/* A — top summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <SupportCard
          icon={Banknote}
          label="Gross Sales"
          labelZh="總營業額"
          value={baht(r.gross)}
          sub="billed today, excl. cancelled"
          tone="money"
          animDelay={40}
        />
        <SupportCard
          icon={Scale}
          label="Net Today"
          labelZh="今日淨額"
          value={expLoading ? "…" : baht(net)}
          sub="collected minus expenses"
          tone={expLoading ? "muted" : net < 0 ? "alert" : "money"}
          animDelay={100}
        />
        <SupportCard
          icon={TrendingDown}
          label="Expenses"
          labelZh="今日支出"
          value={expLoading ? "…" : baht(expensesTotal)}
          sub="logged outflows"
          tone={expLoading ? "muted" : "cost"}
          animDelay={160}
        />
        <SupportCard
          icon={ClipboardList}
          label="Orders"
          labelZh="訂單數"
          value={String(r.orderCount)}
          sub="placed today"
          tone="muted"
          animDelay={220}
        />
        <SupportCard
          icon={XCircle}
          label="Cancelled"
          labelZh="已取消"
          value={String(r.cancelled.length)}
          sub="orders today"
          tone={r.cancelled.length > 0 ? "warn" : "muted"}
          animDelay={280}
        />
        <SupportCard
          icon={Bike}
          label="Delivery Orders"
          labelZh="外送訂單"
          value={String(r.typeCounts.delivery)}
          sub={`${baht(r.deliveryRevenue)} billed`}
          tone="muted"
          animDelay={340}
        />
      </div>

      {/* B / C / D — breakdown panels */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ReportPanel title="Payment Breakdown" titleZh="收款組成" animDelay={120}>
          <ReportRow label="Cash 現金" value={baht(r.cash)} accent="gold" />
          <ReportRow label="Transfer 轉帳" value={baht(r.transfer)} accent="gold" />
          <ReportRow
            label="Unpaid 未付"
            value={baht(r.unpaidTotal)}
            accent={r.unpaidTotal > 0 ? "vermillion" : undefined}
          />
          <ReportRow label="Paid orders 已付單" value={String(r.paidCount)} />
          <ReportRow label="Unpaid orders 未付單" value={String(r.unpaidCount)} />
        </ReportPanel>

        <ReportPanel title="Order Types" titleZh="訂單類型" animDelay={180}>
          <ReportRow label="Dine-in 堂食" value={String(r.typeCounts.dine_in)} />
          <ReportRow label="Pickup 自取" value={String(r.typeCounts.pickup)} />
          <ReportRow label="Delivery 外送" value={String(r.typeCounts.delivery)} />
          <ReportRow label="Delivery billed 外送金額" value={baht(r.deliveryRevenue)} accent="gold" />
        </ReportPanel>

        <ReportPanel title="Status Breakdown" titleZh="狀態分佈" animDelay={240}>
          {REPORT_STATUS_ROWS.map(({ status, labelEn, labelZh }) => (
            <div key={status} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex min-w-0 items-center gap-2 text-[var(--color-cream)]/85">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${OWNER_STATUS_BADGE[status].dot}`} />
                <span className="truncate">
                  {labelEn}{" "}
                  <span className="text-[11px] text-[var(--color-muted-foreground)]">{labelZh}</span>
                </span>
              </span>
              <span
                className={`staff-num shrink-0 ${
                  r.statusCounts[status] > 0
                    ? "text-[var(--color-cream)]"
                    : "text-[var(--color-muted-foreground)]/60"
                }`}
              >
                {r.statusCounts[status]}
              </span>
            </div>
          ))}
        </ReportPanel>
      </div>

      {/* E — risk / audit */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AuditList
          title="Done / Delivered — unpaid"
          titleZh="已完成未付"
          tone="var(--color-vermillion)"
          orders={r.doneUnpaid}
          empty="None — every closed order is paid."
          onSelectOrder={onSelectOrder}
          animDelay={160}
        />
        <AuditList
          title="Unpaid — still active"
          titleZh="未付進行中"
          tone="var(--color-gold-soft)"
          orders={r.unpaidActive}
          empty="None — all active orders are settled."
          onSelectOrder={onSelectOrder}
          animDelay={220}
        />
        <AuditList
          title="Deliveries not yet delivered"
          titleZh="外送未送達"
          tone="oklch(0.72 0.13 230)"
          orders={r.deliveriesPending}
          empty="None — no deliveries in flight."
          onSelectOrder={onSelectOrder}
          animDelay={280}
        />
        <AuditList
          title="Cancelled — with reasons"
          titleZh="今日取消"
          tone="var(--color-muted-foreground)"
          orders={r.cancelled}
          empty="None — no cancellations today."
          onSelectOrder={onSelectOrder}
          showReason
          animDelay={340}
        />
      </div>

      {/* F — best sellers */}
      <section
        className="owner-float-card mt-6 overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 hover:border-[var(--color-gold)]/25"
        style={{ animation: "owner-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) 300ms both" }}
      >
        <div className="flex items-center gap-2.5 border-b border-[var(--color-gold)]/15 px-6 py-4">
          <Flame className="h-3.5 w-3.5 text-[var(--color-vermillion)]/80" strokeWidth={1.5} />
          <span className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-gold-soft)]/90">
            Best Sellers Today · 今日熱賣
          </span>
        </div>
        {bestSellers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-gold)]/10 text-[11px] uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
                  <th className="px-6 py-3 text-left font-normal">#</th>
                  <th className="py-3 text-left font-normal">Item</th>
                  <th className="py-3 text-right font-normal">Qty</th>
                  <th className="px-6 py-3 text-right font-normal">Sales</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-gold)]/8">
                {bestSellers.map((item, idx) => (
                  <tr key={item.name}>
                    <td className="staff-num px-6 py-3 text-[var(--color-muted-foreground)]">
                      {idx + 1}
                    </td>
                    <td className="py-3 text-[var(--color-cream)]/90">{item.name}</td>
                    <td className="staff-num py-3 text-right text-[var(--color-cream)]/85">
                      {item.qty}
                    </td>
                    <td className="staff-num px-6 py-3 text-right text-[var(--color-gold)]">
                      {baht(item.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-10 text-center">
            <p className="font-display text-[18px] text-[var(--color-gold-soft)]/80">
              尚無銷售資料 · No item data yet
            </p>
            <p className="mx-auto mt-2 max-w-[420px] text-[12px] leading-relaxed text-[var(--color-muted-foreground)]">
              Item analytics will unlock after order-item data is connected during backend
              separation.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function ReportPanel({
  title,
  titleZh,
  animDelay = 0,
  children,
}: {
  title: string;
  titleZh: string;
  animDelay?: number;
  children: ReactNode;
}) {
  return (
    <section
      className="owner-float-card overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 hover:border-[var(--color-gold)]/25"
      style={{ animation: `owner-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) ${animDelay}ms both` }}
    >
      <div className="border-b border-[var(--color-gold)]/15 px-6 py-4">
        <span className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-gold-soft)]/90">
          {title} · {titleZh}
        </span>
      </div>
      <div className="space-y-3 px-6 py-5">{children}</div>
    </section>
  );
}

function ReportRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "gold" | "vermillion";
}) {
  const valueClass =
    accent === "gold"
      ? "text-[var(--color-gold)]"
      : accent === "vermillion"
      ? "text-[var(--color-vermillion)]"
      : "text-[var(--color-cream)]/85";
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="min-w-0 truncate text-[var(--color-cream)]/85">{label}</span>
      <span className={`staff-num shrink-0 ${valueClass}`}>{value}</span>
    </div>
  );
}

// Compact clickable audit list — rows open the read-only order modal.
function AuditList({
  title,
  titleZh,
  tone,
  orders,
  empty,
  onSelectOrder,
  showReason,
  animDelay = 0,
}: {
  title: string;
  titleZh: string;
  tone: string;
  orders: StaffOrder[];
  empty: string;
  onSelectOrder: (o: StaffOrder) => void;
  showReason?: boolean;
  animDelay?: number;
}) {
  return (
    <section
      className="owner-float-card overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 hover:border-[var(--color-gold)]/25"
      style={{ animation: `owner-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) ${animDelay}ms both` }}
    >
      <div className="flex items-center gap-2.5 border-b border-[var(--color-gold)]/15 px-6 py-4">
        <span className="h-4 w-1 rounded-full" style={{ background: tone }} />
        <span className="min-w-0 truncate text-[11px] uppercase tracking-[0.2em] text-[var(--color-gold-soft)]/90">
          {title} · {titleZh}
        </span>
        <span className="staff-num ml-auto shrink-0 text-[12px] text-[var(--color-muted-foreground)]">
          {orders.length}
        </span>
      </div>
      {orders.length > 0 ? (
        <ul className="divide-y divide-[var(--color-gold)]/8">
          {orders.slice(0, 6).map((o) => (
            <li
              key={o.orderId}
              onClick={() => onSelectOrder(o)}
              className="flex cursor-pointer items-start gap-3 px-6 py-3 transition-colors hover:bg-[var(--color-gold)]/[0.07]"
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-[var(--color-cream)]/90">
                  {locText(o)}
                  <span className="ml-2 text-[11px] text-[var(--color-muted-foreground)]">
                    {STATUS_META[o.status].labelEn}
                  </span>
                </div>
                <div className="staff-num mt-0.5 truncate text-[11px] text-[var(--color-muted-foreground)]">
                  {o.orderId} · {o.time}
                </div>
                {showReason && o.cancellationReason && (
                  <div className="mt-0.5 truncate text-[11.5px] italic text-[var(--color-muted-foreground)]/70">
                    {o.cancellationReason}
                  </div>
                )}
              </div>
              <span
                className={`staff-num shrink-0 whitespace-nowrap text-[14px] ${
                  o.status === "cancelled"
                    ? "text-[var(--color-muted-foreground)] line-through"
                    : "text-[var(--color-gold)]"
                }`}
              >
                {baht(o.totalPrice)}
              </span>
            </li>
          ))}
          {orders.length > 6 && (
            <li className="px-6 py-2.5 text-[11px] text-[var(--color-muted-foreground)]">
              +{orders.length - 6} more — see Orders tab
            </li>
          )}
        </ul>
      ) : (
        <p className="px-6 py-6 text-[12.5px] text-[var(--color-muted-foreground)]">{empty}</p>
      )}
    </section>
  );
}

/* ---------- Menu view (read-only) ---------- */
// Read-only snapshot of the menu bundled with the app (src/data/menu.ts — the
// same data the customer menu renders from). No fetching here: live availability
// is operated on the staff Menu board, and full menu management (editing prices,
// stock, categories) connects after backend separation.

const MENU_CATEGORY_LABEL: Record<MenuCategoryId, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.nameEn]),
) as Record<MenuCategoryId, string>;

function OwnerMenuView() {
  const [category, setCategory] = useState<MenuCategoryId | "all">("all");

  const items = useMemo(() => {
    const list = category === "all" ? MENU : MENU.filter((i) => i.category === category);
    return [...list].sort((a, b) =>
      a.category === b.category
        ? a.order - b.order
        : MENU_CATEGORY_LABEL[a.category].localeCompare(MENU_CATEGORY_LABEL[b.category]),
    );
  }, [category]);

  const availableCount = MENU.filter((i) => i.available).length;
  const popularCount = MENU.filter((i) => i.popular).length;
  const needsPriceCount = MENU.filter((i) => i.price === undefined).length;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-5 py-6 lg:px-8">
      {/* Header */}
      <div className="mb-5">
        <h2 className="font-display text-[22px] leading-none text-[var(--color-cream)]">
          Menu · 菜單總覽
        </h2>
        <p className="mt-1 text-[12px] uppercase tracking-[0.14em] text-[var(--color-muted-foreground)]">
          read-only · menu overview
        </p>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SupportCard
          icon={UtensilsCrossed}
          label="Items"
          labelZh="品項"
          value={String(MENU.length)}
          sub={`${CATEGORIES.length} categories`}
          tone="muted"
          animDelay={40}
        />
        <SupportCard
          icon={Receipt}
          label="Available"
          labelZh="供應中"
          value={String(availableCount)}
          sub="on the menu snapshot"
          tone="money"
          animDelay={100}
        />
        <SupportCard
          icon={Star}
          label="Popular"
          labelZh="人氣"
          value={String(popularCount)}
          sub="marked bestsellers"
          tone={popularCount > 0 ? "warn" : "muted"}
          animDelay={160}
        />
        <SupportCard
          icon={AlertTriangle}
          label="Needs Price"
          labelZh="待定價"
          value={String(needsPriceCount)}
          sub="price to confirm"
          tone={needsPriceCount > 0 ? "alert" : "muted"}
          animDelay={220}
        />
      </div>

      {/* Category filter pills */}
      <div className="mb-5 flex flex-wrap gap-2">
        {[{ id: "all" as const, nameEn: "All" }, ...CATEGORIES].map((c) => {
          const isActive = category === c.id;
          const count = c.id === "all" ? MENU.length : MENU.filter((i) => i.category === c.id).length;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-medium tracking-[0.06em] transition-colors ${
                isActive
                  ? "border-[var(--color-gold)]/60 bg-[var(--color-gold)]/12 text-[var(--color-gold)]"
                  : "border-[var(--color-gold)]/15 text-[var(--color-muted-foreground)] hover:border-[var(--color-gold)]/30 hover:text-[var(--color-cream)]/70"
              }`}
            >
              {c.nameEn}
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                  isActive
                    ? "bg-[var(--color-gold)]/20 text-[var(--color-gold)]"
                    : "bg-[var(--color-gold)]/8 text-[var(--color-muted-foreground)]"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Menu table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--color-gold)]/12 bg-[var(--color-charcoal-soft)]/40">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--color-gold)]/12">
              {["Item", "Category", "Price", "Unit", "Availability", "Tags"].map((h) => (
                <th
                  key={h}
                  className="px-4 py-3 text-left text-[11px] uppercase tracking-[0.14em] font-medium text-[var(--color-muted-foreground)]"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-gold)]/8">
            {items.map((item) => (
              <tr key={item.id} className={item.available ? "" : "opacity-55"}>
                <td className="px-4 py-3">
                  <p className="font-medium text-[var(--color-cream)]/90">{item.nameEn}</p>
                  <p className="mt-0.5 text-[10.5px] uppercase tracking-[0.12em] text-[var(--color-muted-foreground)] tabular-nums">
                    {item.id}
                  </p>
                </td>
                <td className="px-4 py-3 text-[var(--color-cream)]/70">
                  {MENU_CATEGORY_LABEL[item.category]}
                </td>
                <td className="staff-num px-4 py-3 tabular-nums">
                  {item.price !== undefined ? (
                    <span className="text-[var(--color-gold)]">{baht(item.price)}</span>
                  ) : (
                    <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-vermillion)]/75">
                      To confirm
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-[12px] text-[var(--color-muted-foreground)]">
                  {item.unit ?? "—"}
                </td>
                <td className="px-4 py-3">
                  {item.available ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/28 bg-emerald-500/12 px-2 py-0.5 text-[11px] font-medium tracking-[0.05em] text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Available
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-cream)]/12 bg-[var(--color-cream)]/6 px-2 py-0.5 text-[11px] font-medium tracking-[0.05em] text-[var(--color-cream)]/55">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-cream)]/45" />
                      Off menu
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {item.popular && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-gold)]/30 bg-[var(--color-gold)]/10 px-2 py-0.5 text-[11px] font-medium tracking-[0.05em] text-[var(--color-gold)]">
                      <Star className="h-2.5 w-2.5" strokeWidth={2} />
                      Popular
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Planned management note */}
      <section
        className="owner-float-card mt-6 rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 px-6 py-5"
        style={{ animation: "owner-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) 200ms both" }}
      >
        <div className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-gold-soft)]/90">
          Menu Management · 菜單管理
        </div>
        <p className="mt-2 max-w-[640px] text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
          This is the menu snapshot bundled with the app — the same data the customer menu renders
          from. Day-to-day availability is operated on the staff Menu board. Full menu management
          connects after backend separation, when the owner will be able to:
        </p>
        <ul className="mt-3 grid max-w-[640px] grid-cols-1 gap-1.5 text-[12.5px] text-[var(--color-cream)]/75 sm:grid-cols-2">
          {[
            "View the live menu",
            "Toggle item availability",
            "Edit prices",
            "Track low stock",
            "Manage categories",
          ].map((f) => (
            <li key={f} className="flex items-center gap-2">
              <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--color-gold)]/60" />
              {f}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ---------- Sidebar (static, desktop only) ---------- */

type OwnerSection = "overview" | "orders" | "payments" | "reports" | "menu";

const NAV_ITEMS: { id: OwnerSection | null; label: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid     },
  { id: "orders",   label: "Orders",   icon: ClipboardList  },
  { id: "menu",     label: "Menu",     icon: UtensilsCrossed },
  { id: "payments", label: "Payments", icon: Banknote       },
  { id: "reports",  label: "Reports",  icon: LineChartIcon  },
  { id: null,       label: "Settings", icon: Settings       },
];

function OwnerSidebar({
  activeSection,
  onSectionChange,
}: {
  activeSection: OwnerSection;
  onSectionChange: (s: OwnerSection) => void;
}) {
  const [hintLabel, setHintLabel] = useState<string | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showHint(label: string) {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setHintLabel(label);
    hintTimer.current = setTimeout(() => setHintLabel(null), 2500);
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col border-r border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/40 lg:flex">
      <div className="border-b border-[var(--color-gold)]/15 px-6 pb-6 pt-7">
        <div className="flex items-center gap-2.5">
          <BrandMark className="h-7 w-7" />
          <span className="text-[10px] uppercase tracking-[0.3em] text-[var(--color-gold-soft)]/70">
            東主 · Owner
          </span>
        </div>
        <p className="mt-3 font-display text-[24px] leading-[1.1] text-[var(--color-cream)]">
          The <span className="text-[var(--color-vermillion)]">Third</span> Place
        </p>
        <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[var(--color-gold-soft)]/70">
          Chinese BBQ &amp; Lounge
        </p>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-5">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = id !== null && id === activeSection;
          const isLive = id !== null;
          return (
            <button
              key={label}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={
                isActive ? undefined
                : isLive ? () => onSectionChange(id)
                : () => showHint(label)
              }
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[14px] transition-colors ${
                isActive
                  ? "bg-[var(--color-charcoal-soft)] text-[var(--color-cream)] shadow-[inset_2px_0_0_var(--color-gold)]"
                  : isLive
                  ? "text-[var(--color-gold-soft)]/65 hover:bg-[var(--color-gold)]/[0.06] hover:text-[var(--color-cream)]/80"
                  : "cursor-default text-[var(--color-gold-soft)]/40 hover:bg-[var(--color-gold)]/[0.04] hover:text-[var(--color-gold-soft)]/60"
              }`}
            >
              <Icon
                className="h-[15px] w-[15px]"
                strokeWidth={1.5}
                style={{ opacity: isActive ? 0.85 : isLive ? 0.60 : 0.38 }}
              />
              <span className="flex-1 text-left">{label}</span>
              {!isLive && (
                <span
                  className="shrink-0 rounded-sm px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-[var(--color-muted-foreground)]"
                  style={{ border: "1px solid oklch(0.72 0.11 75 / 0.18)" }}
                >
                  Soon
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer — flashes section name on click, otherwise shows release note */}
      <div className="border-t border-[var(--color-gold)]/15 px-6 py-4">
        {hintLabel ? (
          <p className="text-[10.5px] leading-relaxed text-[var(--color-gold-soft)]/75 transition-opacity">
            <span className="font-medium text-[var(--color-gold-soft)]">{hintLabel}</span>
            {" "}— arriving in a later release.
          </p>
        ) : (
          <p className="text-[10.5px] leading-relaxed text-[var(--color-muted-foreground)]">
            Overview, Orders, Menu, Payments &amp; Reports are live. Settings arriving soon.
          </p>
        )}
      </div>
    </aside>
  );
}

// Round grill / fire-ring brand emblem (decorative, no data).
function BrandMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none" aria-hidden>
      <circle
        cx="16"
        cy="16"
        r="13.5"
        stroke="var(--color-gold)"
        strokeOpacity="0.55"
        strokeWidth="0.8"
      />
      <circle
        cx="16"
        cy="16"
        r="9.5"
        stroke="var(--color-gold)"
        strokeOpacity="0.35"
        strokeWidth="0.6"
      />
      <line
        x1="6"
        y1="16"
        x2="26"
        y2="16"
        stroke="var(--color-gold)"
        strokeOpacity="0.55"
        strokeWidth="0.6"
      />
      <line
        x1="8"
        y1="12"
        x2="24"
        y2="12"
        stroke="var(--color-gold)"
        strokeOpacity="0.3"
        strokeWidth="0.5"
      />
      <line
        x1="8"
        y1="20"
        x2="24"
        y2="20"
        stroke="var(--color-gold)"
        strokeOpacity="0.3"
        strokeWidth="0.5"
      />
      <circle cx="16" cy="16" r="1.4" fill="var(--color-vermillion)" />
    </svg>
  );
}

/* ---------- Header ---------- */

function OwnerHeader({
  now,
  live,
  onRefresh,
}: {
  now: Date;
  live: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="mx-auto w-full max-w-[1600px] border-b border-[var(--color-gold)]/15 px-5 pb-5 pt-6 lg:px-8">
      <div className="flex items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="font-display text-[34px] leading-[1.02] text-[var(--color-cream)] sm:text-[42px]">
            {greeting(now)}, <span className="text-[var(--color-gold)]">{OWNER_NAME}</span>.
          </h1>
          <div className="mt-3 flex items-center gap-3 text-[11px] uppercase tracking-[0.28em] text-[var(--color-gold-soft)]/80">
            <span className="h-px w-7 bg-[var(--color-gold)]/40" />
            Dinner Service · {dateLabel(now)}
          </div>
          <p className="mt-2 flex items-center gap-2 text-[12px] text-[var(--color-gold-soft)]/80">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            {live ? "Live · 今晚營業" : "Connecting…"}
          </p>
        </div>

        <button
          type="button"
          onClick={onRefresh}
          className="group hidden items-center gap-2 rounded-md border border-[var(--color-gold)]/20 bg-[var(--color-charcoal-soft)]/60 px-3.5 py-2.5 text-[13px] text-[var(--color-gold-soft)]/90 transition-colors hover:text-[var(--color-cream)] sm:flex"
        >
          <RefreshCw
            className="h-3.5 w-3.5 transition-transform duration-500 group-hover:rotate-180"
            strokeWidth={1.5}
          />
          <span className="staff-num">Updated {hhmm(now)}</span>
        </button>
      </div>
    </header>
  );
}

/* ---------- Hero — Collected Tonight ---------- */

function Hero({ summary }: { summary: ReturnType<typeof summarizeToday> }) {
  return (
    <section
      className="owner-float-card relative overflow-hidden rounded-2xl border px-7 py-7"
      style={{
        background:
          "linear-gradient(155deg, oklch(0.21 0.012 50) 0%, oklch(0.17 0.007 55) 55%, oklch(0.15 0.005 60) 100%)",
        borderColor: "oklch(0.72 0.11 75 / 0.32)",
        boxShadow: "0 24px 50px -30px oklch(0 0 0 / 0.9)",
        animation: "owner-fade-up 0.65s cubic-bezier(0.22, 1, 0.36, 1) both",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
        style={{
          background: "radial-gradient(circle, oklch(0.55 0.19 27 / 0.12) 0%, transparent 60%)",
        }}
      />
      <div className="relative flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-gold-soft)]/90">
            Collected Tonight · 今晚收款
          </div>
          <div className="mt-1 text-[12px] text-[var(--color-muted-foreground)]">
            Paid cash + paid transfer only
          </div>
        </div>
        <span className="staff-num shrink-0 text-[12px] text-[var(--color-gold-soft)]/80">
          {summary.orderCount} {summary.orderCount === 1 ? "order" : "orders"}
        </span>
      </div>
      <div className="relative mt-5 staff-num break-all text-[38px] leading-none text-[var(--color-gold)] sm:text-[52px] lg:text-[60px]">
        {baht(summary.collected)}
      </div>
      <div className="relative mt-3 break-words text-[13px] text-[var(--color-muted-foreground)]">
        Cash {baht(summary.cash)} · Transfer {baht(summary.transfer)}
      </div>
    </section>
  );
}

/* ---------- Metrics ---------- */

function MetricsGrid({ summary }: { summary: ReturnType<typeof summarizeToday> }) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <SupportCard
        icon={Wallet}
        label="Cash"
        labelZh="現金"
        value={baht(summary.cash)}
        sub="collected"
        tone="money"
        animDelay={80}
      />
      <SupportCard
        icon={ArrowLeftRight}
        label="Transfer"
        labelZh="轉帳"
        value={baht(summary.transfer)}
        sub="collected"
        tone="money"
        animDelay={150}
      />
      <SupportCard
        icon={AlertTriangle}
        label="Unpaid"
        labelZh="未付"
        value={baht(summary.unpaidTotal)}
        sub={`${summary.unpaidCount} ${summary.unpaidCount === 1 ? "order" : "orders"}`}
        tone={summary.unpaidTotal > 0 ? "warn" : "muted"}
        animDelay={220}
      />
      <SupportCard
        icon={Receipt}
        label="Closed · Unpaid"
        labelZh="已完成未付"
        value={String(summary.doneUnpaidCount)}
        sub="done or delivered, not paid"
        tone={summary.doneUnpaidCount > 0 ? "alert" : "muted"}
        animDelay={290}
      />
    </div>
  );
}

type Tone = "money" | "warn" | "alert" | "muted" | "cost";

function toneColor(tone: Tone): string {
  switch (tone) {
    case "money":
      return "var(--color-gold)";
    case "warn":
      return "var(--color-gold-soft)";
    case "alert":
      return "var(--color-vermillion)";
    case "cost":
      return "oklch(0.62 0.155 27 / 0.88)";
    default:
      return "var(--color-cream)";
  }
}

function SupportCard({
  icon: Icon,
  label,
  labelZh,
  value,
  sub,
  tone,
  animDelay = 0,
}: {
  icon: LucideIcon;
  label: string;
  labelZh: string;
  value: string;
  sub: string;
  tone: Tone;
  animDelay?: number;
}) {
  const accent = toneColor(tone);
  return (
    <div
      className="owner-float-card group relative overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 px-5 py-5 hover:border-[var(--color-gold)]/28"
      style={{ animation: `owner-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) ${animDelay}ms both` }}
    >
      <span
        aria-hidden
        className="absolute bottom-5 left-0 top-5 w-[2px] rounded-r-full opacity-60 transition-opacity group-hover:opacity-100"
        style={{ background: accent }}
      />
      <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--color-gold-soft)]/90">
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} style={{ color: accent, opacity: 0.85 }} />
          <span className="truncate">{label}</span>
        </span>
        <span className="shrink-0 text-[var(--color-muted-foreground)]">{labelZh}</span>
      </div>
      <div
        className="mt-3 staff-num break-all text-[24px] leading-none sm:text-[28px]"
        style={{ color: tone === "muted" ? "var(--color-cream)" : accent }}
      >
        {value}
      </div>
      <div className="mt-2 text-[12px] text-[var(--color-muted-foreground)]">{sub}</div>
    </div>
  );
}

/* ---------- Expense + Net row ---------- */

function ExpenseNetRow({
  expensesTotal,
  collected,
  expLoadState,
}: {
  expensesTotal: number;
  collected: number;
  expLoadState: LoadState;
}) {
  const loading = expLoadState === "loading";
  const net = collected - expensesTotal;
  const netTone: Tone = loading ? "muted" : net < 0 ? "alert" : "money";

  return (
    <div className="grid grid-cols-2 gap-4">
      <SupportCard
        icon={TrendingDown}
        label="Expenses Today"
        labelZh="今日支出"
        value={loading ? "…" : baht(expensesTotal)}
        sub="logged outflows"
        tone={loading ? "muted" : "cost"}
        animDelay={360}
      />
      <SupportCard
        icon={Scale}
        label="Net Today"
        labelZh="今日淨額"
        value={loading ? "…" : baht(net)}
        sub="collected minus logged expenses"
        tone={netTone}
        animDelay={430}
      />
    </div>
  );
}

/* ---------- Payment Mix — segmented ring (Cash + Transfer = Collected) ---------- */
// SVG donut via stroke-dasharray. The ring represents COLLECTED money only, so it
// always fills to 100% and the center value equals the ring total. Unpaid is shown
// as a separate ember warning row below — it is never folded into collected. Empty
// state draws only the faint track (no fake slice). All values are real.
const RING_R = 62;
const RING_C = 2 * Math.PI * RING_R;

function PaymentMix({
  collected,
  cash,
  transfer,
  unpaid,
  unpaidCount,
}: {
  collected: number;
  cash: number;
  transfer: number;
  unpaid: number;
  unpaidCount: number;
}) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setDrawn(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const segments = [
    { key: "cash", value: cash, stroke: "var(--color-gold)" },
    { key: "transfer", value: transfer, stroke: "var(--color-gold-soft)" },
  ].filter((s) => s.value > 0);

  const gap = segments.length > 1 ? 3 : 0;
  let cursor = 0;
  const arcs = segments.map((s) => {
    const frac = collected > 0 ? s.value / collected : 0;
    const len = Math.max(0, frac * RING_C - gap);
    const arc = { ...s, len, offset: -cursor };
    cursor += frac * RING_C;
    return arc;
  });

  const pct = (v: number) => (collected > 0 ? Math.round((v / collected) * 100) : 0);

  return (
    <section
      className="owner-float-card overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 px-6 py-6 hover:border-[var(--color-gold)]/25"
      style={{ animation: "owner-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) 300ms both" }}
    >
      <div className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-gold-soft)]/90">
        Collection Breakdown · 收款組成
      </div>
      <h2 className="mt-1 font-display text-[22px] leading-tight text-[var(--color-cream)]">
        Payment Mix
      </h2>

      <div className="mt-5 flex flex-col items-center gap-7 sm:flex-row sm:gap-9">
        {/* Ring */}
        <div
          className="relative h-[176px] w-[176px] shrink-0"
          role="img"
          aria-label={`Collected ${baht(collected)} — Cash ${baht(cash)}, Transfer ${baht(
            transfer,
          )}. Unpaid ${baht(unpaid)} not counted as collected.`}
        >
          <svg viewBox="0 0 144 144" className="h-full w-full">
            <circle
              cx="72"
              cy="72"
              r={RING_R}
              fill="none"
              stroke="var(--color-charcoal)"
              strokeWidth="14"
            />
            <g transform="rotate(-90 72 72)">
              {arcs.map((a, i) => (
                <circle
                  key={a.key}
                  cx="72"
                  cy="72"
                  r={RING_R}
                  fill="none"
                  stroke={a.stroke}
                  strokeWidth="14"
                  strokeLinecap="butt"
                  style={{
                    strokeDasharray: drawn
                      ? `${a.len} ${RING_C - a.len}`
                      : `0 ${RING_C}`,
                    strokeDashoffset: a.offset,
                    transition: `stroke-dasharray 0.9s cubic-bezier(0.22, 1, 0.36, 1) ${i * 0.15}s`,
                  }}
                />
              ))}
            </g>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-gold-soft)]/80">
              Collected
            </span>
            <span
              className={`mt-1.5 staff-num text-[26px] leading-none ${
                collected > 0 ? "text-[var(--color-gold)]" : "text-[var(--color-gold)]/70"
              }`}
            >
              {baht(collected)}
            </span>
            <span className="mt-1.5 text-[10.5px] text-[var(--color-muted-foreground)]">
              tonight
            </span>
          </div>
        </div>

        {/* Breakdown */}
        <div className="w-full min-w-0 flex-1">
          {collected > 0 ? (
            <div className="space-y-3.5">
              <MixRow
                dot="bg-[var(--color-gold)]"
                label="Cash 現金"
                value={baht(cash)}
                pct={pct(cash)}
              />
              <MixRow
                dot="bg-[var(--color-gold-soft)]"
                label="Transfer 轉帳"
                value={baht(transfer)}
                pct={pct(transfer)}
              />
            </div>
          ) : (
            <p className="text-[13px] text-[var(--color-muted-foreground)]">
              沒有收款 · Nothing collected yet tonight.
            </p>
          )}

          {/* Unpaid — explicitly excluded from collected */}
          <div className="mt-5 flex items-start justify-between gap-3 border-t border-[var(--color-gold)]/15 pt-4">
            <span className="flex items-center gap-2.5 text-[13px]">
              <AlertTriangle
                className="h-3.5 w-3.5 text-[var(--color-vermillion)]"
                strokeWidth={1.5}
              />
              <span>
                <span className="block text-[var(--color-cream)]/90">Unpaid 未付</span>
                <span className="block text-[11px] text-[var(--color-muted-foreground)]">
                  not counted as collected
                  {unpaidCount > 0
                    ? ` · ${unpaidCount} ${unpaidCount === 1 ? "order" : "orders"}`
                    : ""}
                </span>
              </span>
            </span>
            <span className="staff-num shrink-0 text-[16px] text-[var(--color-vermillion)]">
              {baht(unpaid)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

function MixRow({
  dot,
  label,
  value,
  pct,
}: {
  dot: string;
  label: string;
  value: string;
  pct: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="flex min-w-0 items-center gap-2.5 text-[var(--color-cream)]/90">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-sm ${dot}`} />
        <span className="truncate">{label}</span>
      </span>
      <span className="flex shrink-0 items-baseline gap-3">
        <span className="staff-num text-[15px] text-[var(--color-gold)]">{value}</span>
        <span className="staff-num w-9 text-right text-[11px] text-[var(--color-muted-foreground)]">
          {pct}%
        </span>
      </span>
    </div>
  );
}

/* ---------- Recent Orders ---------- */

function RecentOrders({
  recent,
  onSelectOrder,
}: {
  recent: StaffOrder[];
  onSelectOrder: (o: StaffOrder) => void;
}) {
  return (
    <section
      className="owner-float-card overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 hover:border-[var(--color-gold)]/25"
      style={{ animation: "owner-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) 180ms both" }}
    >
      <div className="flex items-center justify-between border-b border-[var(--color-gold)]/15 px-6 py-5">
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-gold-soft)]/90">
            Floor Activity · 最近訂單
          </div>
          <h2 className="mt-1 font-display text-[22px] leading-tight text-[var(--color-cream)]">
            Recent Orders
          </h2>
        </div>
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--color-muted-foreground)]">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          live
        </span>
      </div>

      {recent.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
                <th className="px-6 py-3 text-left font-normal">Table · Order</th>
                <th className="py-3 text-left font-normal">Items</th>
                <th className="py-3 text-left font-normal">Payment</th>
                <th className="py-3 text-right font-normal">Total</th>
                <th className="px-6 py-3 text-right font-normal">Status · Time</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((o) => {
                const meta = STATUS_META[o.status];
                const cancelled = o.status === "cancelled";
                const alert = o.status === "done" && o.paymentStatus === "unpaid";
                const paid = o.paymentStatus === "paid";
                return (
                  <tr key={o.orderId} onClick={() => onSelectOrder(o)} className="cursor-pointer border-t border-[var(--color-gold)]/10 transition-colors hover:bg-[var(--color-gold)]/[0.07]">
                    <td
                      className={`border-l-2 px-6 py-4 ${alert ? "border-[var(--color-vermillion)]" : "border-transparent"}`}
                    >
                      <div className="text-[var(--color-cream)]">{locText(o)}</div>
                      <div className="staff-num mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
                        {o.orderId}
                      </div>
                    </td>
                    <td
                      className={`py-4 ${cancelled ? "text-[var(--color-muted-foreground)] line-through" : "text-[var(--color-cream)]/85"}`}
                    >
                      {itemsSummary(o)}
                    </td>
                    <td className="py-4 text-[12px] text-[var(--color-muted-foreground)]">
                      {paid && o.paymentMethod ? (
                        <span className="inline-flex items-center gap-1.5">
                          {o.paymentMethod === "Cash" ? (
                            <Wallet className="h-3 w-3" strokeWidth={1.5} />
                          ) : (
                            <ArrowLeftRight className="h-3 w-3" strokeWidth={1.5} />
                          )}
                          {o.paymentMethod}
                        </span>
                      ) : (
                        <span
                          className={
                            o.paymentStatus === "unpaid"
                              ? "text-[var(--color-vermillion)]"
                              : "text-[var(--color-muted-foreground)]/60"
                          }
                        >
                          {o.paymentStatus === "unpaid" ? "Unpaid" : "—"}
                        </span>
                      )}
                    </td>
                    <td
                      className={`staff-num py-4 text-right text-[16px] ${cancelled ? "text-[var(--color-muted-foreground)]" : "text-[var(--color-gold)]"}`}
                    >
                      {baht(o.totalPrice)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="inline-flex items-center justify-end gap-2 text-[12px] text-[var(--color-cream)]/90">
                        <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                        {meta.labelEn}
                      </span>
                      <div className="staff-num mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
                        {o.time}
                      </div>
                      {cancelled && o.cancellationReason && (
                        <div className="mt-0.5 text-[10.5px] italic leading-tight text-[var(--color-muted-foreground)]/60">
                          {o.cancellationReason}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-6 pb-6 pt-3 text-[13px] text-[var(--color-muted-foreground)]">
          目前沒有訂單 · No orders yet tonight.
        </p>
      )}
    </section>
  );
}

/* ---------- Owner Order Modal (read-only, centered) ---------- */

function ownerFmtTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : hhmm(d);
}

function OwnerOrderModal({ order, onClose }: { order: StaffOrder; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const meta = STATUS_META[order.status];
  const payMeta = PAYMENT_META[order.paymentStatus];
  const cancelled = order.status === "cancelled";
  const paid = order.paymentStatus === "paid";
  const displayDeliveryFee = order.deliveryFee && order.deliveryFee > 0 ? order.deliveryFee : 30;
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
  const loc = orderLocation(order);
  const paidAtLabel = ownerFmtTime(order.paidAt);
  const cancelledAtLabel = ownerFmtTime(order.cancelledAt);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Card — stopPropagation so backdrop click doesn't fire through */}
      <div
        className="relative flex w-full max-w-[600px] max-h-[85vh] flex-col overflow-hidden rounded-2xl border border-[var(--color-gold)]/20 bg-[var(--color-charcoal-soft)] shadow-[0_24px_80px_-20px_oklch(0_0_0/0.9)]"
        onClick={(e) => e.stopPropagation()}
      >

        {/* Header */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--color-gold)]/15 px-5 pb-4 pt-5">
          <div className="min-w-0">
            <p className="staff-num text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-gold-soft)]/70 tabular-nums">
              {order.orderId} · {order.time} · {totalQty} {totalQty === 1 ? "item" : "items"} ·{" "}
              {order.orderType === "dine_in"
                ? "Dine-in"
                : order.orderType === "pickup"
                ? "Pickup"
                : "Delivery"}
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="font-sans text-[20px] font-semibold leading-none text-[var(--color-cream)]">
                {loc.big}
                {loc.num !== undefined && <span className="staff-num ml-1.5">{loc.num}</span>}
                <span className="ml-2 text-[13px] tracking-[0.08em] text-[var(--color-cream)]/50">
                  {loc.zh}
                </span>
              </span>
              <span
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-[0.06em] ${meta.badgeClass}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                {meta.labelZh} {meta.labelEn}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-cream)]/10 text-[var(--color-cream)]/60 text-[18px] transition hover:bg-[var(--color-cream)]/20"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">

          {/* Items */}
          <section>
            <h3 className="mb-3 text-[11px] uppercase tracking-[0.22em] text-[var(--color-cream)]/45">
              Items · 餐點
            </h3>
            <ul className="space-y-3">
              {order.items.map((item) => (
                <li
                  key={item.id ?? item.name}
                  className={`flex items-baseline gap-3 ${cancelled ? "opacity-50" : ""}`}
                >
                  <span className="staff-num w-9 shrink-0 text-right text-[16px] font-semibold text-[var(--color-vermillion)]">
                    {item.quantity}
                    <span className="ml-0.5 text-[11px] font-normal text-[var(--color-cream)]/35">×</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[16px] leading-snug ${cancelled ? "text-[var(--color-cream)]/60 line-through" : "text-[var(--color-cream)]"}`}>
                      {item.name}
                    </p>
                    {item.unitPrice > 0 && (
                      <p className="staff-num text-[12px] text-[var(--color-cream)]/40">
                        ฿{item.unitPrice.toLocaleString("en-US")} each
                      </p>
                    )}
                  </div>
                  <span className={`staff-num shrink-0 text-[16px] ${cancelled ? "text-[var(--color-muted-foreground)] line-through" : "text-[var(--color-gold-soft)]"}`}>
                    ฿{(item.quantity * item.unitPrice).toLocaleString("en-US")}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Notes */}
          {order.notes && (
            <section>
              <h3 className="mb-3 text-[11px] uppercase tracking-[0.22em] text-[var(--color-cream)]/45">
                Notes · 備註
              </h3>
              <p className="rounded-xl border border-[var(--color-gold)]/20 bg-[var(--color-ink)] px-4 py-3 text-[15px] leading-relaxed text-[var(--color-cream)]/85">
                {order.notes}
              </p>
            </section>
          )}

          {/* Delivery info */}
          {order.orderType === "delivery" && (
            <section>
              <h3 className="mb-3 text-[11px] uppercase tracking-[0.22em] text-[var(--color-cream)]/45">
                Delivery · 外送
              </h3>
              <div className="space-y-2 rounded-xl border border-[var(--color-gold)]/20 bg-[var(--color-ink)] px-4 py-3 text-[14px]">
                {order.customerName && (
                  <div className="grid grid-cols-[16px_100px_1fr] items-center gap-2">
                    <User size={12} className="text-[var(--color-cream)]/40" />
                    <span className="text-[13px] uppercase tracking-[0.08em] text-[var(--color-cream)]/50">Name</span>
                    <span className="text-right text-[var(--color-cream)]">{order.customerName}</span>
                  </div>
                )}
                {order.customerPhone && (
                  <div className="grid grid-cols-[16px_100px_1fr] items-center gap-2">
                    <Phone size={12} className="text-[var(--color-cream)]/40" />
                    <span className="text-[13px] uppercase tracking-[0.08em] text-[var(--color-cream)]/50">Phone</span>
                    <span className="staff-num text-right text-[var(--color-cream)]">{order.customerPhone}</span>
                  </div>
                )}
                {order.deliveryAddress && (
                  <div className="grid grid-cols-[16px_100px_1fr] items-start gap-2">
                    <MapPin size={12} className="mt-0.5 text-[var(--color-cream)]/40" />
                    <span className="text-[13px] uppercase tracking-[0.08em] text-[var(--color-cream)]/50">Address</span>
                    <span className="text-right text-[var(--color-cream)]">{order.deliveryAddress}</span>
                  </div>
                )}
                <div className="space-y-1.5 border-t border-[var(--color-gold)]/10 pt-2">
                  {(order.subtotalPrice ?? 0) > 0 && (
                    <div className="flex justify-between gap-3">
                      <span className="text-[var(--color-cream)]/50">Subtotal</span>
                      <span className="staff-num text-[var(--color-cream)]/75">
                        ฿{(order.subtotalPrice ?? 0).toLocaleString("en-US")}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-[var(--color-cream)]/50">
                      <Bike size={12} className="shrink-0" /> Delivery fee
                    </span>
                    <span className="staff-num text-[var(--color-cream)]/75">
                      ฿{displayDeliveryFee.toLocaleString("en-US")}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-cream)]/50">Total</span>
                    <span className={`staff-num ${cancelled ? "text-[var(--color-muted-foreground)] line-through" : "text-[var(--color-vermillion)]"}`}>
                      ฿{order.totalPrice.toLocaleString("en-US")}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Total */}
          <div className="flex items-baseline justify-between border-t border-[var(--color-gold)]/15 pt-4">
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-cream)]/50">
              Total · 合計
            </span>
            <span className={`staff-num inline-flex items-baseline text-[24px] leading-none ${cancelled ? "text-[var(--color-muted-foreground)] line-through" : "text-[var(--color-vermillion)]"}`}>
              <span className="mr-0.5 text-[15px]">฿</span>
              {order.totalPrice.toLocaleString("en-US")}
            </span>
          </div>

          {/* Payment */}
          <div className="flex items-center justify-between border-t border-[var(--color-gold)]/15 pt-4">
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-cream)]/50">
              Payment · 付款
            </span>
            <span className={`flex items-center gap-1.5 rounded-full border border-[var(--color-gold)]/25 px-2.5 py-1 text-[12px] font-medium tracking-[0.06em] ${payMeta.badgeClass}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${payMeta.dotClass}`} />
              {payMeta.labelZh} {payMeta.labelEn}
              {paid && order.paymentMethod ? ` · ${order.paymentMethod}` : ""}
              {paid && paidAtLabel ? ` · ${paidAtLabel}` : ""}
            </span>
          </div>

          {/* Payment proof */}
          {order.hasPaymentProof && (
            <div className="flex items-center justify-between border-t border-[var(--color-gold)]/15 pt-4">
              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-cream)]/50">
                Proof · 收據
                {order.paymentProofStatus && (
                  <span className="ml-2 normal-case tracking-normal text-[var(--color-cream)]/40">
                    {order.paymentProofStatus}
                  </span>
                )}
              </span>
              {order.paymentProofUrl ? (
                <a
                  href={order.paymentProofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 rounded-lg border border-teal-700/40 bg-teal-600/10 px-3 py-1.5 text-[12px] font-medium text-teal-300 transition hover:bg-teal-600/20"
                >
                  <ExternalLink size={11} strokeWidth={1.5} />
                  View proof
                </a>
              ) : (
                <span className="text-[12px] text-[var(--color-muted-foreground)]">Received (no URL)</span>
              )}
            </div>
          )}

          {/* Cancellation */}
          {cancelled && (order.cancellationReason || order.cancelledAt) && (
            <div className="flex items-start justify-between border-t border-[var(--color-gold)]/15 pt-4">
              <span className="mr-3 shrink-0 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-cream)]/50">
                Cancelled · 取消
              </span>
              <div className="space-y-0.5 text-right">
                {order.cancellationReason && (
                  <p className="text-[13px] text-[var(--color-cream)]/80">{order.cancellationReason}</p>
                )}
                {cancelledAtLabel && (
                  <p className="staff-num text-[11px] tabular-nums text-[var(--color-cream)]/45">
                    at {cancelledAtLabel}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Placed time */}
          <div className="flex items-center justify-between border-t border-[var(--color-gold)]/15 pt-4">
            <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--color-cream)]/50">
              Placed · 下單時間
            </span>
            <span className="staff-num tabular-nums text-[13px] text-[var(--color-cream)]/75">
              {order.time}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-[var(--color-gold)]/15 px-5 py-3">
          <p className="text-center text-[11px] uppercase tracking-[0.2em] text-[var(--color-muted-foreground)]">
            Read-only · 僅供檢視
          </p>
        </div>
      </div>
    </div>
  );
}

/* ---------- Needs Attention (sticky right rail) ---------- */

function NeedsAttention({
  doneUnpaid,
  unpaidOpen,
  activeDeliveries,
  onSelectOrder,
}: {
  doneUnpaid: StaffOrder[];
  unpaidOpen: StaffOrder[];
  activeDeliveries: StaffOrder[];
  onSelectOrder: (o: StaffOrder) => void;
}) {
  const openCount = doneUnpaid.length + unpaidOpen.length;
  const hasContent = openCount > 0 || activeDeliveries.length > 0;

  return (
    <div
      className="owner-float-card overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 hover:border-[var(--color-gold)]/25"
      style={{ animation: "owner-fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) 240ms both" }}
    >
      <div className="border-b border-[var(--color-gold)]/15 px-6 py-5">
        <div className="flex items-baseline justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-gold-soft)]/90">
              Control Room · 需注意
            </div>
            <h2 className="mt-1 font-display text-[22px] leading-tight text-[var(--color-cream)]">
              Needs Attention
            </h2>
          </div>
          <span className="shrink-0 staff-num rounded-full border border-[var(--color-vermillion)]/40 bg-[var(--color-vermillion)]/15 px-2.5 py-0.5 text-[11px] text-[var(--color-vermillion)]">
            {openCount} open
          </span>
        </div>
        <p className="mt-2 text-[12px] text-[var(--color-muted-foreground)]">
          Owner-only · Manual refresh · 手動更新
        </p>
      </div>

      {hasContent ? (
        <div className="divide-y divide-[var(--color-gold)]/10">
          <AttnGroup
            title="Done / Delivered — unpaid · 已完成未付"
            tone="var(--color-vermillion)"
            orders={doneUnpaid}
            emptyHidden
            onSelectOrder={onSelectOrder}
          />
          <AttnGroup
            title="Unpaid — still open · 未付進行中"
            tone="var(--color-gold-soft)"
            orders={unpaidOpen}
            emptyHidden
            onSelectOrder={onSelectOrder}
          />
          {activeDeliveries.length > 0 && (
            <div className="px-6 py-5">
              <div className="mb-3 flex items-center gap-2.5">
                <Bike className="h-3.5 w-3.5 text-sky-400/80" strokeWidth={1.5} />
                <span className="text-[13px] text-[var(--color-cream)]">
                  Active deliveries · 配送
                </span>
                <span className="staff-num ml-auto text-[11px] text-[var(--color-muted-foreground)]">
                  {activeDeliveries.length}
                </span>
              </div>
              <ul className="space-y-1">
                {activeDeliveries.map((o) => (
                  <li
                    key={o.orderId}
                    onClick={() => onSelectOrder(o)}
                    className="cursor-pointer -mx-3 flex items-start gap-3 rounded-md px-3 py-2 transition-colors hover:bg-[var(--color-gold)]/[0.08]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-[var(--color-cream)]/90">
                        {o.customerName ?? o.customerPhone ?? "Delivery"}
                      </div>
                      <div className="staff-num truncate text-[11.5px] text-[var(--color-muted-foreground)]">
                        {o.orderId} · {STATUS_META[o.status].labelEn} · {o.time}
                      </div>
                    </div>
                    <div className="staff-num whitespace-nowrap text-[14px] text-[var(--color-gold)]">
                      {baht(o.totalPrice)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="px-6 py-10 text-center">
          <div className="mx-auto mb-3 flex items-center justify-center gap-3">
            <span className="h-px w-8 bg-[var(--color-gold)]/40" />
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/70" />
            <span className="h-px w-8 bg-[var(--color-gold)]/40" />
          </div>
          <p className="font-display text-[18px] text-[var(--color-gold-soft)]/80">全部清楚</p>
          <p className="mt-1 text-[12px] text-[var(--color-muted-foreground)]">
            Nothing waiting — every order is settled.
          </p>
        </div>
      )}
    </div>
  );
}

function AttnGroup({
  title,
  tone,
  orders,
  emptyHidden,
  onSelectOrder,
}: {
  title: string;
  tone: string;
  orders: StaffOrder[];
  emptyHidden?: boolean;
  onSelectOrder: (o: StaffOrder) => void;
}) {
  if (orders.length === 0 && emptyHidden) return null;
  return (
    <div className="px-6 py-5">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="h-4 w-1 rounded-full" style={{ background: tone }} />
        <span className="text-[13px] text-[var(--color-cream)]">{title}</span>
        <span className="staff-num ml-auto text-[11px] text-[var(--color-muted-foreground)]">
          {orders.length}
        </span>
      </div>
      <ul className="space-y-1">
        {orders.map((o) => (
          <li key={o.orderId} onClick={() => onSelectOrder(o)} className="cursor-pointer flex items-start gap-3 rounded-md px-3 py-2 -mx-3 transition-colors hover:bg-[var(--color-gold)]/[0.08]">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] text-[var(--color-cream)]/95">{locText(o)}</div>
              <div className="staff-num truncate text-[11.5px] text-[var(--color-muted-foreground)]">
                {o.orderId} · {o.time}
              </div>
            </div>
            <div className="staff-num whitespace-nowrap text-[15px] text-[var(--color-gold)]">
              {baht(o.totalPrice)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Delivery Watch ---------- */

function DeliveryWatch({
  activeCount,
  outNowCount,
  deliveredCount,
}: {
  activeCount: number;
  outNowCount: number;
  deliveredCount: number;
}) {
  return (
    <section
      className="owner-float-card overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 hover:border-[var(--color-gold)]/25"
      style={{ animation: "owner-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) 260ms both" }}
    >
      <div className="flex items-center gap-2.5 border-b border-[var(--color-gold)]/15 px-6 py-4">
        <Bike className="h-3.5 w-3.5 text-sky-400/70" strokeWidth={1.5} />
        <span className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-gold-soft)]/90">
          Delivery Watch · 配送
        </span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-[var(--color-gold)]/10">
        <DeliveryStat label="Active" labelZh="進行中" value={activeCount} dim={activeCount === 0} />
        <DeliveryStat
          label="Out Now"
          labelZh="配送中"
          value={outNowCount}
          sky={outNowCount > 0}
          dim={outNowCount === 0}
        />
        <DeliveryStat
          label="Delivered"
          labelZh="已送達"
          value={deliveredCount}
          dim={deliveredCount === 0}
        />
      </div>
    </section>
  );
}

function DeliveryStat({
  label,
  labelZh,
  value,
  sky,
  dim,
}: {
  label: string;
  labelZh: string;
  value: number;
  sky?: boolean;
  dim?: boolean;
}) {
  const valueClass = sky
    ? "text-sky-400"
    : dim
    ? "text-[var(--color-muted-foreground)]"
    : "text-[var(--color-cream)]";
  return (
    <div className="py-5 text-center">
      <div className={`staff-num text-[28px] leading-none ${valueClass}`}>{value}</div>
      <div className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted-foreground)]">
        {label}
      </div>
      <div className="text-[10px] text-[var(--color-muted-foreground)]/55">{labelZh}</div>
    </div>
  );
}

/* ---------- Cancelled Today ---------- */

function CancelledToday({
  orders,
  totalValue,
  onSelectOrder,
}: {
  orders: StaffOrder[];
  totalValue: number;
  onSelectOrder: (o: StaffOrder) => void;
}) {
  return (
    <section
      className="owner-float-card overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 hover:border-[var(--color-gold)]/25"
      style={{ animation: "owner-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) 280ms both" }}
    >
      <div className="border-b border-[var(--color-gold)]/15 px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <XCircle className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" strokeWidth={1.5} />
            <span className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-gold-soft)]/90">
              Cancelled Today · 今日取消
            </span>
          </div>
          <span className="shrink-0 staff-num text-[13px] text-[var(--color-muted-foreground)]">
            {orders.length} {orders.length === 1 ? "order" : "orders"}
          </span>
        </div>
        {totalValue > 0 && (
          <div className="mt-2 staff-num text-[18px] leading-none text-[var(--color-muted-foreground)]">
            {baht(totalValue)}{" "}
            <span className="text-[12px] font-normal text-[var(--color-muted-foreground)]/60">
              cancelled value
            </span>
          </div>
        )}
      </div>
      <ul className="divide-y divide-[var(--color-gold)]/10">
        {orders.slice(0, 5).map((o) => (
          <li
            key={o.orderId}
            onClick={() => onSelectOrder(o)}
            className="cursor-pointer flex items-start gap-3 px-6 py-3 transition-colors hover:bg-[var(--color-gold)]/[0.07]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 text-[12px]">
                <span className="staff-num text-[var(--color-muted-foreground)]">{o.orderId}</span>
                <span className="text-[var(--color-muted-foreground)]/55">
                  · {locText(o)} · {o.time}
                </span>
              </div>
              {o.cancellationReason && (
                <div className="mt-0.5 text-[11.5px] italic text-[var(--color-muted-foreground)]/70">
                  {o.cancellationReason}
                </div>
              )}
            </div>
            <span className="shrink-0 staff-num text-[13px] text-[var(--color-muted-foreground)] line-through">
              {baht(o.totalPrice)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Revenue Trend chart ---------- */
// Groups paid (cash + transfer, non-cancelled) orders by local hour for `day`.
// Uses paidAt when present (when payment was recorded), falls back to createdAt
// (order time). Returns a map of { hour → revenue }.
function paidRevenueByHour(orders: readonly StaffOrder[], day: Date): Record<number, number> {
  const map: Record<number, number> = {};
  for (const o of orders) {
    if (o.paymentStatus !== "paid" || o.status === "cancelled") continue;
    const ts = o.paidAt ?? o.createdAt;
    if (!ts) continue;
    const d = new Date(ts);
    if (
      d.getFullYear() !== day.getFullYear() ||
      d.getMonth() !== day.getMonth() ||
      d.getDate() !== day.getDate()
    )
      continue;
    const h = d.getHours();
    map[h] = (map[h] ?? 0) + o.totalPrice;
  }
  return map;
}

type TrendPoint = { hour: string; today: number; yesterday?: number };

// Builds the hour-indexed data array for the chart. Hours range from the
// earliest activity (min of OPEN_HOUR and first data hour) to nowHour+1 for
// today-only, or through 23 when yesterday data is also present.
function buildTrendData(
  todayMap: Record<number, number>,
  yestMap: Record<number, number> | null,
  nowHour: number,
): TrendPoint[] {
  const OPEN_HOUR = 10;
  const todayKeys = Object.keys(todayMap).map(Number);
  const yestKeys = yestMap ? Object.keys(yestMap).map(Number) : [];
  const allKeys = [...todayKeys, ...yestKeys];
  const startH = allKeys.length > 0 ? Math.min(OPEN_HOUR, Math.min(...allKeys)) : OPEN_HOUR;
  const endH = yestMap ? 23 : Math.min(nowHour + 1, 23);

  const points: TrendPoint[] = [];
  for (let h = startH; h <= endH; h++) {
    const pt: TrendPoint = {
      hour: `${String(h).padStart(2, "0")}:00`,
      today: todayMap[h] ?? 0,
    };
    if (yestMap) pt.yesterday = yestMap[h] ?? 0;
    points.push(pt);
  }
  return points;
}

function RevenueTrendTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-lg border border-[var(--color-gold)]/20 px-3 py-2.5 text-[12px]"
      style={{ background: "oklch(0.20 0.014 60 / 0.97)" }}
    >
      <div className="mb-1.5 text-[10px] uppercase tracking-[0.18em] text-[var(--color-gold-soft)]/80">
        {label}
      </div>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5" style={{ color: entry.color }}>
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: entry.color as string }}
            />
            {entry.name === "today" ? "Today" : "Yesterday"}
          </span>
          <span className="staff-num font-medium" style={{ color: entry.color }}>
            {baht(entry.value ?? 0)}
          </span>
        </div>
      ))}
    </div>
  );
}

function RevenueTrend({
  orders,
  now,
}: {
  orders: readonly StaffOrder[];
  now: Date;
}) {
  const yesterday = useMemo(() => {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }, [now]);

  const todayMap = useMemo(() => paidRevenueByHour(orders, now), [orders, now]);
  const yestMap = useMemo(() => paidRevenueByHour(orders, yesterday), [orders, yesterday]);

  const hasYestData = Object.keys(yestMap).length > 0;
  const hasTodayData = Object.keys(todayMap).length > 0;

  const chartData = useMemo(
    () => buildTrendData(todayMap, hasYestData ? yestMap : null, now.getHours()),
    [todayMap, yestMap, hasYestData, now],
  );

  const GOLD = "var(--color-gold)";
  const GOLD_SOFT = "var(--color-gold-soft)";

  return (
    <section
      className="owner-float-card rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 px-7 py-7 hover:border-[var(--color-gold)]/25"
      style={{ animation: "owner-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) 95ms both" }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-gold-soft)]/90">
            Sales Movement · 收款趨勢
          </div>
          <h2 className="mt-1 font-display text-[22px] leading-tight text-[var(--color-cream)]">
            Revenue Trend
          </h2>
          <p className="mt-0.5 text-[12px] text-[var(--color-muted-foreground)]">
            Paid cash + transfer only
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 pt-1 text-[11px] text-[var(--color-muted-foreground)]">
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-5 rounded-full bg-[var(--color-gold)]" />
            Today
          </span>
          {hasYestData && (
            <span className="flex items-center gap-1.5 opacity-60">
              <span className="h-[2px] w-5 rounded-full bg-[var(--color-gold-soft)]" />
              Yesterday
            </span>
          )}
        </div>
      </div>

      {!hasTodayData ? (
        <div className="relative mt-5 h-[160px] overflow-hidden rounded-lg">
          {/* Ghost grid — conveys chart structure without fake data */}
          <svg
            viewBox="0 0 400 100"
            className="absolute inset-0 h-full w-full"
            preserveAspectRatio="none"
            aria-hidden
          >
            <line x1="0" y1="20" x2="400" y2="20" stroke="oklch(0.72 0.11 75 / 0.1)" strokeWidth="1" />
            <line x1="0" y1="45" x2="400" y2="45" stroke="oklch(0.72 0.11 75 / 0.1)" strokeWidth="1" />
            <line x1="0" y1="70" x2="400" y2="70" stroke="oklch(0.72 0.11 75 / 0.1)" strokeWidth="1" />
            <line x1="0" y1="93" x2="400" y2="93" stroke="oklch(0.72 0.11 75 / 0.22)" strokeWidth="1" />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
            <p className="text-[13px] text-[var(--color-muted-foreground)]">
              No paid sales yet today.
            </p>
            <p className="text-[11px] text-[var(--color-muted-foreground)]/60">
              Paid sales will appear here by hour.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-5 h-[160px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="oklch(0.72 0.11 75 / 0.1)" />
              <XAxis
                dataKey="hour"
                tick={{
                  fontSize: 10,
                  fill: "var(--color-muted-foreground)",
                  fontFamily: "var(--font-sans)",
                }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tickFormatter={(v: number) =>
                  v === 0 ? "฿0" : `฿${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`
                }
                tick={{
                  fontSize: 10,
                  fill: "var(--color-muted-foreground)",
                  fontFamily: "var(--font-sans)",
                }}
                tickLine={false}
                axisLine={false}
                width={46}
              />
              <Tooltip
                content={<RevenueTrendTooltip />}
                cursor={{ stroke: "oklch(0.72 0.11 75 / 0.2)", strokeWidth: 1 }}
              />
              {hasYestData && (
                <Line
                  type="monotone"
                  dataKey="yesterday"
                  name="yesterday"
                  stroke={GOLD_SOFT}
                  strokeWidth={1.5}
                  strokeOpacity={0.45}
                  dot={false}
                  activeDot={{ r: 3, fill: GOLD_SOFT, strokeWidth: 0 }}
                  animationDuration={900}
                  animationBegin={150}
                  animationEasing="ease-out"
                />
              )}
              <Line
                type="monotone"
                dataKey="today"
                name="today"
                stroke={GOLD}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3.5, fill: GOLD, strokeWidth: 0 }}
                animationDuration={1000}
                animationBegin={0}
                animationEasing="ease-out"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {!hasYestData && hasTodayData && (
        <p className="mt-2 text-[11px] text-[var(--color-muted-foreground)]/70">
          Yesterday data not available — showing today only.
        </p>
      )}
    </section>
  );
}

/* ---------- Expenses Today (owner-side read-only view) ---------- */
// Shows today's purchase log from the same getExpenses() the staff form writes to.
// Amounts are displayed in vermillion (cost out) to visually contrast with gold revenue.
// Gross sales figures are never touched here — expenses are always a separate section.

const EXPENSE_CATEGORY_COLOR: Record<string, string> = {
  Drinks:        "bg-sky-500/15 text-sky-300",
  Ingredient:    "bg-emerald-500/15 text-emerald-300",
  "Stock Refill":"bg-amber-500/15 text-amber-300",
  Utility:       "bg-violet-500/15 text-violet-300",
  Delivery:      "bg-orange-500/15 text-orange-300",
  Other:         "bg-stone-500/15 text-stone-300",
};

const PAID_FROM_ROWS: { key: string; label: string; zh: string }[] = [
  { key: "Cash",       label: "Cash",        zh: "現金" },
  { key: "Transfer",   label: "Transfer",    zh: "轉帳" },
  { key: "Owner Paid", label: "Owner Paid",  zh: "老闆付" },
  { key: "Other",      label: "Other",       zh: "其他" },
];

function fmtExpTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : hhmm(d);
}

function ExpenseSummary({
  expenses,
  loadState,
  onRetry,
}: {
  expenses: Expense[];
  loadState: LoadState;
  onRetry: () => void;
}) {
  const total = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);

  const byPaidFrom = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const e of expenses) acc[e.paidFrom] = (acc[e.paidFrom] ?? 0) + e.amount;
    return acc;
  }, [expenses]);

  const recent = expenses.slice(0, 10);

  return (
    <section
      className="owner-float-card overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 hover:border-[var(--color-gold)]/25"
      style={{ animation: "owner-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) 340ms both" }}
    >
      {/* Header */}
      <div className="border-b border-[var(--color-gold)]/15 px-6 py-5">
        <div className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-gold-soft)]/90">
          Purchase Log · 支出記錄
        </div>
        <div className="mt-1 flex items-baseline justify-between gap-3">
          <h2 className="font-display text-[22px] leading-tight text-[var(--color-cream)]">
            Expenses Today
          </h2>
          {loadState === "ready" && expenses.length > 0 && (
            <span className="shrink-0 staff-num text-[20px] text-[var(--color-vermillion)]">
              {baht(total)}
            </span>
          )}
        </div>
      </div>

      {/* States */}
      {loadState === "loading" && (
        <div className="flex items-center justify-center gap-1.5 py-8">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-2 w-2 rounded-full bg-[var(--color-gold)]/50 animate-pulse"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      )}

      {loadState === "error" && (
        <div className="px-6 py-8 text-center">
          <p className="text-[13px] text-[var(--color-muted-foreground)]">
            Could not load expenses.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-3 text-[12px] text-[var(--color-gold-soft)]/80 underline underline-offset-2 transition hover:text-[var(--color-cream)]"
          >
            Retry
          </button>
        </div>
      )}

      {loadState === "ready" && expenses.length === 0 && (
        <p className="px-6 py-8 text-center text-[13px] text-[var(--color-muted-foreground)]">
          沒有支出 · No expenses logged today.
        </p>
      )}

      {loadState === "ready" && expenses.length > 0 && (
        <>
          {/* Payment-method breakdown */}
          <div className="space-y-2.5 border-b border-[var(--color-gold)]/10 px-6 py-4">
            {PAID_FROM_ROWS.map(({ key, label, zh }) => {
              const amount = byPaidFrom[key] ?? 0;
              if (amount === 0) return null;
              return (
                <div key={key} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 text-[var(--color-cream)]/80">
                    {label}{" "}
                    <span className="text-[11px] text-[var(--color-muted-foreground)]">{zh}</span>
                  </span>
                  <span className="shrink-0 staff-num text-[var(--color-vermillion)]">{baht(amount)}</span>
                </div>
              );
            })}
          </div>

          {/* Recent expense rows */}
          <ul className="divide-y divide-[var(--color-gold)]/10">
            {recent.map((exp) => (
              <li
                key={exp.id}
                className="flex items-start gap-3 px-6 py-3.5 transition-colors hover:bg-[var(--color-gold)]/[0.04]"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-[var(--color-cream)]/95">
                    {exp.itemName}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${EXPENSE_CATEGORY_COLOR[exp.category] ?? "bg-stone-500/15 text-stone-300"}`}
                    >
                      {exp.category}
                    </span>
                    <span className="text-[11px] text-[var(--color-muted-foreground)]">
                      {exp.paidFrom}
                    </span>
                    {exp.reviewStatus && exp.reviewStatus !== "Pending" && (
                      <span className="text-[11px] text-emerald-400/80">{exp.reviewStatus}</span>
                    )}
                    {exp.note && exp.note.length <= 45 && (
                      <span className="truncate text-[11px] text-[var(--color-muted-foreground)]/65">
                        {exp.note}
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="staff-num text-[15px] text-[var(--color-vermillion)]">
                    {baht(exp.amount)}
                  </div>
                  <div className="staff-num mt-0.5 text-[10.5px] text-[var(--color-muted-foreground)]">
                    {fmtExpTime(exp.createdAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/* ---------- Loading / Error ---------- */

function LoadingState() {
  return (
    <div className="mt-16 text-center">
      <div className="mb-4 flex items-center justify-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-2 w-2 rounded-full bg-[var(--color-gold)]/60 animate-pulse"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
      <p className="font-display text-[20px] text-[var(--color-gold-soft)]/80">
        載入中 · Loading tonight&apos;s figures…
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mt-12">
      <div className="mx-auto max-w-[440px] rounded-2xl border border-[var(--color-vermillion)]/40 bg-[var(--color-charcoal-soft)]/70 px-6 py-8 text-center">
        <p className="font-display text-[22px] text-[var(--color-cream)]">
          無法載入 · Can&apos;t load dashboard
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
          Check the order server, then try again.
        </p>
        <button
          onClick={onRetry}
          className="mt-5 h-12 rounded-full bg-[var(--color-vermillion)] px-8 text-[15px] font-semibold tracking-[0.02em] text-[var(--color-cream)] transition active:scale-[0.97]"
        >
          重試 · Retry
        </button>
      </div>
    </div>
  );
}
