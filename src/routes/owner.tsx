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
  ClipboardList,
  LayoutGrid,
  LineChart,
  Receipt,
  RefreshCw,
  Settings,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { orderLocation } from "@/components/staff/StaffOrderCard";
import { STATUS_META } from "@/components/staff/orderStatus";
import { getStaffOrders, type StaffOrder } from "@/lib/staffOrders";
import { summarizeToday, todaysOrders } from "@/lib/ownerSummary";

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

  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) void refreshOrders();
    }, 10000);
    return () => window.clearInterval(id);
  }, [refreshOrders]);

  const summary = useMemo(() => summarizeToday(orders, now), [orders, now]);
  const today = useMemo(() => todaysOrders(orders, now), [orders, now]);
  // Done but unpaid — food handed out, money not collected (top audit signal).
  const doneUnpaid = useMemo(
    () => today.filter((o) => o.status === "done" && o.paymentStatus === "unpaid"),
    [today],
  );
  // Unpaid but still in progress (not yet done) — open tabs to keep an eye on.
  const unpaidOpen = useMemo(
    () => today.filter((o) => o.status !== "done" && o.paymentStatus === "unpaid"),
    [today],
  );
  const recent = useMemo(() => today.slice(0, 10), [today]);

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
          onRefresh={() => void refreshOrders()}
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
              <PaymentMix
                collected={summary.collected}
                cash={summary.cash}
                transfer={summary.transfer}
                unpaid={summary.unpaidTotal}
                unpaidCount={summary.unpaidCount}
              />
              <RecentOrders recent={recent} />
            </section>

            <aside className="col-span-12 xl:col-span-4">
              <NeedsAttention doneUnpaid={doneUnpaid} unpaidOpen={unpaidOpen} />
            </aside>
          </main>
        )}
      </div>
    </div>
  );
}

/* ---------- Sidebar (static, desktop only) ---------- */

const NAV: { label: string; icon: LucideIcon; active?: boolean }[] = [
  { label: "Overview", icon: LayoutGrid, active: true },
  { label: "Orders", icon: ClipboardList },
  { label: "Menu", icon: UtensilsCrossed },
  { label: "Payments", icon: Banknote },
  { label: "Reports", icon: LineChart },
  { label: "Settings", icon: Settings },
];

function OwnerSidebar() {
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
            className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[14px] transition-colors ${
              active
                ? "bg-[var(--color-charcoal-soft)] text-[var(--color-cream)] shadow-[inset_2px_0_0_var(--color-gold)]"
                : "cursor-default text-[var(--color-gold-soft)]/55"
            }`}
          >
            <Icon className="h-[15px] w-[15px] opacity-80" strokeWidth={1.5} />
            <span className="flex-1 text-left">{label}</span>
          </button>
        ))}
      </nav>

      <p className="border-t border-[var(--color-gold)]/15 px-6 py-4 text-[10.5px] leading-relaxed text-[var(--color-muted-foreground)]">
        Overview is live. Other sections arrive in a later release.
      </p>
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
        <div>
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
      className="relative overflow-hidden rounded-2xl border px-7 py-7"
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
        <div>
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
      <div className="relative mt-5 staff-num text-[52px] leading-none text-[var(--color-gold)] sm:text-[60px]">
        {baht(summary.collected)}
      </div>
      <div className="relative mt-3 text-[13px] text-[var(--color-muted-foreground)]">
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
        label="Done · Unpaid"
        labelZh="已完成未付"
        value={String(summary.doneUnpaidCount)}
        sub="food out, not paid"
        tone={summary.doneUnpaidCount > 0 ? "alert" : "muted"}
        animDelay={290}
      />
    </div>
  );
}

type Tone = "money" | "warn" | "alert" | "muted";

function toneColor(tone: Tone): string {
  switch (tone) {
    case "money":
      return "var(--color-gold)";
    case "warn":
      return "var(--color-gold-soft)";
    case "alert":
      return "var(--color-vermillion)";
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
      className="group relative overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 px-5 py-5 transition-colors hover:border-[var(--color-gold)]/28"
      style={{ animation: `owner-fade-up 0.55s cubic-bezier(0.22, 1, 0.36, 1) ${animDelay}ms both` }}
    >
      <span
        aria-hidden
        className="absolute bottom-5 left-0 top-5 w-[2px] rounded-r-full opacity-60 transition-opacity group-hover:opacity-100"
        style={{ background: accent }}
      />
      <div className="flex items-center justify-between gap-2 text-[12px] text-[var(--color-gold-soft)]/90">
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4" strokeWidth={1.5} style={{ color: accent, opacity: 0.85 }} />
          {label}
        </span>
        <span className="text-[var(--color-muted-foreground)]">{labelZh}</span>
      </div>
      <div
        className="mt-3 staff-num text-[28px] leading-none"
        style={{ color: tone === "muted" ? "var(--color-cream)" : accent }}
      >
        {value}
      </div>
      <div className="mt-2 text-[12px] text-[var(--color-muted-foreground)]">{sub}</div>
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
      className="rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 px-7 py-7"
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
        <div className="w-full flex-1">
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
      <span className="flex items-center gap-2.5 text-[var(--color-cream)]/90">
        <span className={`h-2.5 w-2.5 rounded-sm ${dot}`} />
        {label}
      </span>
      <span className="flex items-baseline gap-3">
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
      className="overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60"
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
          <table className="w-full text-[13px]">
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
}: {
  doneUnpaid: StaffOrder[];
  unpaidOpen: StaffOrder[];
}) {
  const openCount = doneUnpaid.length + unpaidOpen.length;

  return (
    <div
      className="overflow-hidden rounded-xl border border-[var(--color-gold)]/15 bg-[var(--color-charcoal-soft)]/60 xl:sticky xl:top-6"
      style={{ animation: "owner-fade-up 0.6s cubic-bezier(0.22, 1, 0.36, 1) 240ms both" }}
    >
      <div className="border-b border-[var(--color-gold)]/15 px-6 py-5">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-[0.25em] text-[var(--color-gold-soft)]/90">
              Control Room · 需注意
            </div>
            <h2 className="mt-1 font-display text-[22px] leading-tight text-[var(--color-cream)]">
              Needs Attention
            </h2>
          </div>
          <span className="staff-num rounded-full border border-[var(--color-vermillion)]/40 bg-[var(--color-vermillion)]/15 px-2.5 py-0.5 text-[11px] text-[var(--color-vermillion)]">
            {openCount} open
          </span>
        </div>
        <p className="mt-2 text-[12px] text-[var(--color-muted-foreground)]">
          Owner-only · refreshes live every 10s
        </p>
      </div>

      {openCount > 0 ? (
        <div className="divide-y divide-[var(--color-gold)]/10">
          <AttnGroup
            title="Done but unpaid · 已完成未付"
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
