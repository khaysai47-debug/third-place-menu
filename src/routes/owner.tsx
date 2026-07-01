// Owner Dashboard v1 — read-only control room. Reuses the same order feed as the
// staff board (getStaffOrders) and derives tonight's money figures with
// summarizeToday. No write actions, no backend changes. Realized (paid) revenue
// is the headline; unpaid and done-but-unpaid are surfaced separately for
// payment auditing. Layout only: 3-column shell (sidebar / main / needs-attention)
// on desktop, single column on mobile. All numbers come from real data.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  Bike,
  ClipboardList,
  LayoutGrid,
  LineChart as LineChartIcon,
  Receipt,
  RefreshCw,
  Scale,
  Settings,
  TrendingDown,
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
import { STATUS_META } from "@/components/staff/orderStatus";
import { getStaffOrders, type StaffOrder } from "@/lib/staffOrders";
import { isSameLocalDay, summarizeToday, todaysOrders } from "@/lib/ownerSummary";
import { getExpenses, type Expense } from "@/lib/expenses";

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

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void refreshOrders();
    }, 10000);
    return () => window.clearInterval(id);
  }, [refreshOrders]);

  // Auto-refresh expenses every 30 s and whenever the tab becomes visible again.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void silentRefreshExpenses();
    }, 30000);
    const onVisible = () => {
      if (!document.hidden) void silentRefreshExpenses();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [silentRefreshExpenses]);

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

  return (
    <div
      className="min-h-screen ink-grain lg:flex"
      style={{ backgroundColor: "oklch(0.145 0.005 60)" }}
    >
      <OwnerSidebar />

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
        ) : (
          <main className="mx-auto grid w-full max-w-[1600px] grid-cols-12 gap-6 px-5 py-6 lg:px-8">
            <section className="col-span-12 space-y-6 xl:col-span-8">
              <Hero summary={summary} />
              <MetricsGrid summary={summary} />
              <ExpenseNetRow
                expensesTotal={expensesTotalToday}
                collected={summary.collected}
                expLoadState={expLoadState}
              />
              <RevenueTrend orders={orders} now={now} />
              <RecentOrders recent={recentAll} />
            </section>

            <aside className="col-span-12 space-y-6 xl:col-span-4">
              <NeedsAttention
                doneUnpaid={doneUnpaid}
                unpaidOpen={unpaidOpen}
                activeDeliveries={activeDeliveries}
                cancelledOrders={cancelledToday}
              />
              <DeliveryWatch
                activeCount={activeDeliveries.length}
                outNowCount={outForDeliveryNow.length}
                deliveredCount={deliveredToday.length}
              />
              {cancelledToday.length > 0 && (
                <CancelledToday orders={cancelledToday} totalValue={cancelledTodayValue} />
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
          </main>
        )}
      </div>
    </div>
  );
}

/* ---------- Sidebar (static, desktop only) ---------- */

const NAV: { label: string; icon: LucideIcon; active?: boolean }[] = [
  { label: "Overview",  icon: LayoutGrid,  active: true },
  { label: "Orders",    icon: ClipboardList },
  { label: "Menu",      icon: UtensilsCrossed },
  { label: "Payments",  icon: Banknote },
  { label: "Reports",   icon: LineChartIcon },
  { label: "Settings",  icon: Settings },
];

