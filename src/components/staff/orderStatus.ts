// UI presentation for staff order statuses (labels, colors). The status
// flow itself lives in src/lib/staffOrders.ts.
import type { StaffOrderStatus, StaffOrderType, StaffPaymentStatus } from "@/lib/staffOrders";

export const STATUS_ORDER: StaffOrderStatus[] = ["new", "accepted", "preparing", "ready_for_pickup", "out_for_delivery", "delivered", "completed", "cancelled"];

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
  accepted: {
    labelEn: "Accepted",
    labelZh: "已接單",
    badgeClass: "bg-orange-500/10 text-orange-800 border-orange-600/25",
    dotClass: "bg-orange-400",
  },
  preparing: {
    labelEn: "Preparing",
    labelZh: "製作中",
    badgeClass: "bg-amber-500/10 text-amber-800 border-amber-600/25",
    dotClass: "bg-amber-400",
  },
  ready_for_pickup: {
    labelEn: "Ready",
    labelZh: "待取餐",
    badgeClass: "bg-emerald-600/10 text-emerald-800 border-emerald-700/25",
    dotClass: "bg-emerald-400",
  },
  completed: {
    labelEn: "Completed",
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

const ACCEPT: NextAction = {
  labelEn: "Accept Order",
  labelZh: "接單",
  buttonClass:
    "bg-[var(--color-vermillion)] text-[var(--color-cream)] hover:bg-[var(--color-vermillion-deep)]",
};
const START_PREPARING: NextAction = {
  labelEn: "Start Preparing",
  labelZh: "開始製作",
  buttonClass: "bg-orange-600 text-white hover:bg-orange-700",
};
const MARK_READY: NextAction = {
  labelEn: "Mark Ready",
  labelZh: "出餐",
  buttonClass: "bg-amber-600 text-white hover:bg-amber-700",
};
const MARK_OUT: NextAction = {
  labelEn: "Mark Out for Delivery",
  labelZh: "開始配送",
  buttonClass: "bg-sky-700 text-white hover:bg-sky-800",
};
const MARK_DELIVERED: NextAction = {
  labelEn: "Mark Delivered",
  labelZh: "已送達",
  buttonClass: "bg-emerald-700 text-white hover:bg-emerald-800",
};
const MARK_COMPLETED: NextAction = {
  labelEn: "Mark Completed",
  labelZh: "完成",
  buttonClass: "bg-emerald-700 text-white hover:bg-emerald-800",
};

/**
 * The advance-button for an order's CURRENT status, following the frozen flow
 * (mirrors nextStaffOrderStatus). Terminal/actionless states return null.
 */
export function getNextAction(order: {
  status: StaffOrderStatus;
  orderType: StaffOrderType;
}): NextAction | null {
  switch (order.status) {
    case "new":
      return ACCEPT;
    case "accepted":
      return START_PREPARING;
    case "preparing":
      return order.orderType === "delivery"
        ? MARK_OUT
        : order.orderType === "pickup"
          ? MARK_READY
          : MARK_COMPLETED; // dine_in
    case "ready_for_pickup":
      return MARK_COMPLETED;
    case "out_for_delivery":
      return MARK_DELIVERED;
    case "delivered":
      return MARK_COMPLETED;
    default:
      return null; // completed, cancelled
  }
}
