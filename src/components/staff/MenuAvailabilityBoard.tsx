// Staff menu availability board: fetches the menu from the n8n API and lets
// staff mark items Available / Sold Out. Hidden is shown as a status only —
// it's managed elsewhere, not a staff action here.
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getMenuAvailability,
  updateMenuAvailability,
  type MenuAvailabilityItem,
  type MenuAvailabilityStatus,
} from "@/lib/menuAvailability";

type LoadState = "loading" | "error" | "ready";

interface AvailabilityMeta {
  labelZh: string;
  badgeClass: string;
  dotClass: string;
}

const AVAILABILITY_META: Record<MenuAvailabilityStatus, AvailabilityMeta> = {
  Available: {
    labelZh: "供應中",
    badgeClass: "bg-emerald-600/10 text-emerald-800 border-emerald-700/25",
    dotClass: "bg-emerald-500",
  },
  "Sold Out": {
    labelZh: "售完",
    badgeClass:
      "bg-[var(--color-vermillion)]/10 text-[var(--color-vermillion)] border-[var(--color-vermillion)]/25",
    dotClass: "bg-[var(--color-vermillion)]",
  },
  Hidden: {
    labelZh: "隱藏",
    badgeClass: "bg-[var(--color-ink)]/5 text-[var(--color-ink)]/50 border-[var(--color-ink)]/15",
    dotClass: "bg-stone-400",
  },
};

/** The two statuses staff can set from this board. */
const STAFF_ACTIONS: { status: MenuAvailabilityStatus; labelZh: string; activeClass: string }[] = [
  {
    status: "Available",
    labelZh: "供應",
    activeClass: "bg-emerald-700 border-emerald-700 text-white",
  },
  {
    status: "Sold Out",
    labelZh: "售完",
    activeClass:
      "bg-[var(--color-vermillion)] border-[var(--color-vermillion)] text-[var(--color-cream)]",
  },
];

/** Quick filter for the availability list. */
type StatusFilter = "all" | "Available" | "Sold Out";

const STATUS_FILTERS: { value: StatusFilter; labelEn: string; labelZh: string }[] = [
  { value: "all", labelEn: "All", labelZh: "全部" },
  { value: "Available", labelEn: "Available", labelZh: "供應" },
  { value: "Sold Out", labelEn: "Sold Out", labelZh: "售完" },
];

