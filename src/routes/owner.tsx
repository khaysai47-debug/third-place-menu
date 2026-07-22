// Owner Console — 「炭」 The Brazier.
//
// Read-only control room. Reuses the same order feed as the staff board
// (getStaffOrders) and derives tonight's money figures with summarizeToday.
// No write actions, no backend changes. Realized (paid) revenue is the
// headline; unpaid and done-but-unpaid are surfaced separately for payment
// auditing. All numbers come from real data.
//
// DESIGN: the room is lit by one source, above and to the left. Cards are
// lacquer slabs sitting on explicit depth planes, and warmth means "this
// needs you" — nothing is warm for decoration. Surface, depth and motion
// vocabulary lives in src/components/owner/console.tsx and the ".oc-" block
// of src/styles.css; this file owns data and layout only.
//
// Reading order of the overview, top to bottom, is operational priority:
// money in hand → what is owed → where revenue moved → what the floor did.

import { createFileRoute } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
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
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  type TooltipProps,
  XAxis,
  YAxis,
} from "recharts";
import { orderLocation } from "@/components/staff/StaffOrderCard";
import { PAYMENT_META, STATUS_META } from "@/components/staff/orderStatus";
import { getOrderRepository } from "@/lib/data/orderRepository";
import { getExpenseRepository } from "@/lib/data/expenseRepository";
import { StaffAccessError } from "@/lib/data/staffReadClient";
import { getStaffWriteSecret } from "@/lib/staffWriteSecret";
import { AccessGate } from "@/components/staff/AccessGate";
import type { StaffOrder, StaffOrderStatus } from "@/lib/staffOrders";
import {
  formatOrderType,
  isActiveStatus,
  isCompletedStatus,
  isPaymentRisk,
} from "@/lib/orderRules";
import { isSameLocalDay, summarizeToday, todaysOrders } from "@/lib/ownerSummary";
import type { Expense } from "@/lib/expenses";
import { CATEGORIES, MENU, type MenuCategoryId } from "@/data/menu";
import {
  BrandMark,
  Count,
  EmberBed,
  Eyebrow,
  LiveSeal,
  Money,
  PanelHead,
  Slab,
  Sparkline,
} from "@/components/owner/console";
import { useTilt } from "@/components/owner/useTilt";
import { cn } from "@/lib/utils";

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

