// Owner dashboard summary math. Pure functions over the StaffOrder[] we already
// fetch via getStaffOrders() — no fetching, no side effects, so the money totals
// are easy to read and reason about (payment auditing is the point of this view).
//
// "Today" = same local calendar day as `now`. Cancelled orders never count
// toward any total. "Collected" is realized (paid) revenue only; unpaid is
// reported separately and is NOT part of Collected.

import { isCompletedStatus } from "./orderRules";
import type { StaffOrder } from "./staffOrders";

export interface OwnerSummary {
  /** Orders placed today (non-cancelled), regardless of payment. */
  orderCount: number;
  /** Realized revenue today = cash + transfer. */
  collected: number;
  cash: number;
  transfer: number;
  /** Outstanding (unpaid, non-cancelled) total and count for today. */
  unpaidTotal: number;
  unpaidCount: number;
  /** Food handed out (status done) but not paid — the theft-audit signal. */
  doneUnpaidCount: number;
}

/** True when an ISO timestamp falls on the same local calendar day as `now`. */
export function isSameLocalDay(iso: string | undefined, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Orders created today (local), excluding cancelled. Newest-first order is
 *  preserved from the source array. */
export function todaysOrders(orders: readonly StaffOrder[], now: Date): StaffOrder[] {
  return orders.filter((o) => o.status !== "cancelled" && isSameLocalDay(o.createdAt, now));
}

export function summarizeToday(orders: readonly StaffOrder[], now: Date): OwnerSummary {
  const today = todaysOrders(orders, now);

  let collected = 0;
  let cash = 0;
  let transfer = 0;
  let unpaidTotal = 0;
  let unpaidCount = 0;
  let doneUnpaidCount = 0;

  for (const o of today) {
    if (o.paymentStatus === "paid") {
      collected += o.totalPrice;
      if (o.paymentMethod === "Cash") cash += o.totalPrice;
      else if (o.paymentMethod === "Transfer") transfer += o.totalPrice;
    } else {
      unpaidTotal += o.totalPrice;
      unpaidCount += 1;
      if (isCompletedStatus(o.status)) doneUnpaidCount += 1;
    }
  }

  return {
    orderCount: today.length,
    collected,
    cash,
    transfer,
    unpaidTotal,
    unpaidCount,
    doneUnpaidCount,
  };
}