export function MenuAvailabilityBoard() {
  const [items, setItems] = useState<MenuAvailabilityItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [updatingIds, setUpdatingIds] = useState<ReadonlySet<string>>(new Set());
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const loadItems = useCallback(async () => {
    setLoadState("loading");
    try {
      setItems(await getMenuAvailability());
      setLoadState("ready");
    } catch (error) {
      console.error("Failed to load menu availability", error);
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  // Background re-sync after a successful update; keeps local state on failure.
  const refreshItems = useCallback(async () => {
    try {
      setItems(await getMenuAvailability());
    } catch (error) {
      console.error("Background refresh failed", error);
    }
  }, []);

  // Search (item code or English name) + status filter, applied before grouping.
  const query = search.trim().toLowerCase();
  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        const matchesQuery =
          !query ||
          item.menuItemId.toLowerCase().includes(query) ||
          item.name.toLowerCase().includes(query);
        const matchesStatus = statusFilter === "all" || item.availability === statusFilter;
        return matchesQuery && matchesStatus;
      }),
    [items, query, statusFilter],
  );

  // Categories in the order the API returns them (only those with matches).
  const categories = useMemo(() => {
    const order: string[] = [];
    for (const item of filteredItems) {
      if (!order.includes(item.category)) order.push(item.category);
    }
    return order;
  }, [filteredItems]);

  const setAvailability = async (menuItemId: string, status: MenuAvailabilityStatus) => {
    const item = items.find((i) => i.menuItemId === menuItemId);
    if (!item || item.availability === status || updatingIds.has(menuItemId)) return;

    setUpdateError(null);
    setUpdatingIds((prev) => new Set(prev).add(menuItemId));
    const result = await updateMenuAvailability(menuItemId, status);
    setUpdatingIds((prev) => {
      const next = new Set(prev);
      next.delete(menuItemId);
      return next;
    });

    if (result.success) {
      setItems((prev) =>
        prev.map((i) => (i.menuItemId === menuItemId ? { ...i, availability: status } : i)),
      );
      void refreshItems();
    } else {
      setUpdateError(result.error);
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
            onClick={() => void loadItems()}
            className="mt-5 h-12 px-8 rounded-full bg-[var(--color-vermillion)] text-[var(--color-cream)] text-[15px] font-semibold tracking-[0.02em] active:scale-[0.97] transition"
          >
            重試 · Retry
          </button>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mt-12 px-5 text-center">
        <div className="flex items-center justify-center gap-3 mb-3">
          <span className="h-px w-10 bg-[var(--color-gold)]/40" />
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-gold)]/50" />
          <span className="h-px w-10 bg-[var(--color-gold)]/40" />
        </div>
        <p className="font-display text-[20px] text-[var(--color-gold-soft)]/80">
          菜單是空的 · No menu items
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 px-5 space-y-5">
      {updateError && (
        <div className="rounded-xl border border-[var(--color-vermillion)]/40 bg-[var(--color-vermillion)]/10 px-4 py-3 flex items-center justify-between gap-3">
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

      {/* Search + status filter */}
      <div className="space-y-3">
        <input
          type="text"
          inputMode="search"
          placeholder="搜尋 · Search code or name (e.g. A01)"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-[var(--color-gold)]/30 bg-[var(--color-charcoal-soft)]/60 px-4 py-3 text-[15px] text-[var(--color-cream)] placeholder:text-[var(--color-cream)]/35 focus:outline-none focus:border-[var(--color-gold)]/55 transition"
        />
        <div className="inline-flex rounded-full border border-[var(--color-gold)]/25 bg-[var(--color-charcoal-soft)]/60 p-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`h-10 px-4 rounded-full text-[13px] font-semibold tracking-[0.02em] transition active:scale-[0.97] ${
                statusFilter === f.value
                  ? "bg-[var(--color-vermillion)] text-[var(--color-cream)]"
                  : "text-[var(--color-gold-soft)]/90 hover:text-[var(--color-cream)]"
              }`}
            >
              {f.labelZh} · {f.labelEn}
            </button>
          ))}
        </div>
      </div>

      {categories.length === 0 ? (
        <p className="py-8 text-center text-[15px] text-[var(--color-gold-soft)]/70">
          找不到餐點 · No items match your search or filter.
        </p>
      ) : (
        categories.map((category) => (
          <section
            key={category}
            className="paper-grain rounded-2xl border border-[var(--color-gold)]/30 overflow-hidden shadow-[0_20px_40px_-25px_oklch(0_0_0/0.8)]"
          >
            <h2 className="px-4 pt-4 pb-3 font-display text-[20px] leading-none text-[var(--color-ink)]">
              {category}
            </h2>
            <ul className="divide-y divide-dotted divide-[var(--color-ink)]/25 border-t border-dotted border-[var(--color-ink)]/25">
              {filteredItems
                .filter((item) => item.category === category)
                .map((item) => {
                  const meta = AVAILABILITY_META[item.availability];
                  const updating = updatingIds.has(item.menuItemId);
                  return (
                    <li
                      key={item.menuItemId}
                      className="px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2.5">
                          <h3 className="truncate text-[16px] font-semibold text-[var(--color-ink)]">
                            {item.name}
                          </h3>
                          <span
                            className={`shrink-0 pl-2 pr-2.5 py-0.5 rounded-full border flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] ${meta.badgeClass}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
                            {meta.labelZh} {item.availability}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <span className="staff-num inline-flex items-center rounded-md border border-[var(--color-ink)]/30 bg-[var(--color-ink)]/8 px-1.5 py-0.5 text-[12px] font-bold uppercase tracking-[0.08em] text-[var(--color-ink)]/80">
                            {item.menuItemId}
                          </span>
                          <span className="staff-num text-[12px] text-[var(--color-ink)]/55">
                            ฿{item.price.toLocaleString("en-US")}
                          </span>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {STAFF_ACTIONS.map((action) => {
                          const isCurrent = item.availability === action.status;
                          return (
                            <button
                              key={action.status}
                              onClick={() => void setAvailability(item.menuItemId, action.status)}
                              disabled={updating || isCurrent}
                              className={`h-12 px-5 rounded-xl border text-[14px] font-semibold tracking-[0.02em] transition active:scale-[0.97] disabled:active:scale-100 ${
                                isCurrent
                                  ? `${action.activeClass} cursor-default`
                                  : "border-[var(--color-ink)]/25 text-[var(--color-ink)]/75 hover:border-[var(--color-ink)]/50 disabled:opacity-50 disabled:cursor-wait"
                              }`}
                            >
                              {updating && !isCurrent
                                ? "更新中…"
                                : `${action.labelZh} · ${action.status}`}
                            </button>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