function longDate(now: Date): string {
  return now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

const OWNER_NAME = "Mike Li";

// Repositories = n8n bridge today, Supabase after separation (dataSource.ts).
// Owner stays read-only: only the list methods are ever called here.
const orderRepo = getOrderRepository();
const expenseRepo = getExpenseRepository();

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
  // Pilot access gate (Pre-Pilot Security Hardening) — same shared secret as
  // /staff. The SERVER enforces access on every /api/staff/* read; these
  // states only drive the gate UX (see staff.tsx for the same pattern).
  // Start gated so SSR/the first client render cannot flash dashboard content
  // before the localStorage-backed key has been checked.
  const [unlocked, setUnlocked] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  // Stamped on every (re)load so the "today" window and header date stay correct
  // across midnight without a manual reload. `now` only changes when data does.
  const [nowTs, setNowTs] = useState(() => Date.now());
  const now = useMemo(() => new Date(nowTs), [nowTs]);

  const refreshingRef = useRef(false);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expLoadState, setExpLoadState] = useState<LoadState>("loading");
  const expRefreshingRef = useRef(false);

  // All data access goes through the src/lib domain functions (n8n bridge
  // today, Supabase/backend after separation) — swap implementations there,
  // never in this screen.
  const loadOrders = useCallback(async () => {
    setLoadState("loading");
    try {
      setOrders(await orderRepo.listOrders());
      setNowTs(Date.now());
      setLoadState("ready");
      // A successful protected read IS the key validation — the gate (if
      // shown) unmounts only here.
      setUnlocked(true);
      setAccessDenied(false);
    } catch (error) {
      // Access problems show the gate, not the generic error state.
      if (error instanceof StaffAccessError) {
        if (error.reason === "denied") setAccessDenied(true);
        setUnlocked(false);
        return;
      }
      // Non-auth failure (server/network down): show the dashboard's normal
      // error + retry state — there is no data to protect in it.
      console.error("Failed to load owner dashboard orders", error);
      setLoadState("error");
      setUnlocked(true);
    }
  }, []);

  useEffect(() => {
    const has = Boolean(getStaffWriteSecret());
    setUnlocked(has);
    if (has) void loadOrders();
  }, [loadOrders]);

  const loadExpenses = useCallback(async () => {
    setExpLoadState("loading");
    try {
      setExpenses(await expenseRepo.listExpenses());
      setExpLoadState("ready");
    } catch (err) {
      if (err instanceof StaffAccessError) {
        if (err.reason === "denied") setAccessDenied(true);
        setUnlocked(false);
        return;
      }
      console.error("Owner expense fetch failed", err);
      setExpLoadState("error");
    }
  }, []);

  useEffect(() => {
    if (getStaffWriteSecret()) void loadExpenses();
  }, [loadExpenses]);

  // Silent background re-sync (read-only, no optimistic state to protect).
  // Paused while the tab is hidden; overlap-guarded.
  const refreshOrders = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      setOrders(await orderRepo.listOrders());
      setNowTs(Date.now());
    } catch (error) {
      // Secret cleared/rotated mid-session: fall back to the gate.
      if (error instanceof StaffAccessError) {
        if (error.reason === "denied") setAccessDenied(true);
        setUnlocked(false);
        return;
      }
      console.error("Owner dashboard refresh failed", error);
    } finally {
      refreshingRef.current = false;
    }
  }, []);

  const silentRefreshExpenses = useCallback(async () => {
    if (expRefreshingRef.current) return;
    expRefreshingRef.current = true;
    try {
      setExpenses(await expenseRepo.listExpenses());
      setExpLoadState("ready");
    } catch { /* silent — order data is still live */ }
    finally { expRefreshingRef.current = false; }
  }, []);

  // Auto-polling disabled — use the manual Refresh button to avoid burning n8n executions.

  // Presentation-only: the refresh control needs to acknowledge the press
  // while the two reads are in flight. It wraps the same calls, unchanged.
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([refreshOrders(), silentRefreshExpenses()]);
    } finally {
      setRefreshing(false);
    }
  }, [refreshOrders, silentRefreshExpenses]);

  // Gate submit (the gate already stored the entered key): validate it by
  // loading — the gate stays up until the server accepts the read
  // (loadOrders flips unlocked on success / non-auth failure).
  const handleSecretEntry = useCallback(() => {
    setAccessDenied(false);
    if (getStaffWriteSecret()) {
      void loadOrders();
      void loadExpenses();
    }
  }, [loadOrders, loadExpenses]);

  const summary = useMemo(() => summarizeToday(orders, now), [orders, now]);
  const today = useMemo(() => todaysOrders(orders, now), [orders, now]);
  // Completed (done or delivered) but unpaid — food/delivery out, money not collected.
  const doneUnpaid = useMemo(() => today.filter(isPaymentRisk), [today]);
  // Unpaid and still active — exclude completed and cancelled statuses.
  const unpaidOpen = useMemo(
    () => today.filter((o) => isActiveStatus(o.status) && o.paymentStatus === "unpaid"),
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

  // How busy the floor is right now, 0..1. Drives the ember bed under the
  // command bar so the console reads as alive (or as closed) without the
  // owner looking at a single number. Six concurrent orders is a full pass.
  const heat = useMemo(
    () => Math.min(1, today.filter((o) => isActiveStatus(o.status)).length / 6),
    [today],
  );

  const attentionCount = doneUnpaid.length + unpaidOpen.length;

  if (!unlocked || accessDenied) {
    return <AccessGate area="owner" denied={accessDenied} onSubmitted={handleSecretEntry} />;
  }

  return (
    <div
      data-owner-console
      className="ink-grain flex min-h-[100dvh] flex-col lg:flex-row"
      style={{ backgroundColor: "oklch(0.145 0.005 60)" }}
    >
      {selectedOrder && (
        <OwnerOrderModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
      )}

      <ConsoleRail
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        attentionCount={attentionCount}
      />

      {/* pb clears the mobile tab bar; lg has the rail instead. */}
      <div className="min-w-0 flex-1 pb-[76px] lg:pb-0">
        <CommandBar
          now={now}
          live={loadState === "ready"}
          heat={heat}
          refreshing={refreshing}
          onRefresh={() => void handleRefresh()}
        />

        {loadState === "loading" ? (
          <LoadingDeck />
        ) : loadState === "error" ? (
          <ErrorState onRetry={() => void loadOrders()} />
        ) : (
          // Keyed on the section so switching views reads as the console
          // turning to face somewhere else, not as a hard content swap.
          <main key={activeSection} className="oc-view oc-grid">
            {activeSection === "orders" ? (
              <OwnerOrdersView orders={allTodayOrders} now={now} onSelectOrder={setSelectedOrder} />
            ) : activeSection === "payments" ? (
              <OwnerPaymentsView orders={allTodayOrders} now={now} onSelectOrder={setSelectedOrder} />
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
              <OverviewDeck
                orders={orders}
                now={now}
                summary={summary}
                doneUnpaid={doneUnpaid}
                unpaidOpen={unpaidOpen}
                activeDeliveries={activeDeliveries}
                outForDeliveryNow={outForDeliveryNow}
                deliveredToday={deliveredToday}
                cancelledToday={cancelledToday}
                cancelledTodayValue={cancelledTodayValue}
                recentAll={recentAll}
                expenses={expenses}
                expensesTotal={expensesTotalToday}
                expLoadState={expLoadState}
                onRetryExpenses={() => void loadExpenses()}
                onSelectOrder={setSelectedOrder}
              />
            )}
          </main>
        )}
      </div>

      <ConsoleTabs activeSection={activeSection} onSectionChange={setActiveSection} />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Shell — rail, tab bar, command bar
   ═══════════════════════════════════════════════════════════════════════ */

type OwnerSection = "overview" | "orders" | "payments" | "reports" | "menu";

const NAV_ITEMS: { id: OwnerSection; label: string; labelZh: string; icon: LucideIcon }[] = [
  { id: "overview", label: "Overview", labelZh: "總覽", icon: LayoutGrid },
  { id: "orders",   label: "Orders",   labelZh: "訂單", icon: ClipboardList },
  { id: "menu",     label: "Menu",     labelZh: "菜單", icon: UtensilsCrossed },
  { id: "payments", label: "Payments", labelZh: "收款", icon: Banknote },
  { id: "reports",  label: "Reports",  labelZh: "報表", icon: LineChartIcon },
];

// Rail rows are 44px with a 4px gap, so the light travels a 48px stride.
// Keeping this a constant means the indicator and the buttons can never
// drift apart when the row height is tuned.
const RAIL_STRIDE = 48;

function ConsoleRail({
  activeSection,
  onSectionChange,
  attentionCount,
}: {
  activeSection: OwnerSection;
  onSectionChange: (s: OwnerSection) => void;
  attentionCount: number;
}) {
  const [hint, setHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);

  function showHint() {
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setHint(true);
    hintTimer.current = setTimeout(() => setHint(false), 2600);
  }

  const activeIndex = Math.max(0, NAV_ITEMS.findIndex((n) => n.id === activeSection));

  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-[224px] shrink-0 flex-col border-r border-[var(--oc-rule)] bg-[oklch(0.175_0.008_58)] lg:flex xl:w-[248px]">
      {/* Masthead. The vertical 東主 spine runs the height of the block —
          it says whose console this is without spending a headline on it. */}
      <div className="relative flex gap-4 border-b border-[var(--oc-rule)] px-6 pb-6 pt-7">
        {/* The spine runs the full height of the masthead with a hairline
            under it, so it reads as an edge the wordmark is set against
            rather than as two characters floating in the corner. */}
        <span
          aria-hidden
          className="vertical-cn flex shrink-0 flex-col items-center gap-2 text-[10px] text-[var(--color-gold-soft)]/45"
        >
          東主
          <span className="w-px flex-1 bg-[var(--oc-rule)]" />
        </span>
        <div className="min-w-0">
          <BrandMark className="h-7 w-7" />
          <p className="mt-3 font-display text-[23px] leading-[1.08] tracking-[-0.015em] text-[var(--color-cream)]">
            The <span className="text-[var(--color-vermillion)]">Third</span> Place
          </p>
          <p className="mt-1 text-[10.5px] uppercase tracking-[0.16em] text-[var(--color-gold-soft)]/60">
            Chinese BBQ &amp; Lounge
          </p>
        </div>
      </div>

      <nav className="relative flex-1 px-3 py-5" aria-label="Owner sections">
        {/* One light for the whole rail. It slides between rows so a section
            change reads as the light travelling, not two highlights blinking. */}
        <span
          aria-hidden
          className="oc-navlight pointer-events-none absolute left-3 right-3 top-5 h-11 rounded-lg border border-[var(--color-gold)]/25 bg-[var(--color-gold)]/[0.07] shadow-[inset_2px_0_0_var(--color-gold)]"
          style={{ "--oc-nav-y": `${activeIndex * RAIL_STRIDE}px` } as CSSProperties}
        />
        <ul className="relative space-y-1">
          {NAV_ITEMS.map(({ id, label, labelZh, icon: Icon }) => {
            const isActive = id === activeSection;
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => onSectionChange(id)}
                  className={cn(
                    "oc-press flex h-11 w-full items-center gap-3 rounded-lg px-3 text-[14px] transition-colors",
                    isActive
                      ? "text-[var(--color-cream)]"
                      : "text-[var(--color-gold-soft)]/60 hover:text-[var(--color-cream)]/85",
                  )}
                >
                  <Icon
                    className="h-[16px] w-[16px] shrink-0 transition-opacity"
                    strokeWidth={1.5}
                    style={{ opacity: isActive ? 0.9 : 0.55 }}
                  />
                  <span className="flex-1 text-left">{label}</span>
                  <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)]/70">
                    {labelZh}
                  </span>
                  {/* The one badge in the rail. It exists only while money is
                      genuinely outstanding, so it never becomes wallpaper. */}
                  {id === "overview" && attentionCount > 0 && (
                    <span className="oc-num shrink-0 rounded-full bg-[var(--color-vermillion)]/20 px-1.5 py-0.5 text-[10px] text-[var(--color-vermillion)]">
                      {attentionCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 border-t border-[var(--oc-rule)] pt-4">
          <button
            type="button"
            onClick={showHint}
            className="oc-press flex h-11 w-full cursor-default items-center gap-3 rounded-lg px-3 text-[14px] text-[var(--color-gold-soft)]/35 transition-colors hover:text-[var(--color-gold-soft)]/55"
          >
            <Settings className="h-[16px] w-[16px] shrink-0" strokeWidth={1.5} />
            <span className="flex-1 text-left">Settings</span>
            <span className="shrink-0 rounded-sm border border-[var(--color-gold)]/18 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-[var(--color-muted-foreground)]">
              Soon
            </span>
          </button>
        </div>
      </nav>

      <div className="border-t border-[var(--oc-rule)] px-6 py-4">
        <p className="text-[10.5px] leading-relaxed text-[var(--color-muted-foreground)]">
          {hint
            ? "Settings arrives in a later release."
            : "Overview, Orders, Menu, Payments and Reports are live."}
        </p>
      </div>
    </aside>
  );
}

/** Mobile navigation. The old dashboard had none below `lg` — the sidebar
 *  simply disappeared and the owner was stranded on whichever section they
 *  landed on. Rows are 48px so they clear the touch-target floor. */
function ConsoleTabs({
  activeSection,
  onSectionChange,
}: {
  activeSection: OwnerSection;
  onSectionChange: (s: OwnerSection) => void;
}) {
  return (
    <nav
      aria-label="Owner sections"
      className="oc-bar fixed inset-x-0 bottom-0 z-40 border-t border-[var(--oc-rule)] lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex max-w-[560px]">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = id === activeSection;
          return (
            <li key={id} className="flex-1">
              <button
                type="button"
                aria-current={isActive ? "page" : undefined}
                onClick={() => onSectionChange(id)}
                className="oc-press relative flex h-[60px] w-full flex-col items-center justify-center gap-1"
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-5 top-0 h-[2px] rounded-b-full bg-[var(--color-gold)] transition-opacity duration-200",
                    isActive ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon
                  className="h-[18px] w-[18px]"
                  strokeWidth={1.5}
                  style={{ opacity: isActive ? 0.95 : 0.5 }}
                />
                <span
                  className={cn(
                    "text-[10px] tracking-[0.06em]",
                    isActive
                      ? "text-[var(--color-cream)]"
                      : "text-[var(--color-gold-soft)]/55",
                  )}
                >
                  {label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Translucent command bar the deck scrolls under, with the ember bed as its
 *  lower edge instead of a divider rule. */
function CommandBar({
  now,
  live,
  heat,
  refreshing,
  onRefresh,
}: {
  now: Date;
  live: boolean;
  heat: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="oc-bar sticky top-0 z-30">
      <div className="mx-auto flex w-full max-w-[1560px] flex-wrap items-end justify-between gap-x-6 gap-y-4 px-5 pb-5 pt-5 lg:px-8 lg:pt-6">
        <div className="min-w-0">
          <h1 className="font-display text-[30px] leading-[1.04] tracking-[-0.02em] text-[var(--color-cream)] sm:text-[38px]">
            {greeting(now)}, <span className="text-[var(--color-gold)]">{OWNER_NAME}</span>.
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="flex items-center gap-3 text-[11px] uppercase tracking-[0.24em] text-[var(--color-gold-soft)]/75">
              <span aria-hidden className="h-px w-6 bg-[var(--color-gold)]/40" />
              Dinner Service
            </span>
            <span className="oc-num text-[11px] tracking-[0.06em] text-[var(--color-muted-foreground)]">
              {dateLabel(now)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <LiveSeal live={live} />
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label={`Refresh. Last updated ${hhmm(now)}`}
            className="oc-press group flex h-11 items-center gap-2 rounded-xl border border-[var(--oc-rule)] bg-[oklch(0.22_0.012_58)] px-4 text-[13px] text-[var(--color-gold-soft)]/90 transition-colors hover:border-[var(--oc-rule-lit)] hover:text-[var(--color-cream)] disabled:opacity-60"
          >
            <RefreshCw
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-500",
                refreshing ? "animate-spin" : "group-hover:rotate-180",
              )}
              strokeWidth={1.5}
            />
            <span className="oc-num hidden sm:inline">{hhmm(now)}</span>
          </button>
        </div>
      </div>

      <EmberBed heat={heat} />
      <div aria-hidden className="oc-bar-edge h-4 w-full" />
    </header>
  );
}

/** Shared page shell for every section below the command bar. */
function Deck({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1560px] px-5 pb-14 pt-5 lg:px-8">{children}</div>
  );
}

/** Section title band. The Chinese reading sits alongside the English at the
 *  same weight — this is a bilingual room, not an English one with captions. */
function ViewHead({
  title,
  titleZh,
  meta,
}: {
  title: string;
  titleZh: string;
  meta: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
      <h2 className="font-display text-[26px] leading-none tracking-[-0.015em] text-[var(--color-cream)]">
        {title}{" "}
        <span className="text-[var(--color-gold-soft)]/70">{titleZh}</span>
      </h2>
      <p className="text-[11.5px] uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
        {meta}
      </p>
      <span aria-hidden className="h-px w-full bg-[var(--oc-rule)]" />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Tiles
   ═══════════════════════════════════════════════════════════════════════ */

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

/** The console's unit of measurement. One figure, its accent spine, and the
 *  one line of context that makes the figure mean something.
 *
 *  Renders as a real <button> when it filters something, so the pressed state
 *  is announced rather than only drawn. A tile that does nothing stays a
 *  <div> — a button that isn't one is worse than no affordance at all. */
function StatTile({
  icon: Icon,
  label,
  labelZh,
  value,
  money = false,
  sub,
  tone,
  index = 0,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  labelZh: string;
  value: number | string;
  money?: boolean;
  sub: string;
  tone: Tone;
  index?: number;
  active?: boolean;
  onClick?: () => void;
}) {
  const t = useTilt();
  const accent = toneColor(tone);
  const interactive = Boolean(onClick);

  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "absolute bottom-5 left-0 top-5 w-[2px] rounded-r-full transition-opacity duration-300",
          active ? "opacity-100" : "opacity-55 group-hover:opacity-100",
        )}
        style={{ background: accent }}
      />
      {/* The English label owns the top line outright. Sharing it with the
          Chinese reading squeezed six-across tiles down to "Ne… 今日淨額" —
          the operational label is the one that must never truncate, so the
          second reading moves to the context line below. */}
      <div className="relative flex min-w-0 items-center gap-2 text-[11.5px] text-[var(--color-gold-soft)]/85">
        <Icon
          className="h-4 w-4 shrink-0"
          strokeWidth={1.5}
          style={{ color: accent, opacity: 0.85 }}
        />
        <span className="truncate">{label}</span>
      </div>
      <div
        className="relative mt-3.5 break-all text-[25px] leading-none sm:text-[28px]"
        style={{ color: tone === "muted" ? "var(--color-cream)" : accent }}
      >
        {typeof value === "number" ? (
          money ? <Money value={value} /> : <Count value={value} />
        ) : (
          <span className="oc-num">{value}</span>
        )}
      </div>
      {/* No "filtering" caption on the pressed state: the lit spine, the gold
          border and aria-pressed already say it, and the word cost the tile
          its second reading. */}
      <div className="relative mt-2.5 flex items-baseline justify-between gap-2 text-[11.5px] text-[var(--color-muted-foreground)]">
        <span className="min-w-0 truncate">{sub}</span>
        <span className="shrink-0 text-[11px] text-[var(--color-muted-foreground)]/80">
          {labelZh}
        </span>
      </div>
    </>
  );

  const shell = cn(
    "oc-slab oc-lift oc-spec oc-tilt group relative h-full w-full overflow-hidden rounded-2xl px-5 py-5 text-left",
    active && "border-[var(--color-gold)]/45",
  );

  return (
    <div className="oc-rise h-full" style={{ "--i": index } as CSSProperties}>
      {interactive ? (
        <button
          type="button"
          ref={t.ref as RefObject<HTMLButtonElement | null>}
          onPointerEnter={t.onPointerEnter}
          onPointerMove={t.onPointerMove}
          onPointerLeave={t.onPointerLeave}
          onClick={onClick}
          aria-pressed={active}
          className={cn(shell, "oc-press")}
        >
          {body}
        </button>
      ) : (
        <div
          ref={t.ref as RefObject<HTMLDivElement | null>}
          onPointerEnter={t.onPointerEnter}
          onPointerMove={t.onPointerMove}
          onPointerLeave={t.onPointerLeave}
          className={shell}
        >
          {body}
        </div>
      )}
    </div>
  );
}

/** Filter pill. Counts live inside the pill so choosing a filter is an
 *  informed choice rather than a guess followed by an empty table. */
function FilterPill({
  label,
  labelZh,
  count,
  active,
  danger,
  onClick,
}: {
  label: string;
  labelZh?: string;
  count: number;
  active: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  const accent = danger ? "var(--color-vermillion)" : "var(--color-gold)";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "oc-press flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12px] font-medium tracking-[0.04em] transition-colors",
        active
          ? "text-[var(--color-cream)]"
          : "border-[var(--oc-rule)] text-[var(--color-muted-foreground)] hover:border-[var(--oc-rule-lit)] hover:text-[var(--color-cream)]/80",
      )}
      style={
        active
          ? { borderColor: accent, backgroundColor: `color-mix(in oklab, ${accent} 14%, transparent)` }
          : undefined
      }
    >
      <span>
        {label}
        {labelZh && <span className="ml-1.5 text-[var(--color-muted-foreground)]">{labelZh}</span>}
      </span>
      <span
        className={cn(
          "oc-num rounded-full px-1.5 py-0.5 text-[10px]",
          active ? "bg-[var(--color-cream)]/12 text-[var(--color-cream)]" : "bg-[var(--color-gold)]/8",
        )}
      >
        {count}
      </span>
    </button>
  );
}

/** Table shell. Recessed below the working plane so a data surface reads as
 *  something the cards sit above, and horizontally scrollable inside its own
 *  bounds so a wide audit table never makes the page scroll sideways. */
function TableShell({ children, index = 0 }: { children: ReactNode; index?: number }) {
  return (
    <div className="oc-rise" style={{ "--i": index } as CSSProperties}>
      <div className="oc-slab oc-slab-recessed overflow-hidden rounded-2xl">
        <div className="overflow-x-auto">{children}</div>
      </div>
    </div>
  );
}

function Th({ children, right }: { children: ReactNode; right?: boolean }) {
  return (
    <th
      className={cn(
        "whitespace-nowrap px-4 py-3 text-[10.5px] font-medium uppercase tracking-[0.14em] text-[var(--color-muted-foreground)]",
        right ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

/** Empty state. Never a bare sentence in a void — it says what is missing
 *  and what would put something there. */
function EmptyNote({ zh, en, hint }: { zh: string; en: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-3 flex items-center gap-3">
        <span aria-hidden className="h-px w-8 bg-[var(--color-gold)]/30" />
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-gold)]/40" />
        <span aria-hidden className="h-px w-8 bg-[var(--color-gold)]/30" />
      </div>
      <p className="font-display text-[19px] text-[var(--color-gold-soft)]/85">{zh}</p>
      <p className="mt-1.5 text-[13px] text-[var(--color-muted-foreground)]">{en}</p>
      {hint && (
        <p className="mt-1 max-w-[380px] text-[12px] text-[var(--color-muted-foreground)]/60">
          {hint}
        </p>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Overview deck
   ═══════════════════════════════════════════════════════════════════════ */

function OverviewDeck({
  orders,
  now,
  summary,
  doneUnpaid,
  unpaidOpen,
  activeDeliveries,
  outForDeliveryNow,
  deliveredToday,
  cancelledToday,
  cancelledTodayValue,
  recentAll,
  expenses,
  expensesTotal,
  expLoadState,
  onRetryExpenses,
  onSelectOrder,
}: {
  orders: StaffOrder[];
  now: Date;
  summary: ReturnType<typeof summarizeToday>;
  doneUnpaid: StaffOrder[];
  unpaidOpen: StaffOrder[];
  activeDeliveries: StaffOrder[];
  outForDeliveryNow: StaffOrder[];
  deliveredToday: StaffOrder[];
  cancelledToday: StaffOrder[];
  cancelledTodayValue: number;
  recentAll: StaffOrder[];
  expenses: Expense[];
  expensesTotal: number;
  expLoadState: LoadState;
  onRetryExpenses: () => void;
  onSelectOrder: (o: StaffOrder) => void;
}) {
  const expLoading = expLoadState !== "ready";
  const net = summary.collected - expensesTotal;

  return (
    <Deck>
      <div className="mb-5 flex items-center gap-3">
        <Eyebrow className="shrink-0">Tonight&apos;s operations · 營運快照</Eyebrow>
        <span aria-hidden className="h-px flex-1 bg-[var(--oc-rule)]" />
      </div>

      {/* Band 1 — money in hand, and what is owed. */}
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 xl:col-span-7">
          <LedgerStone summary={summary} orders={orders} now={now} />
        </div>
        <div className="col-span-12 xl:col-span-5">
          <NeedsAttention
            doneUnpaid={doneUnpaid}
            unpaidOpen={unpaidOpen}
            activeDeliveries={activeDeliveries}
            onSelectOrder={onSelectOrder}
          />
        </div>
      </div>

      {/* Band 2 — the figures behind the headline. */}
      <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-3 2xl:grid-cols-6">
        <StatTile icon={Wallet} label="Cash" labelZh="現金" value={summary.cash} money sub="collected" tone="money" index={0} />
        <StatTile icon={ArrowLeftRight} label="Transfer" labelZh="轉帳" value={summary.transfer} money sub="collected" tone="money" index={1} />
        <StatTile
          icon={AlertTriangle}
          label="Unpaid"
          labelZh="未付"
          value={summary.unpaidTotal}
          money
          sub={`${summary.unpaidCount} ${summary.unpaidCount === 1 ? "order" : "orders"}`}
          tone={summary.unpaidTotal > 0 ? "warn" : "muted"}
          index={2}
        />
        {/* Same predicate as the Payments view's Risk filter (isPaymentRisk =
            completed AND unpaid), so it carries the same name. Two labels for
            one concept made the console look like it tracked two things. */}
        <StatTile
          icon={Receipt}
          label="At Risk"
          labelZh="風險"
          value={summary.doneUnpaidCount}
          sub="closed, not paid"
          tone={summary.doneUnpaidCount > 0 ? "alert" : "muted"}
          index={3}
        />
        <StatTile
          icon={TrendingDown}
          label="Expenses"
          labelZh="今日支出"
          value={expLoading ? "…" : expensesTotal}
          money
          sub="logged outflows"
          tone={expLoading ? "muted" : "cost"}
          index={4}
        />
        <StatTile
          icon={Scale}
          label="Net Today"
          labelZh="今日淨額"
          value={expLoading ? "…" : net}
          money
          sub="collected minus expenses"
          tone={expLoading ? "muted" : net < 0 ? "alert" : "money"}
          index={5}
        />
      </div>

      {/* Band 3 — where the money moved. */}
      <div className="mt-5 grid grid-cols-12 gap-5">
        <div className="col-span-12 xl:col-span-8">
          <RevenueTrend orders={orders} now={now} />
        </div>
        <div className="col-span-12 xl:col-span-4">
          <PaymentMix
            collected={summary.collected}
            cash={summary.cash}
            transfer={summary.transfer}
            unpaid={summary.unpaidTotal}
            unpaidCount={summary.unpaidCount}
          />
        </div>
      </div>

      {/* Band 4 — what the floor actually did. */}
      <div className="mt-5 grid grid-cols-12 gap-5">
        <div className="col-span-12 xl:col-span-8">
          <RecentOrders recent={recentAll} onSelectOrder={onSelectOrder} />
        </div>
        <div className="col-span-12 space-y-5 xl:col-span-4">
          <DeliveryWatch
            activeCount={activeDeliveries.length}
            outNowCount={outForDeliveryNow.length}
            deliveredCount={deliveredToday.length}
          />
          {cancelledToday.length > 0 && (
            <CancelledToday
              orders={cancelledToday}
              totalValue={cancelledTodayValue}
              onSelectOrder={onSelectOrder}
            />
          )}
          <ExpenseSummary
            expenses={expenses}
            loadState={expLoadState}
            onRetry={onRetryExpenses}
          />
        </div>
      </div>
    </Deck>
  );
}

/* ---------- The Ledger Stone ---------- */

/** Tonight's realized revenue, per hour, from the open of service.
 *  Same source and same rules as the trend chart — paid, non-cancelled. */
function hourlyPaidSeries(orders: readonly StaffOrder[], now: Date): number[] {
  const map = paidRevenueByHour(orders, now);
  const OPEN_HOUR = 10;
  const end = Math.max(now.getHours(), OPEN_HOUR + 1);
  const out: number[] = [];
  for (let h = OPEN_HOUR; h <= end; h++) out.push(map[h] ?? 0);
  return out;
}

/** The signature slab. Every other card on the deck is quiet so this one can
 *  carry the whole page: the night's takings, split by how they arrived, with
 *  the shape of the night etched into the lower edge.
 *
 *  It is the only element that both tilts and holds a live curve, which is
 *  what makes it read as the thing the console is built around. */
function LedgerStone({
  summary,
  orders,
  now,
}: {
  summary: ReturnType<typeof summarizeToday>;
  orders: readonly StaffOrder[];
  now: Date;
}) {
  const series = useMemo(() => hourlyPaidSeries(orders, now), [orders, now]);
  const hasCurve = series.some((v) => v > 0);
  const cashPct = summary.collected > 0 ? (summary.cash / summary.collected) * 100 : 0;

  return (
    // flex column so the etched curve can sit on the bottom edge however tall
    // the slab is stretched by its neighbour. Left to flow, it stranded the
    // curve mid-card with dead space beneath it.
    <Slab tilt index={0} className="flex flex-col overflow-hidden">
      {/* Ember wash in the top-right corner — the light source, made visible
          once, on the one card that earns it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full"
        style={{
          background: "radial-gradient(circle, oklch(0.55 0.19 27 / 0.13) 0%, transparent 62%)",
        }}
      />

      <div className="relative px-6 pb-6 pt-6 sm:px-8 sm:pt-8">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Eyebrow>Collected Tonight · 今晚收款</Eyebrow>
            <p className="mt-1.5 text-[12px] text-[var(--color-muted-foreground)]">
              Paid cash and paid transfer only
            </p>
          </div>
          <span className="oc-num shrink-0 rounded-full border border-[var(--oc-rule)] px-3 py-1 text-[11.5px] text-[var(--color-gold-soft)]/85">
            {summary.orderCount} {summary.orderCount === 1 ? "order" : "orders"}
          </span>
        </div>

        <div className="mt-6 break-all text-[44px] leading-none text-[var(--color-gold)] sm:text-[58px] lg:text-[68px]">
          <Money value={summary.collected} />
        </div>

        {/* How the money arrived, as a single measured bar rather than two
            competing numbers. Cash reads gold, transfer reads soft gold —
            same family, because they are the same thing: money in hand. */}
        <div className="mt-7">
          <div
            className="flex h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-charcoal)]"
            role="img"
            aria-label={`Cash ${baht(summary.cash)}, transfer ${baht(summary.transfer)}`}
          >
            <span
              className="h-full bg-[var(--color-gold)] transition-[width] duration-700 ease-[cubic-bezier(0.23,1,0.32,1)]"
              style={{ width: `${cashPct}%` }}
            />
            <span
              className="h-full flex-1 bg-[var(--color-gold-soft)]/55 transition-all duration-700"
              style={{ opacity: summary.collected > 0 ? 1 : 0 }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[12.5px]">
            <span className="flex items-center gap-2 text-[var(--color-cream)]/85">
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-[var(--color-gold)]" />
              Cash 現金
              <span className="oc-num text-[var(--color-gold)]">{baht(summary.cash)}</span>
            </span>
            <span className="flex items-center gap-2 text-[var(--color-cream)]/85">
              <span aria-hidden className="h-2 w-2 rounded-[2px] bg-[var(--color-gold-soft)]/70" />
              Transfer 轉帳
              <span className="oc-num text-[var(--color-gold-soft)]">{baht(summary.transfer)}</span>
            </span>
          </div>
        </div>
      </div>

      {/* The night, etched into the lower edge. Empty until there is something
          real to draw — a decorative curve here would be a lie about takings. */}
      <div className="relative mt-auto h-20 w-full min-h-20 pt-6 sm:h-28">
        {hasCurve ? (
          <Sparkline points={series} />
        ) : (
          <div className="flex h-full items-end justify-center pb-4">
            <p className="text-[11.5px] text-[var(--color-muted-foreground)]/70">
              The night&apos;s curve appears with the first paid order.
            </p>
          </div>
        )}
      </div>
    </Slab>
  );
}

/* ---------- Needs Attention ---------- */

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
    // The rim breathes only while money is genuinely outstanding. At zero the
    // card is completely still, so "nothing waiting" is legible across a room.
    <Slab index={1} alert={openCount > 0} className="flex flex-col overflow-hidden">
      <PanelHead
        eyebrow="Control Room · 需注意"
        title="Needs Attention"
        meta={
          <span
            className={cn(
              "oc-num rounded-full border px-2.5 py-1 text-[11px]",
              openCount > 0
                ? "border-[var(--color-vermillion)]/45 bg-[var(--color-vermillion)]/15 text-[var(--color-vermillion)]"
                : "border-[var(--oc-rule)] text-[var(--color-muted-foreground)]",
            )}
          >
            {openCount} open
          </span>
        }
      />

      {hasContent ? (
        <div className="min-h-0 flex-1 divide-y divide-[var(--oc-rule)] overflow-y-auto">
          <AttnGroup
            title="Done / Delivered — unpaid"
            titleZh="已完成未付"
            tone="var(--color-vermillion)"
            orders={doneUnpaid}
            onSelectOrder={onSelectOrder}
          />
          <AttnGroup
            title="Unpaid — still open"
            titleZh="未付進行中"
            tone="var(--color-gold-soft)"
            orders={unpaidOpen}
            onSelectOrder={onSelectOrder}
          />
          <AttnGroup
            title="Active deliveries"
            titleZh="配送"
            tone="oklch(0.72 0.13 230)"
            orders={activeDeliveries}
            delivery
            onSelectOrder={onSelectOrder}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyNote zh="全部清楚" en="Nothing waiting — every order is settled." />
        </div>
      )}
    </Slab>
  );
}

function AttnGroup({
  title,
  titleZh,
  tone,
  orders,
  delivery,
  onSelectOrder,
}: {
  title: string;
  titleZh: string;
  tone: string;
  orders: StaffOrder[];
  delivery?: boolean;
  onSelectOrder: (o: StaffOrder) => void;
}) {
  if (orders.length === 0) return null;
  return (
    <div className="px-5 py-4 sm:px-6">
      <div className="mb-2.5 flex items-center gap-2.5">
        {delivery ? (
          <Bike className="h-3.5 w-3.5 shrink-0 text-sky-400/80" strokeWidth={1.5} />
        ) : (
          <span aria-hidden className="h-4 w-[3px] shrink-0 rounded-full" style={{ background: tone }} />
        )}
        <span className="min-w-0 truncate text-[12.5px] text-[var(--color-cream)]">
          {title} <span className="text-[var(--color-muted-foreground)]">{titleZh}</span>
        </span>
        <span className="oc-num ml-auto shrink-0 text-[11px] text-[var(--color-muted-foreground)]">
          {orders.length}
        </span>
      </div>
      <ul className="space-y-0.5">
        {orders.map((o) => (
          <li key={o.orderId}>
            <button
              type="button"
              onClick={() => onSelectOrder(o)}
              className="oc-press -mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--color-gold)]/[0.07]"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-[var(--color-cream)]/95">
                  {delivery ? (o.customerName ?? o.customerPhone ?? "Delivery") : locText(o)}
                </span>
                <span className="oc-num block truncate text-[11px] text-[var(--color-muted-foreground)]">
                  {o.orderId} · {delivery ? `${STATUS_META[o.status].labelEn} · ` : ""}{o.time}
                </span>
              </span>
              <span className="oc-num shrink-0 whitespace-nowrap text-[14px] text-[var(--color-gold)]">
                {baht(o.totalPrice)}
              </span>
            </button>
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
    <Slab index={2} className="overflow-hidden">
      <PanelHead eyebrow="Delivery Watch · 配送" icon={Bike} />
      <div className="grid grid-cols-3 divide-x divide-[var(--oc-rule)]">
        <DeliveryStat label="Active" labelZh="進行中" value={activeCount} />
        <DeliveryStat label="Out Now" labelZh="配送中" value={outNowCount} sky />
        <DeliveryStat label="Delivered" labelZh="已送達" value={deliveredCount} />
      </div>
    </Slab>
  );
}

function DeliveryStat({
  label,
  labelZh,
  value,
  sky,
}: {
  label: string;
  labelZh: string;
  value: number;
  sky?: boolean;
}) {
  const dim = value === 0;
  return (
    <div className="py-5 text-center">
      <div
        className={cn(
          "text-[27px] leading-none",
          dim
            ? "text-[var(--color-muted-foreground)]/70"
            : sky
            ? "text-sky-400"
            : "text-[var(--color-cream)]",
        )}
      >
        <Count value={value} />
      </div>
      <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted-foreground)]">
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
    <Slab index={3} className="overflow-hidden">
      <PanelHead
        eyebrow="Cancelled Today · 今日取消"
        icon={XCircle}
        meta={
          <>
            <span className="oc-num block text-[16px] leading-none text-[var(--color-muted-foreground)]">
              {baht(totalValue)}
            </span>
            <span className="mt-1 block text-[10.5px] text-[var(--color-muted-foreground)]/60">
              {orders.length} {orders.length === 1 ? "order" : "orders"}
            </span>
          </>
        }
      />
      <ul className="divide-y divide-[var(--oc-rule)]">
        {orders.slice(0, 5).map((o) => (
          <li key={o.orderId}>
            <button
              type="button"
              onClick={() => onSelectOrder(o)}
              className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--color-gold)]/[0.05] sm:px-6"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2 text-[12px]">
                  <span className="oc-num text-[var(--color-muted-foreground)]">{o.orderId}</span>
                  <span className="truncate text-[var(--color-muted-foreground)]/55">
                    {locText(o)} · {o.time}
                  </span>
                </span>
                {o.cancellationReason && (
                  <span className="mt-0.5 block truncate text-[11.5px] italic text-[var(--color-muted-foreground)]/70">
                    {o.cancellationReason}
                  </span>
                )}
              </span>
              <span className="oc-num shrink-0 text-[13px] text-[var(--color-muted-foreground)] line-through">
                {baht(o.totalPrice)}
              </span>
            </button>
          </li>
        ))}
        {orders.length > 5 && (
          <li className="px-5 py-2.5 text-[11px] text-[var(--color-muted-foreground)] sm:px-6">
            {orders.length - 5} more in Orders
          </li>
        )}
      </ul>
    </Slab>
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
    <Slab index={2} className="overflow-hidden">
      <PanelHead
        eyebrow="Floor Activity · 最近訂單"
        title="Recent Orders"
        meta={
          <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--color-muted-foreground)]">
            newest first
          </span>
        }
      />

      {recent.length === 0 ? (
        <EmptyNote zh="目前沒有訂單" en="No orders yet tonight." />
      ) : (
        <>
          {/* Phone: the table's six columns don't survive a 390px screen, so
              each order becomes a row you can actually read and tap. */}
          <ul className="divide-y divide-[var(--oc-rule)] sm:hidden">
            {recent.map((o) => {
              const meta = STATUS_META[o.status];
              const cancelled = o.status === "cancelled";
              return (
                <li key={o.orderId}>
                  <button
                    type="button"
                    onClick={() => onSelectOrder(o)}
                    className="flex w-full items-start gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[var(--color-gold)]/[0.05]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-[var(--color-cream)]">
                        {locText(o)}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 block truncate text-[12px]",
                          cancelled
                            ? "text-[var(--color-muted-foreground)] line-through"
                            : "text-[var(--color-cream)]/70",
                        )}
                      >
                        {itemsSummary(o)}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--color-muted-foreground)]">
                        <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", meta.dotClass)} />
                        {meta.labelEn}
                        <span className="oc-num">· {o.time}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span
                        className={cn(
                          "oc-num block text-[15px]",
                          cancelled ? "text-[var(--color-muted-foreground)]" : "text-[var(--color-gold)]",
                        )}
                      >
                        {baht(o.totalPrice)}
                      </span>
                      {o.paymentStatus === "unpaid" && !cancelled && (
                        <span className="mt-0.5 block text-[10.5px] text-[var(--color-vermillion-text)]">
                          Unpaid
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[600px] text-[13px]">
              <thead>
                <tr className="border-b border-[var(--oc-rule)]">
                  <Th>Table · Order</Th>
                  <Th>Items</Th>
                  <Th>Payment</Th>
                  <Th right>Total</Th>
                  <Th right>Status · Time</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--oc-rule)]">
                {recent.map((o) => {
                  const meta = STATUS_META[o.status];
                  const cancelled = o.status === "cancelled";
                  const paid = o.paymentStatus === "paid";
                  return (
                    <tr
                      key={o.orderId}
                      tabIndex={0}
                      onClick={() => onSelectOrder(o)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onSelectOrder(o);
                        }
                      }}
                      className="oc-row cursor-pointer hover:bg-[var(--color-gold)]/[0.05]"
                    >
                      <td className="px-4 py-3.5">
                        <div className="text-[var(--color-cream)]">{locText(o)}</div>
                        <div className="oc-num mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
                          {o.orderId}
                        </div>
                      </td>
                      <td
                        className={cn(
                          "max-w-[220px] px-4 py-3.5",
                          cancelled
                            ? "text-[var(--color-muted-foreground)] line-through"
                            : "text-[var(--color-cream)]/85",
                        )}
                      >
                        <p className="truncate">{itemsSummary(o)}</p>
                      </td>
                      <td className="px-4 py-3.5 text-[12px] text-[var(--color-muted-foreground)]">
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
                                ? "text-[var(--color-vermillion-text)]"
                                : "text-[var(--color-muted-foreground)]/60"
                            }
                          >
                            {o.paymentStatus === "unpaid" ? "Unpaid" : "—"}
                          </span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "oc-num px-4 py-3.5 text-right text-[15px]",
                          cancelled ? "text-[var(--color-muted-foreground)]" : "text-[var(--color-gold)]",
                        )}
                      >
                        {baht(o.totalPrice)}
                      </td>
                      <td className="px-4 py-3.5 text-right">
                        {/* nowrap: "Out for Delivery" otherwise wraps and
                            strands its status dot on a line of its own. */}
                        <span className="inline-flex items-center justify-end gap-2 whitespace-nowrap text-[12px] text-[var(--color-cream)]/90">
                          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", meta.dotClass)} />
                          {meta.labelEn}
                        </span>
                        <div className="oc-num mt-0.5 text-[11px] text-[var(--color-muted-foreground)]">
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
        </>
      )}
    </Slab>
  );
}

/* ---------- Payment Mix — segmented ring ---------- */
// The ring represents COLLECTED money only, so it always fills to 100% and the
// centre value equals the ring total. Unpaid is shown as a separate ember row
// below — it is never folded into collected. Empty state draws only the faint
// track (no fake slice). All values are real.
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
  const [hovered, setHovered] = useState<string | null>(null);
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
    <Slab index={3} className="overflow-hidden">
      <PanelHead eyebrow="Collection Breakdown · 收款組成" title="Payment Mix" />

      <div className="flex flex-col items-center gap-7 px-5 py-6 sm:px-6">
        <div
          className="relative h-[176px] w-[176px] shrink-0"
          role="img"
          aria-label={`Collected ${baht(collected)} — Cash ${baht(cash)}, Transfer ${baht(
            transfer,
          )}. Unpaid ${baht(unpaid)} not counted as collected.`}
        >
          <svg viewBox="0 0 144 144" className="h-full w-full">
            <circle cx="72" cy="72" r={RING_R} fill="none" stroke="var(--color-charcoal)" strokeWidth="14" />
            <g transform="rotate(-90 72 72)">
              {arcs.map((a, i) => (
                <circle
                  key={a.key}
                  cx="72"
                  cy="72"
                  r={RING_R}
                  fill="none"
                  stroke={a.stroke}
                  // The hovered arc thickens rather than changing colour:
                  // the identity of a segment must not move when you point
                  // at it, only its emphasis.
                  strokeWidth={hovered === a.key ? 18 : 14}
                  strokeLinecap="butt"
                  style={{
                    strokeDasharray: drawn ? `${a.len} ${RING_C - a.len}` : `0 ${RING_C}`,
                    strokeDashoffset: a.offset,
                    transition: `stroke-dasharray 900ms var(--ease-fluid) ${i * 150}ms, stroke-width 200ms var(--ease-fluid)`,
                  }}
                />
              ))}
            </g>
          </svg>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-gold-soft)]/80">
              Collected
            </span>
            <span
              className={cn(
                "mt-1.5 text-[24px] leading-none",
                collected > 0 ? "text-[var(--color-gold)]" : "text-[var(--color-gold)]/60",
              )}
            >
              <Money value={collected} />
            </span>
            <span className="mt-1.5 text-[10.5px] text-[var(--color-muted-foreground)]">tonight</span>
          </div>
        </div>

        <div className="w-full min-w-0">
          {collected > 0 ? (
            <div className="space-y-1">
              <MixRow
                dot="bg-[var(--color-gold)]"
                label="Cash 現金"
                value={baht(cash)}
                pct={pct(cash)}
                onHover={(on) => setHovered(on ? "cash" : null)}
              />
              <MixRow
                dot="bg-[var(--color-gold-soft)]"
                label="Transfer 轉帳"
                value={baht(transfer)}
                pct={pct(transfer)}
                onHover={(on) => setHovered(on ? "transfer" : null)}
              />
            </div>
          ) : (
            <p className="text-[13px] text-[var(--color-muted-foreground)]">
              沒有收款 · Nothing collected yet tonight.
            </p>
          )}

          {/* Unpaid sits below a rule, never inside the ring. Collected means
              money that exists. */}
          <div className="mt-5 flex items-start justify-between gap-3 border-t border-[var(--oc-rule)] pt-4">
            <span className="flex items-start gap-2.5 text-[13px]">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-vermillion-text)]"
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
            <span className="oc-num shrink-0 text-[16px] text-[var(--color-vermillion-text)]">
              {baht(unpaid)}
            </span>
          </div>
        </div>
      </div>
    </Slab>
  );
}

