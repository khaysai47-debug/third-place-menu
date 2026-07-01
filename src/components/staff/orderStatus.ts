// UI presentation for staff order statuses (labels, colors). The status
// flow itself lives in src/lib/staffOrders.ts.
import type { StaffOrderStatus, StaffOrderType, StaffPaymentStatus } from "@/lib/staffOrders";

export const STATUS_ORDER: StaffOrderStatus[] = ["new", "preparing", "ready", "out_for_delivery", "delivered", "done", "cancelled"];

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
  out_for_delivery: {
    labelEn: "Out for Delivery",
    labelZh: "配送中",
    badgeClass: "bg-sky-500/10 text-sky-800 border-sky-600/25",
    dotClass: "bg-sky-400",
  },
  delivered: {
    labelEn: "Delivered",
    labelZh: "已送達",
    badgeClass: "bg-[var(--color-ink)]/5 text-[var(--color-ink)]/55 border-[var(--color-ink)]/15",
    dotClass: "bg-stone-400",
  },
};

export const PAYMENT_META: Record<StaffPaymentStatus, StatusMeta> = {
  unpaid: {
    labelEn: "Unpaid",
    labelZh: "未付",
    badgeClass: "bg-amber-500/10 text-amber-800 border-amber-600/25",
    dotClass: "bg-amber-400",
  },
  paid: {
    labelEn: "Paid",
    labelZh: "已付",
    badgeClass: "bg-emerald-600/10 text-emerald-800 border-emerald-700/25",
    dotClass: "bg-emerald-400",
  },
};

export interface NextAction {
  labelEn: string;
  labelZh: string;
  buttonClass: string;
}

export const NEXT_ACTION: Partial<Record<StaffOrderStatus, NextAction>> = {
  new: {
    labelEn: "Start Preparing",
    labelZh: "開始製作",
    buttonClass:
      "bg-[var(--color-vermillion)] text-[var(--color-cream)] hover:bg-[var(--color-vermillion-deep)]",
  },
  preparing: {
    labelEn: "Mark Ready",
    labelZh: "出餐",
    buttonClass: "bg-amber-600 text-white hover:bg-amber-700",
  },
  ready: {
    labelEn: "Mark Done",
    labelZh: "完成",
    buttonClass: "bg-emerald-700 text-white hover:bg-emerald-800",
  },
};

export function getNextAction(order: {
  status: StaffOrderStatus;
  orderType: StaffOrderType;
}): NextAction | null {
  switch (order.status) {
    case "new":
      return {
        labelEn: "Start Preparing",
        labelZh: "開始製作",
        buttonClass:
          "bg-[var(--color-vermillion)] text-[var(--color-cream)] hover:bg-[var(--color-vermillion-deep)]",
      };
    case "preparing":
      return {
        labelEn: "Mark Ready",
        labelZh: "出餐",
        buttonClass: "bg-amber-600 text-white hover:bg-amber-700",
      };
    case "ready":
      return order.orderType === "delivery"
        ? {
            labelEn: "Mark Out for Delivery",
            labelZh: "開始配送",
            buttonClass: "bg-sky-700 text-white hover:bg-sky-800",
          }
        : {
            labelEn: "Mark Done",
            labelZh: "完成",
            buttonClass: "bg-emerald-700 text-white hover:bg-emerald-800",
          };
    case "out_for_delivery":
      return {
        labelEn: "Mark Delivered",
        labelZh: "已送達",
        buttonClass: "bg-emerald-700 text-white hover:bg-emerald-800",
      };
    default:
      return null;
  }
}
