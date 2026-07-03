// Pure order-domain rules shared by the staff and owner UIs.
//
// These helpers encode business language ("cancellable", "completed", "risk")
// so screens don't re-spell status combinations inline. They are pure and
// transport-agnostic: they survive backend separation unchanged, because they
// depend only on the StaffOrder types — not on where the data came from.
//
// Vocabulary:
// - completed  = food fully out: done (dine-in/pickup) or delivered (delivery).
//                Delivered is intentionally NOT merged into done anywhere.
// - active     = still moving through the pipeline (not completed, not cancelled).
// - cancellable = staff may cancel only before food is committed: new/preparing.
// - payment risk = completed but still unpaid — money should exist but doesn't.

import type { StaffOrder, StaffOrderStatus, StaffOrderType } from "./staffOrders";

/** Delivery orders get the extended status flow (out_for_delivery → delivered). */
export function isDeliveryOrder(order: Pick<StaffOrder, "orderType">): boolean {
  return order.orderType === "delivery";
}

/** Food fully out: done (dine-in/pickup) or delivered (delivery). */
export function isCompletedStatus(status: StaffOrderStatus): boolean {
  return status === "done" || status === "delivered";
}

/** Order left the pipeline for any reason — completed or cancelled. */
export function isClosedStatus(status: StaffOrderStatus): boolean {
  return isCompletedStatus(status) || status === "cancelled";
}

/** Still moving through the pipeline (new/preparing/ready/out_for_delivery). */
export function isActiveStatus(status: StaffOrderStatus): boolean {
  return !isClosedStatus(status);
}

/** Staff may cancel only before food is committed to the grill/road. */
export function isCancellableStatus(status: StaffOrderStatus): boolean {
  return status === "new" || status === "preparing";
}

/**
 * Audit signal used by the owner dashboard: food handed out (done/delivered)
 * but payment_status still unpaid.
 */
export function isPaymentRisk(
  order: Pick<StaffOrder, "status" | "paymentStatus">,
): boolean {
  return isCompletedStatus(order.status) && order.paymentStatus === "unpaid";
}

/** Display label for an order type (English). */
export function formatOrderType(orderType: StaffOrderType): string {
  switch (orderType) {
    case "dine_in":  return "Dine-in";
    case "pickup":   return "Pickup";
    case "delivery": return "Delivery";
  }
}