function OwnerSidebar() {
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
        {NAV.map(({ label, icon: Icon, active }) => (
          <button
            key={label}
            type="button"
            aria-current={active ? "page" : undefined}
            aria-disabled={!active}
            onClick={active ? undefined : () => showHint(label)}
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[14px] transition-colors ${
              active
                ? "bg-[var(--color-charcoal-soft)] text-[var(--color-cream)] shadow-[inset_2px_0_0_var(--color-gold)]"
                : "cursor-default text-[var(--color-gold-soft)]/45 hover:bg-[var(--color-gold)]/[0.04] hover:text-[var(--color-gold-soft)]/65"
            }`}
          >
            <Icon
              className="h-[15px] w-[15px]"
              strokeWidth={1.5}
              style={{ opacity: active ? 0.85 : 0.45 }}
            />
            <span className="flex-1 text-left">{label}</span>
            {!active && (
              <span
                className="shrink-0 rounded-sm px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-[var(--color-muted-foreground)]"
                style={{ border: "1px solid oklch(0.72 0.11 75 / 0.18)" }}
              >
                Soon
              </span>
            )}
          </button>
        ))}
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
            Overview is live. More sections arriving soon.
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
      className="owner-float-card overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 px-7 py-7 hover:border-[var(--color-gold)]/25"
      style={{ animation: "owner-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) 120ms both" }}
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

function RecentOrders({ recent }: { recent: StaffOrder[] }) {
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
                  <tr key={o.orderId} className="border-t border-[var(--color-gold)]/10 transition-colors hover:bg-[var(--color-gold)]/[0.04]">
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

/* ---------- Needs Attention (sticky right rail) ---------- */

function NeedsAttention({
  doneUnpaid,
  unpaidOpen,
  activeDeliveries,
  cancelledOrders,
}: {
  doneUnpaid: StaffOrder[];
  unpaidOpen: StaffOrder[];
  activeDeliveries: StaffOrder[];
  cancelledOrders: StaffOrder[];
}) {
  const openCount = doneUnpaid.length + unpaidOpen.length;
  const hasContent =
    openCount > 0 || activeDeliveries.length > 0 || cancelledOrders.length > 0;

  return (
    <div
      className="overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 xl:sticky xl:top-6"
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
          Owner-only · refreshes live every 10s
        </p>
      </div>

      {hasContent ? (
        <div className="divide-y divide-[var(--color-gold)]/10">
          <AttnGroup
            title="Done / Delivered — unpaid · 已完成未付"
            tone="var(--color-vermillion)"
            orders={doneUnpaid}
            emptyHidden
          />
          <AttnGroup
            title="Unpaid — still open · 未付進行中"
            tone="var(--color-gold-soft)"
            orders={unpaidOpen}
            emptyHidden
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
                    className="-mx-3 flex items-start gap-3 rounded-md px-3 py-2 transition-colors hover:bg-[var(--color-gold)]/[0.08]"
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
          {cancelledOrders.length > 0 && (
            <div className="px-6 py-5">
              <div className="mb-3 flex items-center gap-2.5">
                <span className="h-4 w-1 shrink-0 rounded-full bg-stone-500/80" />
                <span className="text-[13px] text-[var(--color-cream)]">
                  Cancelled today · 今日取消
                </span>
                <span className="staff-num ml-auto text-[11px] text-[var(--color-muted-foreground)]">
                  {cancelledOrders.length}
                </span>
              </div>
              <ul className="space-y-1">
                {cancelledOrders.slice(0, 3).map((o) => (
                  <li
                    key={o.orderId}
                    className="-mx-3 flex items-start gap-3 rounded-md px-3 py-2 transition-colors hover:bg-[var(--color-gold)]/[0.08]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-[var(--color-muted-foreground)]/90">
                        {locText(o)} · {o.orderId} · {o.time}
                      </div>
                      {o.cancellationReason && (
                        <div className="text-[11.5px] italic text-[var(--color-muted-foreground)]/60">
                          {o.cancellationReason}
                        </div>
                      )}
                    </div>
                    <div className="staff-num whitespace-nowrap text-[13px] text-[var(--color-muted-foreground)] line-through">
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
}: {
  title: string;
  tone: string;
  orders: StaffOrder[];
  emptyHidden?: boolean;
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
          <li key={o.orderId} className="flex items-start gap-3 rounded-md px-3 py-2 -mx-3 transition-colors hover:bg-[var(--color-gold)]/[0.08]">
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
}: {
  orders: StaffOrder[];
  totalValue: number;
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
            className="flex items-start gap-3 px-6 py-3 transition-colors hover:bg-[var(--color-gold)]/[0.04]"
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
      style={{ animation: "owner-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) 200ms both" }}
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
                className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--color-gold)]/[0.04]"
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