function MixRow({
  dot,
  label,
  value,
  pct,
  onHover,
}: {
  dot: string;
  label: string;
  value: string;
  pct: number;
  onHover: (on: boolean) => void;
}) {
  return (
    <div
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      className="-mx-2 flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-[13px] transition-colors hover:bg-[var(--color-gold)]/[0.06]"
    >
      <span className="flex min-w-0 items-center gap-2.5 text-[var(--color-cream)]/90">
        <span aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-[2px]", dot)} />
        <span className="truncate">{label}</span>
      </span>
      <span className="flex shrink-0 items-baseline gap-3">
        <span className="oc-num text-[15px] text-[var(--color-gold)]">{value}</span>
        <span className="oc-num w-9 text-right text-[11px] text-[var(--color-muted-foreground)]">
          {pct}%
        </span>
      </span>
    </div>
  );
}

/* ---------- Revenue Trend ---------- */
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
  // Recharts stacks an Area and a Line on the same key; show the series once.
  const seen = new Set<string>();
  return (
    <div
      className="rounded-xl border border-[var(--oc-rule-lit)] px-3.5 py-3 text-[12px] shadow-[0_18px_40px_-24px_oklch(0.09_0.02_45)]"
      style={{ background: "oklch(0.20 0.014 60 / 0.97)" }}
    >
      <div className="oc-num mb-2 text-[10.5px] uppercase tracking-[0.16em] text-[var(--color-gold-soft)]/80">
        {label}
      </div>
      {payload.map((entry) => {
        const name = String(entry.name);
        if (seen.has(name)) return null;
        seen.add(name);
        const isToday = name === "today";
        return (
          <div key={name} className="flex items-center justify-between gap-6 py-0.5">
            <span className="flex items-center gap-2 text-[var(--color-cream)]/80">
              <span
                aria-hidden
                className="h-[2px] w-4 rounded-full"
                style={{
                  background: isToday ? "var(--color-gold)" : "var(--color-muted-foreground)",
                  opacity: isToday ? 1 : 0.7,
                }}
              />
              {isToday ? "Today" : "Yesterday"}
            </span>
            <span
              className="oc-num font-medium"
              style={{
                color: isToday ? "var(--color-gold)" : "var(--color-muted-foreground)",
              }}
            >
              {baht(entry.value ?? 0)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function RevenueTrend({ orders, now }: { orders: readonly StaffOrder[]; now: Date }) {
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

  // One direct label instead of a number on every point: the hour that
  // actually earned the most is the only point worth naming.
  const peak = useMemo(() => {
    let hour = -1;
    let value = 0;
    for (const [h, v] of Object.entries(todayMap)) {
      if (v > value) {
        value = v;
        hour = Number(h);
      }
    }
    return hour >= 0 ? { hour, value } : null;
  }, [todayMap]);

  return (
    // The chart grows into whatever height the Payment Mix beside it sets,
    // rather than leaving a band of empty slab under a fixed 190px plot.
    <Slab index={1} className="flex flex-col overflow-hidden">
      <PanelHead
        eyebrow="Sales Movement · 收款趨勢"
        title="Revenue Trend"
        meta={
          <div className="flex flex-col items-end gap-1.5 text-[11px] text-[var(--color-muted-foreground)]">
            <span className="flex items-center gap-2">
              <span aria-hidden className="h-[2px] w-5 rounded-full bg-[var(--color-gold)]" />
              Today
            </span>
            {hasYestData && (
              <span className="flex items-center gap-2 opacity-70">
                <span
                  aria-hidden
                  className="h-0 w-5 border-t-2 border-dashed border-[var(--color-muted-foreground)]"
                />
                Yesterday
              </span>
            )}
          </div>
        }
      />

      <div className="flex flex-1 flex-col px-3 pb-5 pt-5 sm:px-5">
        <p className="mb-4 px-2 text-[12px] text-[var(--color-muted-foreground)]">
          Paid cash and transfer only.
          {peak && (
            <>
              {" "}Busiest hour{" "}
              <span className="oc-num text-[var(--color-gold-soft)]">
                {String(peak.hour).padStart(2, "0")}:00
              </span>{" "}
              at <span className="oc-num text-[var(--color-gold)]">{baht(peak.value)}</span>.
            </>
          )}
        </p>

        {!hasTodayData ? (
          <div className="relative min-h-[190px] flex-1 overflow-hidden rounded-xl">
            {/* Ghost grid — conveys chart structure without inventing data. */}
            <svg
              viewBox="0 0 400 100"
              className="absolute inset-0 h-full w-full"
              preserveAspectRatio="none"
              aria-hidden
            >
              {[20, 45, 70].map((y) => (
                <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="oklch(0.72 0.11 75 / 0.09)" strokeWidth="1" />
              ))}
              <line x1="0" y1="93" x2="400" y2="93" stroke="oklch(0.72 0.11 75 / 0.2)" strokeWidth="1" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5">
              <p className="text-[13px] text-[var(--color-muted-foreground)]">No paid sales yet today.</p>
              <p className="text-[11.5px] text-[var(--color-muted-foreground)]/60">
                Paid sales appear here by the hour.
              </p>
            </div>
          </div>
        ) : (
          <div className="min-h-[190px] flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="oc-trend-fill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-gold)" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="var(--color-gold)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="oklch(0.72 0.11 75 / 0.08)" />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    v === 0 ? "฿0" : `฿${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`
                  }
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                />
                <Tooltip
                  content={<RevenueTrendTooltip />}
                  cursor={{ stroke: "oklch(0.72 0.11 75 / 0.28)", strokeWidth: 1 }}
                />
                {/* Yesterday is a dashed neutral, not a second gold. Two tints
                    of one hue are indistinguishable to a colourblind reader;
                    the dash pattern carries the difference on its own. */}
                {hasYestData && (
                  <Line
                    type="monotone"
                    dataKey="yesterday"
                    name="yesterday"
                    stroke="var(--color-muted-foreground)"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    strokeOpacity={0.7}
                    dot={false}
                    activeDot={{ r: 3, fill: "var(--color-muted-foreground)", strokeWidth: 0 }}
                    animationDuration={900}
                    animationBegin={150}
                    animationEasing="ease-out"
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="today"
                  name="today"
                  stroke="none"
                  fill="url(#oc-trend-fill)"
                  animationDuration={1000}
                  animationEasing="ease-out"
                />
                <Line
                  type="monotone"
                  dataKey="today"
                  name="today"
                  stroke="var(--color-gold)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "var(--color-gold)", strokeWidth: 0 }}
                  animationDuration={1000}
                  animationEasing="ease-out"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {!hasYestData && hasTodayData && (
          <p className="mt-2 px-2 text-[11px] text-[var(--color-muted-foreground)]/70">
            Yesterday data not available — showing today only.
          </p>
        )}
      </div>
    </Slab>
  );
}

/* ---------- Expenses Today ---------- */
// Today's purchase log from the same expense feed the staff form writes to.
// Amounts render in vermillion (cost out) to contrast with gold revenue.
// Gross sales figures are never touched here.

const EXPENSE_CATEGORY_COLOR: Record<string, string> = {
  Drinks:        "bg-sky-500/15 text-sky-300",
  Ingredient:    "bg-emerald-500/15 text-emerald-300",
  "Stock Refill":"bg-amber-500/15 text-amber-300",
  Utility:       "bg-violet-500/15 text-violet-300",
  Delivery:      "bg-orange-500/15 text-orange-300",
  Other:         "bg-stone-500/15 text-stone-300",
};

const PAID_FROM_ROWS: { key: string; label: string; zh: string }[] = [
  { key: "Cash",       label: "Cash",       zh: "現金"  },
  { key: "Transfer",   label: "Transfer",   zh: "轉帳"  },
  { key: "Owner Paid", label: "Owner Paid", zh: "老闆付" },
  { key: "Other",      label: "Other",      zh: "其他"  },
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
    <Slab index={4} className="overflow-hidden">
      <PanelHead
        eyebrow="Purchase Log · 支出記錄"
        title="Expenses Today"
        meta={
          loadState === "ready" && expenses.length > 0 ? (
            <span className="oc-num text-[19px] text-[var(--color-vermillion-text)]">
              {baht(total)}
            </span>
          ) : undefined
        }
      />

      {/* Skeleton, not a spinner: the shape of what is coming reads as loading
          without hiding the layout the owner is about to get. */}
      {loadState === "loading" && (
        <ul className="divide-y divide-[var(--oc-rule)]">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-4 sm:px-6">
              <span className="h-3 flex-1 animate-pulse rounded bg-[var(--color-cream)]/8" style={{ animationDelay: `${i * 140}ms` }} />
              <span className="h-3 w-14 animate-pulse rounded bg-[var(--color-cream)]/8" style={{ animationDelay: `${i * 140 + 70}ms` }} />
            </li>
          ))}
        </ul>
      )}

      {loadState === "error" && (
        <div className="px-6 py-8 text-center">
          <p className="text-[13px] text-[var(--color-muted-foreground)]">Could not load expenses.</p>
          <button
            type="button"
            onClick={onRetry}
            className="oc-press mt-3 rounded-lg border border-[var(--oc-rule)] px-3.5 py-2 text-[12px] text-[var(--color-gold-soft)]/85 transition hover:border-[var(--oc-rule-lit)] hover:text-[var(--color-cream)]"
          >
            Try again
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
          <div className="space-y-2.5 border-b border-[var(--oc-rule)] px-5 py-4 sm:px-6">
            {PAID_FROM_ROWS.map(({ key, label, zh }) => {
              const amount = byPaidFrom[key] ?? 0;
              if (amount === 0) return null;
              return (
                <div key={key} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="min-w-0 text-[var(--color-cream)]/80">
                    {label} <span className="text-[11px] text-[var(--color-muted-foreground)]">{zh}</span>
                  </span>
                  <span className="oc-num shrink-0 text-[var(--color-vermillion-text)]">
                    {baht(amount)}
                  </span>
                </div>
              );
            })}
          </div>

          <ul className="divide-y divide-[var(--oc-rule)]">
            {recent.map((exp) => (
              <li
                key={exp.id}
                className="flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-[var(--color-gold)]/[0.04] sm:px-6"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] text-[var(--color-cream)]/95">{exp.itemName}</div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
                        EXPENSE_CATEGORY_COLOR[exp.category] ?? "bg-stone-500/15 text-stone-300",
                      )}
                    >
                      {exp.category}
                    </span>
                    <span className="text-[11px] text-[var(--color-muted-foreground)]">{exp.paidFrom}</span>
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
                  <div className="oc-num text-[15px] text-[var(--color-vermillion-text)]">
                    {baht(exp.amount)}
                  </div>
                  <div className="oc-num mt-0.5 text-[10.5px] text-[var(--color-muted-foreground)]">
                    {fmtExpTime(exp.createdAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Slab>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Orders view
   ═══════════════════════════════════════════════════════════════════════ */

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
      return orders.filter((o) => isActiveStatus(o.status));
    case "delivery":
      return orders.filter((o) => o.orderType === "delivery");
    case "unpaid":
      return orders.filter((o) => o.paymentStatus === "unpaid" && o.status !== "cancelled");
    case "cancelled":
      return orders.filter((o) => o.status === "cancelled");
    case "completed":
      return orders.filter((o) => isCompletedStatus(o.status));
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
    <Deck>
      <ViewHead
        title="Orders"
        titleZh="今日訂單"
        meta={`${longDate(now)} · ${orders.length} total · audit trail`}
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {ORDER_FILTERS.map(({ id, label, labelZh }) => (
          <FilterPill
            key={id}
            label={label}
            labelZh={labelZh}
            count={applyOrderFilter(orders, id).length}
            active={filter === id}
            onClick={() => setFilter(id)}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <TableShell>
          <EmptyNote
            zh="沒有符合的訂單"
            en="No orders match this filter."
            hint="Pick a different filter above."
          />
        </TableShell>
      ) : (
        <TableShell>
          <table className="w-full min-w-[840px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--oc-rule)]">
                <Th>Order · Location</Th>
                <Th>Items</Th>
                <Th>Payment</Th>
                <Th right>Total</Th>
                <Th>Status</Th>
                <Th right>Time</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--oc-rule)]">
              {visible.map((order) => (
                <OwnerOrderRow key={order.orderId} order={order} onSelect={() => onSelectOrder(order)} />
              ))}
            </tbody>
          </table>
        </TableShell>
      )}
    </Deck>
  );
}

// Dark-background status badges for the console tables. STATUS_META.badgeClass
// is tuned for the parchment staff cards and uses text-[var(--color-ink)] for
// done/delivered/cancelled, which is near-invisible on charcoal.
const OWNER_STATUS_BADGE: Record<
  StaffOrderStatus,
  { bg: string; text: string; border: string; dot: string }
> = {
  new:              { bg: "bg-[var(--color-vermillion)]/12", text: "text-[var(--color-vermillion-text)]", border: "border-[var(--color-vermillion)]/28", dot: "bg-[var(--color-vermillion)]"   },
  preparing:        { bg: "bg-amber-500/12",                 text: "text-amber-300",                      border: "border-amber-400/28",                  dot: "bg-amber-400"                  },
  ready:            { bg: "bg-emerald-500/12",               text: "text-emerald-300",                    border: "border-emerald-400/28",                dot: "bg-emerald-400"               },
  out_for_delivery: { bg: "bg-sky-500/12",                   text: "text-sky-300",                        border: "border-sky-400/28",                    dot: "bg-sky-400"                    },
  delivered:        { bg: "bg-emerald-500/8",                text: "text-emerald-300/80",                 border: "border-emerald-400/20",                dot: "bg-emerald-400/70"            },
  done:             { bg: "bg-[var(--color-cream)]/6",       text: "text-[var(--color-cream)]/55",        border: "border-[var(--color-cream)]/12",       dot: "bg-[var(--color-cream)]/45"   },
  cancelled:        { bg: "bg-[var(--color-vermillion)]/8",  text: "text-[var(--color-vermillion-text)]/70", border: "border-[var(--color-vermillion)]/18", dot: "bg-[var(--color-vermillion)]/55" },
};

function StatusBadge({ status }: { status: StaffOrderStatus }) {
  const meta = STATUS_META[status];
  const dark = OWNER_STATUS_BADGE[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium tracking-[0.04em]",
        dark.bg,
        dark.text,
        dark.border,
      )}
    >
      <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dark.dot)} />
      {meta.labelEn} · {meta.labelZh}
    </span>
  );
}

/** Rows are focusable and respond to Enter/Space — the console has to be
 *  operable without a mouse, and a click-only row simply isn't.
 *  No role override: a `role="button"` on a <tr> would strip the row out of
 *  the table for screen readers, which costs more than it buys. */
function rowActivation(onSelect: () => void) {
  return {
    tabIndex: 0,
    onClick: onSelect,
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
  };
}

function OwnerOrderRow({ order, onSelect }: { order: StaffOrder; onSelect: () => void }) {
  const payMeta = PAYMENT_META[order.paymentStatus];
  const loc = orderLocation(order);
  const cancelled = order.status === "cancelled";
  const totalQty = order.items.reduce((s, i) => s + i.quantity, 0);
  const itemSummary =
    order.items.length === 1
      ? `${order.items[0].quantity}× ${order.items[0].name}`
      : `${totalQty} items (${order.items.length} lines)`;

  return (
    <tr
      {...rowActivation(onSelect)}
      className={cn(
        "oc-row cursor-pointer hover:bg-[var(--color-gold)]/[0.05]",
        cancelled && "opacity-60",
      )}
    >
      <td className="px-4 py-3.5">
        <p className="oc-num text-[11px] uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
          {order.orderId}
        </p>
        <p className="mt-0.5 font-medium text-[var(--color-cream)]/90">
          {loc.big}
          {loc.num !== undefined && <span className="oc-num ml-1.5 text-[var(--color-gold)]">{loc.num}</span>}
          <span className="ml-2 text-[11px] text-[var(--color-muted-foreground)]">{loc.zh}</span>
        </p>
        {order.orderType === "delivery" && order.customerName && (
          <p className="mt-0.5 max-w-[180px] truncate text-[11px] text-[var(--color-muted-foreground)]">
            {order.customerName}
            {order.customerPhone && ` · ${order.customerPhone}`}
          </p>
        )}
        {cancelled && order.cancellationReason && (
          <p className="mt-0.5 max-w-[180px] truncate text-[11px] text-[var(--color-vermillion-text)]/75">
            {order.cancellationReason}
          </p>
        )}
      </td>

      <td className="max-w-[200px] px-4 py-3.5 text-[var(--color-cream)]/70">
        <p className="truncate">{itemSummary}</p>
      </td>

      <td className="px-4 py-3.5">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium",
            payMeta.badgeClass,
          )}
        >
          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", payMeta.dotClass)} />
          {payMeta.labelEn}
        </span>
        {order.paymentStatus === "paid" && order.paymentMethod && (
          <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[var(--color-muted-foreground)]">
            {order.paymentMethod}
          </p>
        )}
      </td>

      <td className="oc-num px-4 py-3.5 text-right font-medium text-[var(--color-cream)]/90">
        {baht(order.totalPrice)}
      </td>

      <td className="px-4 py-3.5">
        <StatusBadge status={order.status} />
      </td>

      <td className="oc-num whitespace-nowrap px-4 py-3.5 text-right text-[12px] text-[var(--color-muted-foreground)]">
        {order.time}
      </td>
    </tr>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Payments view
   ═══════════════════════════════════════════════════════════════════════ */
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
    <Deck>
      <ViewHead title="Payments" titleZh="今日收款" meta={`${longDate(now)} · read-only audit`} />

      <div className="mb-6 grid grid-cols-2 gap-5 lg:grid-cols-5">
        <StatTile icon={Banknote} label="Paid" labelZh="已付" value={totals.paid} money sub="collected today" tone="money" index={0} />
        <StatTile
          icon={AlertTriangle}
          label="Unpaid"
          labelZh="未付"
          value={totals.unpaid}
          money
          sub="outstanding"
          tone={totals.unpaid > 0 ? "warn" : "muted"}
          index={1}
        />
        <StatTile icon={Wallet} label="Cash" labelZh="現金" value={totals.cash} money sub="paid in cash" tone="money" index={2} />
        <StatTile icon={ArrowLeftRight} label="Transfer" labelZh="轉帳" value={totals.transfer} money sub="paid by transfer" tone="money" index={3} />
        <StatTile
          icon={Receipt}
          label="At Risk"
          labelZh="風險"
          value={totals.riskCount}
          sub="closed, not paid"
          tone={totals.riskCount > 0 ? "alert" : "muted"}
          index={4}
        />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {PAYMENT_FILTERS.map(({ id, label, labelZh }) => (
          <FilterPill
            key={id}
            label={label}
            labelZh={labelZh}
            count={applyPaymentFilter(orders, id).length}
            active={filter === id}
            danger={id === "risk"}
            onClick={() => setFilter(id)}
          />
        ))}
      </div>

      {visible.length === 0 ? (
        <TableShell>
          <EmptyNote
            zh="沒有符合的收款"
            en="No payments match this filter."
            hint="Pick a different filter above."
          />
        </TableShell>
      ) : (
        <TableShell>
          <table className="w-full min-w-[920px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--oc-rule)]">
                <Th>Order · Location</Th>
                <Th>Payment</Th>
                <Th>Method</Th>
                <Th right>Total</Th>
                <Th right>Paid At</Th>
                <Th>Status</Th>
                <Th>Proof</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--oc-rule)]">
              {visible.map((order) => (
                <OwnerPaymentRow key={order.orderId} order={order} onSelect={() => onSelectOrder(order)} />
              ))}
            </tbody>
          </table>
        </TableShell>
      )}
    </Deck>
  );
}

