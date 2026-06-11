import type { StaffOrderStatus } from "@/data/staffOrders";

export const STATUS_ORDER: StaffOrderStatus[] = [
  "new",
  "preparing",
  "ready",
  "done",
  "cancelled",
];

interface StatusMeta {
  labelEn: string;
  labelZh: string;
  /** Badge styles on parchment (light) cards */
  badgeClass: string;
  /** Indicator dot on the dark shell (tabs / summary) */
  dotClass: string;
}

export const STATUS_META: Record<StaffOrderStatus, StatusMeta> = {
  new: {
    labelEn: "New",
    labelZh: "新單",
    badgeClass:
      "bg-[var(--color-vermillion)]/10 text-[var(--color-vermillion)] border-[var(--color-vermillion)]/25",
    dotClass: "bg-[var(--color-vermillion)]",
  },
  preparing: {
    labelEn: "Preparing",
    labelZh: "製作中",
    badgeClass: "bg-amber-500/10 text-amber-800 border-amber-600/25",
    dotClass: "bg-amber-400",
  },
  ready: {
    labelEn: "Ready",
    labelZh: "待取餐",
    badgeClass: "bg-emerald-600/10 text-emerald-800 border-emerald-700/25",
    dotClass: "bg-emerald-400",
  },
  done: {
    labelEn: "Done",
    labelZh: "已完成",
    badgeClass: "bg-[var(--color-ink)]/5 text-[var(--color-ink)]/55 border-[var(--color-ink)]/15",
    dotClass: "bg-stone-400",
  },
  cancelled: {
    labelEn: "Cancelled",
    labelZh: "已取消",
    badgeClass: "bg-[var(--color-ink)]/5 text-[var(--color-ink)]/50 border-[var(--color-ink)]/15",
    dotClass: "bg-stone-500",
  },
};

interface NextAction {
  next: StaffOrderStatus;
  labelEn: string;
  labelZh: string;
  buttonClass: string;
}

export const NEXT_ACTION: Partial<Record<StaffOrderStatus, NextAction>> = {
  new: {
    next: "preparing",
    labelEn: "Start Preparing",
    labelZh: "開始製作",
    buttonClass:
      "bg-[var(--color-vermillion)] text-[var(--color-cream)] hover:bg-[var(--color-vermillion-deep)]",
  },
  preparing: {
    next: "ready",
    labelEn: "Mark Ready",
    labelZh: "出餐",
    buttonClass: "bg-amber-600 text-white hover:bg-amber-700",
  },
  ready: {
    next: "done",
    labelEn: "Mark Done",
    labelZh: "完成",
    buttonClass: "bg-emerald-700 text-white hover:bg-emerald-800",
  },
};