function OwnerPaymentRow({ order, onSelect }: { order: StaffOrder; onSelect: () => void }) {
  const payMeta = PAYMENT_META[order.paymentStatus];
  const loc = orderLocation(order);
  const cancelled = order.status === "cancelled";
  const risk = isPaymentRisk(order);
  const paid = order.paymentStatus === "paid";
  const paidAtLabel = ownerFmtTime(order.paidAt);

  return (
    <tr
      {...rowActivation(onSelect)}
      className={cn(
        "oc-row cursor-pointer hover:bg-[var(--color-gold)]/[0.05]",
        cancelled && "opacity-60",
        // The row-hover gold rule lands on exactly the same 2px as the risk
        // edge below, which would repaint a warning gold — the one colour in
        // this console that means money is fine. Risk rows keep their edge.
        risk && "[&>:first-child]:before:hidden",
      )}
    >
      {/* Risk rows carry a vermillion edge: money should exist for this order
          and doesn't, which is the single thing this table is for. */}
      <td
        className={cn(
          "border-l-2 px-4 py-3.5",
          risk ? "border-[var(--color-vermillion)]" : "border-transparent",
        )}
      >
        <p className="oc-num text-[11px] uppercase tracking-[0.12em] text-[var(--color-muted-foreground)]">
          {order.orderId}
        </p>
        <p className="mt-0.5 font-medium text-[var(--color-cream)]/90">
          {loc.big}
          {loc.num !== undefined && <span className="oc-num ml-1.5 text-[var(--color-gold)]">{loc.num}</span>}
          <span className="ml-2 text-[11px] text-[var(--color-muted-foreground)]">{loc.zh}</span>
        </p>
        {order.orderType === "delivery" && order.customerName && (
          <p className="mt-0.5 max-w-[180px] truncate text-[11px] text-[var(--color-muted-foreground)]">
            {order.customerName}
          </p>
        )}
      </td>

      <td className="px-4 py-3.5">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium",
            payMeta.badgeClass,
          )}
        >
          <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", payMeta.dotClass)} />
          {payMeta.labelEn}
        </span>
        {risk && (
          <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[var(--color-vermillion-text)]">
            Risk · 風險
          </p>
        )}
      </td>

      <td className="px-4 py-3.5 text-[12px]">
        {paid && order.paymentMethod ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[var(--color-cream)]/80">
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

      <td
        className={cn(
          "oc-num px-4 py-3.5 text-right font-medium",
          cancelled
            ? "text-[var(--color-muted-foreground)] line-through"
            : "text-[var(--color-cream)]/90",
        )}
      >
        {baht(order.totalPrice)}
      </td>

      <td className="oc-num whitespace-nowrap px-4 py-3.5 text-right text-[12px]">
        {paid && paidAtLabel ? (
          <span className="text-[var(--color-cream)]/75">{paidAtLabel}</span>
        ) : (
          <span className="text-[var(--color-muted-foreground)]/60">—</span>
        )}
      </td>

      <td className="px-4 py-3.5">
        <StatusBadge status={order.status} />
      </td>

      <td className="whitespace-nowrap px-4 py-3.5 text-[12px]">
        {order.hasPaymentProof ? (
          order.paymentProofUrl ? (
            <a
              href={order.paymentProofUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="oc-press inline-flex items-center gap-1.5 rounded-lg border border-teal-700/40 bg-teal-600/10 px-2.5 py-1.5 text-[11px] font-medium text-teal-300 transition hover:bg-teal-600/20"
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

/* ═══════════════════════════════════════════════════════════════════════
   Reports view
   ═══════════════════════════════════════════════════════════════════════ */
// Daily business report — pure math over the same today-orders/expenses state
// the other views use. No fetching, no polling, read-only. Cancelled orders are
// excluded from every money figure (they only appear as counts / audit rows).
// TODO(separation): use historical Supabase orders for day/week/month analytics
// (today the loaded order feed only reliably covers recent days).

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

    const doneUnpaid = live.filter(isPaymentRisk);
    const unpaidActive = live.filter(
      (o) => !isCompletedStatus(o.status) && o.paymentStatus === "unpaid",
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
  const topQty = bestSellers[0]?.qty ?? 0;

  return (
    <Deck>
      <ViewHead title="Reports" titleZh="每日報表" meta={`${longDate(now)} · daily business report`} />

      <div className="grid grid-cols-2 gap-5 lg:grid-cols-3">
        <StatTile icon={Banknote} label="Gross Sales" labelZh="總營業額" value={r.gross} money sub="billed today, excl. cancelled" tone="money" index={0} />
        <StatTile
          icon={Scale}
          label="Net Today"
          labelZh="今日淨額"
          value={expLoading ? "…" : net}
          money
          sub="collected minus expenses"
          tone={expLoading ? "muted" : net < 0 ? "alert" : "money"}
          index={1}
        />
        <StatTile
          icon={TrendingDown}
          label="Expenses"
          labelZh="今日支出"
          value={expLoading ? "…" : expensesTotal}
          money
          sub="logged outflows"
          tone={expLoading ? "muted" : "cost"}
          index={2}
        />
        <StatTile icon={ClipboardList} label="Orders" labelZh="訂單數" value={r.orderCount} sub="placed today" tone="muted" index={3} />
        <StatTile
          icon={XCircle}
          label="Cancelled"
          labelZh="已取消"
          value={r.cancelled.length}
          sub="orders today"
          tone={r.cancelled.length > 0 ? "warn" : "muted"}
          index={4}
        />
        <StatTile
          icon={Bike}
          label="Delivery Orders"
          labelZh="外送訂單"
          value={r.typeCounts.delivery}
          sub={`${baht(r.deliveryRevenue)} billed`}
          tone="muted"
          index={5}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <ReportPanel title="Payment Breakdown" titleZh="收款組成" index={0}>
          <ReportRow label="Cash" labelZh="現金" value={baht(r.cash)} accent="gold" />
          <ReportRow label="Transfer" labelZh="轉帳" value={baht(r.transfer)} accent="gold" />
          <ReportRow
            label="Unpaid"
            labelZh="未付"
            value={baht(r.unpaidTotal)}
            accent={r.unpaidTotal > 0 ? "vermillion" : undefined}
          />
          <ReportRow label="Paid orders" labelZh="已付單" value={String(r.paidCount)} />
          <ReportRow label="Unpaid orders" labelZh="未付單" value={String(r.unpaidCount)} />
        </ReportPanel>

        <ReportPanel title="Order Types" titleZh="訂單類型" index={1}>
          <ReportRow label="Dine-in" labelZh="堂食" value={String(r.typeCounts.dine_in)} />
          <ReportRow label="Pickup" labelZh="自取" value={String(r.typeCounts.pickup)} />
          <ReportRow label="Delivery" labelZh="外送" value={String(r.typeCounts.delivery)} />
          <ReportRow label="Delivery billed" labelZh="外送金額" value={baht(r.deliveryRevenue)} accent="gold" />
        </ReportPanel>

        <ReportPanel title="Status Breakdown" titleZh="狀態分佈" index={2}>
          {REPORT_STATUS_ROWS.map(({ status, labelEn, labelZh }) => (
            <div key={status} className="flex items-center justify-between gap-3 text-[13px]">
              <span className="flex min-w-0 items-center gap-2 text-[var(--color-cream)]/85">
                <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", OWNER_STATUS_BADGE[status].dot)} />
                <span className="truncate">
                  {labelEn} <span className="text-[11px] text-[var(--color-muted-foreground)]">{labelZh}</span>
                </span>
              </span>
              <span
                className={cn(
                  "oc-num shrink-0",
                  r.statusCounts[status] > 0
                    ? "text-[var(--color-cream)]"
                    : "text-[var(--color-muted-foreground)]/60",
                )}
              >
                {r.statusCounts[status]}
              </span>
            </div>
          ))}
        </ReportPanel>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <AuditList
          title="Done / Delivered — unpaid"
          titleZh="已完成未付"
          tone="var(--color-vermillion)"
          orders={r.doneUnpaid}
          empty="Every closed order is paid."
          onSelectOrder={onSelectOrder}
          index={0}
        />
        <AuditList
          title="Unpaid — still active"
          titleZh="未付進行中"
          tone="var(--color-gold-soft)"
          orders={r.unpaidActive}
          empty="All active orders are settled."
          onSelectOrder={onSelectOrder}
          index={1}
        />
        <AuditList
          title="Deliveries not yet delivered"
          titleZh="外送未送達"
          tone="oklch(0.72 0.13 230)"
          orders={r.deliveriesPending}
          empty="No deliveries in flight."
          onSelectOrder={onSelectOrder}
          index={2}
        />
        <AuditList
          title="Cancelled — with reasons"
          titleZh="今日取消"
          tone="var(--color-muted-foreground)"
          orders={r.cancelled}
          empty="No cancellations today."
          onSelectOrder={onSelectOrder}
          showReason
          index={3}
        />
      </div>

      <div className="mt-5">
        <Slab index={4} className="overflow-hidden">
          <PanelHead eyebrow="Best Sellers Today · 今日熱賣" icon={Flame} />
          {bestSellers.length > 0 ? (
            <ul className="divide-y divide-[var(--oc-rule)]">
              {bestSellers.map((item, idx) => (
                <li key={item.name} className="relative px-5 py-3.5 sm:px-6">
                  {/* The number gives the rank, the bar gives the gap between
                      ranks — #2 selling half of #1 is invisible in a list of
                      numbers. Kept just above the threshold where it reads as
                      a comparison rather than as a rendering artifact. */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 bg-[var(--color-gold)]/[0.11]"
                    style={{ width: `${topQty > 0 ? (item.qty / topQty) * 100 : 0}%` }}
                  />
                  <div className="relative flex items-baseline gap-3">
                    <span className="oc-num w-5 shrink-0 text-[11px] text-[var(--color-muted-foreground)]">
                      {idx + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13.5px] text-[var(--color-cream)]/90">
                      {item.name}
                    </span>
                    <span className="oc-num shrink-0 text-[12px] text-[var(--color-cream)]/70">
                      ×{item.qty}
                    </span>
                    <span className="oc-num w-24 shrink-0 text-right text-[13.5px] text-[var(--color-gold)]">
                      {baht(item.revenue)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyNote
              zh="尚無銷售資料"
              en="No item data yet."
              hint="Item analytics unlock once order-item data is connected during backend separation."
            />
          )}
        </Slab>
      </div>
    </Deck>
  );
}

function ReportPanel({
  title,
  titleZh,
  index = 0,
  children,
}: {
  title: string;
  titleZh: string;
  index?: number;
  children: ReactNode;
}) {
  return (
    <Slab index={index} className="overflow-hidden">
      <PanelHead eyebrow={`${title} · ${titleZh}`} />
      <div className="space-y-3 px-5 py-5 sm:px-6">{children}</div>
    </Slab>
  );
}

function ReportRow({
  label,
  labelZh,
  value,
  accent,
}: {
  label: string;
  labelZh?: string;
  value: string;
  accent?: "gold" | "vermillion";
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="min-w-0 truncate text-[var(--color-cream)]/85">
        {label}
        {labelZh && <span className="ml-1.5 text-[11px] text-[var(--color-muted-foreground)]">{labelZh}</span>}
      </span>
      <span
        className={cn(
          "oc-num shrink-0",
          accent === "gold"
            ? "text-[var(--color-gold)]"
            : accent === "vermillion"
            ? "text-[var(--color-vermillion-text)]"
            : "text-[var(--color-cream)]/85",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Compact clickable audit list — rows open the read-only order modal. */
function AuditList({
  title,
  titleZh,
  tone,
  orders,
  empty,
  onSelectOrder,
  showReason,
  index = 0,
}: {
  title: string;
  titleZh: string;
  tone: string;
  orders: StaffOrder[];
  empty: string;
  onSelectOrder: (o: StaffOrder) => void;
  showReason?: boolean;
  index?: number;
}) {
  return (
    <Slab index={index} className="overflow-hidden">
      <PanelHead
        eyebrow={`${title} · ${titleZh}`}
        tone={tone}
        meta={
          <span className="oc-num text-[12px] text-[var(--color-muted-foreground)]">
            {orders.length}
          </span>
        }
      />
      {orders.length > 0 ? (
        <ul className="divide-y divide-[var(--oc-rule)]">
          {orders.slice(0, 6).map((o) => (
            <li key={o.orderId}>
              <button
                type="button"
                onClick={() => onSelectOrder(o)}
                className="flex w-full items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-[var(--color-gold)]/[0.06] sm:px-6"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-[var(--color-cream)]/90">
                    {locText(o)}
                    <span className="ml-2 text-[11px] text-[var(--color-muted-foreground)]">
                      {STATUS_META[o.status].labelEn}
                    </span>
                  </span>
                  <span className="oc-num block truncate text-[11px] text-[var(--color-muted-foreground)]">
                    {o.orderId} · {o.time}
                  </span>
                  {showReason && o.cancellationReason && (
                    <span className="mt-0.5 block truncate text-[11.5px] italic text-[var(--color-muted-foreground)]/70">
                      {o.cancellationReason}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "oc-num shrink-0 whitespace-nowrap text-[14px]",
                    o.status === "cancelled"
                      ? "text-[var(--color-muted-foreground)] line-through"
                      : "text-[var(--color-gold)]",
                  )}
                >
                  {baht(o.totalPrice)}
                </span>
              </button>
            </li>
          ))}
          {orders.length > 6 && (
            <li className="px-5 py-2.5 text-[11px] text-[var(--color-muted-foreground)] sm:px-6">
              {orders.length - 6} more in Orders
            </li>
          )}
        </ul>
      ) : (
        <p className="px-5 py-6 text-[12.5px] text-[var(--color-muted-foreground)] sm:px-6">{empty}</p>
      )}
    </Slab>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Menu view (read-only)
   ═══════════════════════════════════════════════════════════════════════ */
// Read-only snapshot of the menu bundled with the app (src/data/menu.ts — the
// same data the customer menu renders from). No fetching here: live availability
// is operated on the staff Menu board, and full menu management (editing prices,
// stock, categories) connects after backend separation.
// TODO(separation): enable real menu management here (live data + writes)
// once the Supabase/backend menu API exists.

const MENU_CATEGORY_LABEL: Record<MenuCategoryId, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c.nameEn]),
) as Record<MenuCategoryId, string>;

// Status facet for the summary tiles. Combines with the category pills (AND):
// pick a category, then narrow it to available / popular / needs-price.
type MenuStatusFilter = "all" | "available" | "popular" | "needs_price";

function matchesMenuStatus(item: (typeof MENU)[number], filter: MenuStatusFilter): boolean {
  switch (filter) {
    case "available":   return item.available;
    case "popular":     return item.popular;
    case "needs_price": return item.price === undefined;
    default:            return true;
  }
}

function OwnerMenuView() {
  const [category, setCategory] = useState<MenuCategoryId | "all">("all");
  const [statusFilter, setStatusFilter] = useState<MenuStatusFilter>("all");

  // Clicking an already-active tile returns to "all items".
  const toggleStatus = (f: MenuStatusFilter) =>
    setStatusFilter((prev) => (prev === f && f !== "all" ? "all" : f));

  const items = useMemo(() => {
    const list = MENU.filter(
      (i) => (category === "all" || i.category === category) && matchesMenuStatus(i, statusFilter),
    );
    return list.sort((a, b) =>
      a.category === b.category
        ? a.order - b.order
        : MENU_CATEGORY_LABEL[a.category].localeCompare(MENU_CATEGORY_LABEL[b.category]),
    );
  }, [category, statusFilter]);

  const availableCount = MENU.filter((i) => i.available).length;
  const popularCount = MENU.filter((i) => i.popular).length;
  const needsPriceCount = MENU.filter((i) => i.price === undefined).length;

  return (
    <Deck>
      <ViewHead title="Menu" titleZh="菜單總覽" meta="read-only · menu snapshot" />

      <div className="mb-6 grid grid-cols-2 gap-5 lg:grid-cols-4">
        <StatTile
          icon={UtensilsCrossed}
          label="Items"
          labelZh="品項"
          value={MENU.length}
          sub={`${CATEGORIES.length} categories`}
          tone="muted"
          active={statusFilter === "all"}
          onClick={() => toggleStatus("all")}
          index={0}
        />
        <StatTile
          icon={Receipt}
          label="Available"
          labelZh="供應中"
          value={availableCount}
          sub="on the snapshot"
          tone="money"
          active={statusFilter === "available"}
          onClick={() => toggleStatus("available")}
          index={1}
        />
        <StatTile
          icon={Star}
          label="Popular"
          labelZh="人氣"
          value={popularCount}
          sub="marked bestsellers"
          tone={popularCount > 0 ? "warn" : "muted"}
          active={statusFilter === "popular"}
          onClick={() => toggleStatus("popular")}
          index={2}
        />
        <StatTile
          icon={AlertTriangle}
          label="Needs Price"
          labelZh="待定價"
          value={needsPriceCount}
          sub="price to confirm"
          tone={needsPriceCount > 0 ? "alert" : "muted"}
          active={statusFilter === "needs_price"}
          onClick={() => toggleStatus("needs_price")}
          index={3}
        />
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {[{ id: "all" as const, nameEn: "All" }, ...CATEGORIES].map((c) => (
          <FilterPill
            key={c.id}
            label={c.nameEn}
            count={
              MENU.filter(
                (i) => (c.id === "all" || i.category === c.id) && matchesMenuStatus(i, statusFilter),
              ).length
            }
            active={category === c.id}
            onClick={() => setCategory(c.id)}
          />
        ))}
      </div>

      {items.length === 0 ? (
        <TableShell>
          <EmptyNote
            zh="沒有符合的品項"
            en="No items match this view."
            hint="Adjust the category or the summary filter above."
          />
        </TableShell>
      ) : (
        <TableShell>
          <table className="w-full min-w-[760px] text-[13px]">
            <thead>
              <tr className="border-b border-[var(--oc-rule)]">
                <Th>Item</Th>
                <Th>Category</Th>
                <Th right>Price</Th>
                <Th>Unit</Th>
                <Th>Availability</Th>
                <Th>Tags</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--oc-rule)]">
              {items.map((item) => (
                <tr key={item.id} className={cn("oc-row", !item.available && "opacity-60")}>
                  <td className="px-4 py-3.5">
                    <p className="font-medium text-[var(--color-cream)]/90">{item.nameEn}</p>
                    <p className="oc-num mt-0.5 text-[10.5px] uppercase tracking-[0.1em] text-[var(--color-muted-foreground)]">
                      {item.id}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 text-[var(--color-cream)]/70">
                    {MENU_CATEGORY_LABEL[item.category]}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    {item.price !== undefined ? (
                      <span className="oc-num text-[var(--color-gold)]">{baht(item.price)}</span>
                    ) : (
                      <span className="text-[11px] uppercase tracking-[0.08em] text-[var(--color-vermillion-text)]">
                        To confirm
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-[12px] text-[var(--color-muted-foreground)]">
                    {item.unit ?? "—"}
                  </td>
                  <td className="px-4 py-3.5">
                    {item.available ? (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-400/28 bg-emerald-500/12 px-2.5 py-1 text-[11px] font-medium text-emerald-300">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Available
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--color-cream)]/12 bg-[var(--color-cream)]/6 px-2.5 py-1 text-[11px] font-medium text-[var(--color-cream)]/55">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[var(--color-cream)]/45" />
                        Off menu
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    {item.popular && (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[var(--color-gold)]/30 bg-[var(--color-gold)]/10 px-2.5 py-1 text-[11px] font-medium text-[var(--color-gold)]">
                        <Star className="h-2.5 w-2.5" strokeWidth={2} />
                        Popular
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableShell>
      )}

      <div className="mt-5">
        <Slab index={5}>
          <div className="px-5 py-5 sm:px-6">
            <Eyebrow>Menu Management · 菜單管理</Eyebrow>
            <p className="mt-2.5 max-w-[640px] text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
              This is the menu snapshot bundled with the app — the same data the customer menu
              renders from. Day-to-day availability is operated on the staff Menu board. Full menu
              management connects after backend separation, when the owner will be able to:
            </p>
            <ul className="mt-3.5 grid max-w-[640px] grid-cols-1 gap-2 text-[12.5px] text-[var(--color-cream)]/75 sm:grid-cols-2">
              {[
                "View the live menu",
                "Toggle item availability",
                "Edit prices",
                "Track low stock",
                "Manage categories",
              ].map((f) => (
                <li key={f} className="flex items-center gap-2.5">
                  <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-[var(--color-gold)]/60" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </Slab>
      </div>
    </Deck>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Order modal (read-only)
   ═══════════════════════════════════════════════════════════════════════ */

function ownerFmtTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : hhmm(d);
}

function DetailRow({
  label,
  labelZh,
  children,
  align = "center",
}: {
  label: string;
  labelZh: string;
  children: ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div
      className={cn(
        "flex justify-between gap-4 border-t border-[var(--oc-rule)] pt-4",
        align === "start" ? "items-start" : "items-center",
      )}
    >
      <span className="shrink-0 text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--color-cream)]/50">
        {label} · {labelZh}
      </span>
      <div className="min-w-0 text-right">{children}</div>
    </div>
  );
}

function OwnerOrderModal({ order, onClose }: { order: StaffOrder; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    // Move focus into the dialog on open and hand it back to the page on
    // close, so a keyboard user isn't left behind the backdrop.
    const restore = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      restore?.focus?.();
    };
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
      {/* The backdrop dims and pushes the deck back; the dialog is a blocking
          task, so it gets a scrim rather than mere translucency. */}
      <div
        className="absolute inset-0 bg-[oklch(0.09_0.02_45)]/70 backdrop-blur-sm"
        style={{ animation: "tp-fade 200ms ease both" }}
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Order ${order.orderId}`}
        onClick={(e) => e.stopPropagation()}
        // Modals are the one surface that keeps a centred origin: there is no
        // single trigger in the layout for it to grow out of. The entrance
        // rides the shared .oc-rise class rather than an inline animation so
        // the reduced-motion override can still reach it.
        className="oc-slab oc-rise relative flex max-h-[86dvh] w-full max-w-[620px] flex-col overflow-hidden rounded-2xl"
        style={{ boxShadow: "var(--oc-z4)" }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--oc-rule)] px-5 pb-4 pt-5">
          <div className="min-w-0">
            <p className="oc-num text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-gold-soft)]/70">
              {order.orderId} · {order.time} · {totalQty} {totalQty === 1 ? "item" : "items"} ·{" "}
              {formatOrderType(order.orderType)}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[20px] font-semibold leading-none text-[var(--color-cream)]">
                {loc.big}
                {loc.num !== undefined && <span className="oc-num ml-1.5">{loc.num}</span>}
                <span className="ml-2 text-[13px] tracking-[0.06em] text-[var(--color-cream)]/50">
                  {loc.zh}
                </span>
              </span>
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
                  meta.badgeClass,
                )}
              >
                <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", meta.dotClass)} />
                {meta.labelZh} {meta.labelEn}
              </span>
            </div>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close order details"
            className="oc-press flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-cream)]/10 text-[18px] text-[var(--color-cream)]/60 transition hover:bg-[var(--color-cream)]/20"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section>
            <h3 className="mb-3 text-[11px] uppercase tracking-[0.2em] text-[var(--color-cream)]/45">
              Items · 餐點
            </h3>
            <ul className="space-y-3">
              {order.items.map((item) => (
                <li
                  key={item.id ?? item.name}
                  className={cn("flex items-baseline gap-3", cancelled && "opacity-50")}
                >
                  <span className="oc-num w-9 shrink-0 text-right text-[16px] font-semibold text-[var(--color-vermillion-text)]">
                    {item.quantity}
                    <span className="ml-0.5 text-[11px] font-normal text-[var(--color-cream)]/35">×</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-[16px] leading-snug",
                        cancelled ? "text-[var(--color-cream)]/60 line-through" : "text-[var(--color-cream)]",
                      )}
                    >
                      {item.name}
                    </p>
                    {item.unitPrice > 0 && (
                      <p className="oc-num text-[12px] text-[var(--color-cream)]/40">
                        {baht(item.unitPrice)} each
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      "oc-num shrink-0 text-[16px]",
                      cancelled
                        ? "text-[var(--color-muted-foreground)] line-through"
                        : "text-[var(--color-gold-soft)]",
                    )}
                  >
                    {baht(item.quantity * item.unitPrice)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {order.notes && (
            <section>
              <h3 className="mb-3 text-[11px] uppercase tracking-[0.2em] text-[var(--color-cream)]/45">
                Notes · 備註
              </h3>
              <p className="rounded-xl border border-[var(--oc-rule)] bg-[var(--color-ink)] px-4 py-3 text-[15px] leading-relaxed text-[var(--color-cream)]/85">
                {order.notes}
              </p>
            </section>
          )}

          {order.orderType === "delivery" && (
            <section>
              <h3 className="mb-3 text-[11px] uppercase tracking-[0.2em] text-[var(--color-cream)]/45">
                Delivery · 外送
              </h3>
              <div className="space-y-2 rounded-xl border border-[var(--oc-rule)] bg-[var(--color-ink)] px-4 py-3 text-[14px]">
                {order.customerName && (
                  <div className="grid grid-cols-[16px_100px_1fr] items-center gap-2">
                    <User size={12} className="text-[var(--color-cream)]/40" />
                    <span className="text-[13px] uppercase tracking-[0.06em] text-[var(--color-cream)]/50">Name</span>
                    <span className="text-right text-[var(--color-cream)]">{order.customerName}</span>
                  </div>
                )}
                {order.customerPhone && (
                  <div className="grid grid-cols-[16px_100px_1fr] items-center gap-2">
                    <Phone size={12} className="text-[var(--color-cream)]/40" />
                    <span className="text-[13px] uppercase tracking-[0.06em] text-[var(--color-cream)]/50">Phone</span>
                    <span className="oc-num text-right text-[var(--color-cream)]">{order.customerPhone}</span>
                  </div>
                )}
                {order.deliveryAddress && (
                  <div className="grid grid-cols-[16px_100px_1fr] items-start gap-2">
                    <MapPin size={12} className="mt-0.5 text-[var(--color-cream)]/40" />
                    <span className="text-[13px] uppercase tracking-[0.06em] text-[var(--color-cream)]/50">Address</span>
                    <span className="text-right text-[var(--color-cream)]">{order.deliveryAddress}</span>
                  </div>
                )}
                <div className="space-y-1.5 border-t border-[var(--oc-rule)] pt-2">
                  {(order.subtotalPrice ?? 0) > 0 && (
                    <div className="flex justify-between gap-3">
                      <span className="text-[var(--color-cream)]/50">Subtotal</span>
                      <span className="oc-num text-[var(--color-cream)]/75">
                        {baht(order.subtotalPrice ?? 0)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-[var(--color-cream)]/50">
                      <Bike size={12} className="shrink-0" /> Delivery fee
                    </span>
                    <span className="oc-num text-[var(--color-cream)]/75">
                      {baht(displayDeliveryFee)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-[var(--color-cream)]/50">Total</span>
                    <span
                      className={cn(
                        "oc-num",
                        cancelled
                          ? "text-[var(--color-muted-foreground)] line-through"
                          : "text-[var(--color-vermillion-text)]",
                      )}
                    >
                      {baht(order.totalPrice)}
                    </span>
                  </div>
                </div>
              </div>
            </section>
          )}

          <DetailRow label="Total" labelZh="合計">
            <span
              className={cn(
                "oc-num inline-flex items-baseline text-[24px] leading-none",
                cancelled
                  ? "text-[var(--color-muted-foreground)] line-through"
                  : "text-[var(--color-vermillion-text)]",
              )}
            >
              {baht(order.totalPrice)}
            </span>
          </DetailRow>

          <DetailRow label="Payment" labelZh="付款">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium",
                payMeta.badgeClass,
              )}
            >
              <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", payMeta.dotClass)} />
              {payMeta.labelZh} {payMeta.labelEn}
              {paid && order.paymentMethod ? ` · ${order.paymentMethod}` : ""}
              {paid && paidAtLabel ? ` · ${paidAtLabel}` : ""}
            </span>
          </DetailRow>

          {order.hasPaymentProof && (
            <DetailRow label="Proof" labelZh="收據">
              {order.paymentProofUrl ? (
                <a
                  href={order.paymentProofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="oc-press inline-flex items-center gap-1.5 rounded-lg border border-teal-700/40 bg-teal-600/10 px-3 py-1.5 text-[12px] font-medium text-teal-300 transition hover:bg-teal-600/20"
                >
                  <ExternalLink size={11} strokeWidth={1.5} />
                  View proof
                </a>
              ) : (
                <span className="text-[12px] text-[var(--color-muted-foreground)]">
                  Received (no URL)
                </span>
              )}
              {order.paymentProofStatus && (
                <p className="mt-1 text-[11px] text-[var(--color-cream)]/40">
                  {order.paymentProofStatus}
                </p>
              )}
            </DetailRow>
          )}

          {cancelled && (order.cancellationReason || order.cancelledAt) && (
            <DetailRow label="Cancelled" labelZh="取消" align="start">
              {order.cancellationReason && (
                <p className="text-[13px] text-[var(--color-cream)]/80">{order.cancellationReason}</p>
              )}
              {cancelledAtLabel && (
                <p className="oc-num mt-0.5 text-[11px] text-[var(--color-cream)]/45">
                  at {cancelledAtLabel}
                </p>
              )}
            </DetailRow>
          )}

          <DetailRow label="Placed" labelZh="下單時間">
            <span className="oc-num text-[13px] text-[var(--color-cream)]/75">{order.time}</span>
          </DetailRow>
        </div>

        <div className="shrink-0 border-t border-[var(--oc-rule)] px-5 py-3">
          <p className="text-center text-[11px] uppercase tracking-[0.18em] text-[var(--color-muted-foreground)]">
            Read-only · 僅供檢視
          </p>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Loading / error
   ═══════════════════════════════════════════════════════════════════════ */

/** Skeleton in the shape of the deck it is about to become, rather than a
 *  spinner in an empty room — the layout arrives before the numbers do, so
 *  nothing jumps when the data lands. */
function LoadingDeck() {
  return (
    <Deck>
      <div className="mb-5 flex items-center gap-3">
        <Eyebrow className="shrink-0">載入中 · Loading tonight&apos;s figures</Eyebrow>
        <span aria-hidden className="h-px flex-1 bg-[var(--oc-rule)]" />
      </div>
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 xl:col-span-7">
          <SkeletonSlab className="h-[300px]" index={0} />
        </div>
        <div className="col-span-12 xl:col-span-5">
          <SkeletonSlab className="h-[300px]" index={1} />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-3 2xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <SkeletonSlab key={i} className="h-[132px]" index={i} />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-12 gap-5">
        <div className="col-span-12 xl:col-span-8">
          <SkeletonSlab className="h-[320px]" index={0} />
        </div>
        <div className="col-span-12 xl:col-span-4">
          <SkeletonSlab className="h-[320px]" index={1} />
        </div>
      </div>
    </Deck>
  );
}

function SkeletonSlab({ className, index }: { className?: string; index: number }) {
  return (
    <div className="oc-rise" style={{ "--i": index } as CSSProperties}>
      <div className={cn("oc-slab oc-slab-recessed relative overflow-hidden rounded-2xl", className)}>
        <span
          aria-hidden
          className="absolute inset-0 animate-pulse bg-[var(--color-cream)]/[0.025]"
          style={{ animationDelay: `${index * 120}ms` }}
        />
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <Deck>
      <div className="mx-auto mt-10 max-w-[460px]">
        <Slab className="border-[var(--color-vermillion)]/40">
          <div className="px-6 py-8 text-center">
            <p className="font-display text-[22px] text-[var(--color-cream)]">
              無法載入 · Can&apos;t load the console
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--color-muted-foreground)]">
              The order server didn&apos;t answer. Check it, then try again.
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="oc-press mt-6 h-12 rounded-full bg-[var(--color-vermillion)] px-8 text-[15px] font-semibold tracking-[0.01em] text-[var(--color-cream)] transition hover:bg-[var(--color-vermillion-deep)]"
            >
              重試 · Try again
            </button>
          </div>
        </Slab>
      </div>
    </Deck>
  );
}
