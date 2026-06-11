// Staff order domain: types, status flow, and data access.
// Currently mock-backed. The integration phase swaps the internals of
// getStaffOrders/updateStaffOrderStatus for real n8n/Airtable calls —
// callers and UI components should not need to change.
// No secrets or endpoints belong in this file while it is client-shared;
// real credentials go in server-only code when the backend lands.

import { MOCK_ORDERS } from "@/data/staffOrders";

export type StaffOrderStatus = "new" | "preparing" | "ready" | "done" | "cancelled";

export type StaffOrderType = "dine_in" | "pickup" | "delivery";

export interface StaffOrderItem {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface StaffOrder {
  orderId: string;
  orderType: StaffOrderType;
  tableNumber: string | null;
  /** Display time only (mock data) — real data will carry a createdAt timestamp. */
  time: string;
  items: StaffOrderItem[];
  notes: string | null;
  totalPrice: number;
  status: StaffOrderStatus;
}

/** The only legal forward transitions. Done/cancelled are terminal. */
const NEXT_STATUS: Partial<Record<StaffOrderStatus, StaffOrderStatus>> = {
  new: "preparing",
  preparing: "ready",
  ready: "done",
};

export function nextStaffOrderStatus(status: StaffOrderStatus): StaffOrderStatus | null {
  return NEXT_STATUS[status] ?? null;
}

export type UpdateStaffOrderResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Fetch the staff order board.
 * Mock implementation: returns a fresh copy of the fixtures.
 * Integration phase: fetch from Airtable (server-side, via the route loader).
 */
export async function getStaffOrders(): Promise<StaffOrder[]> {
  return structuredClone(MOCK_ORDERS);
}

/**
 * Persist a status change for one order.
 * Mock implementation: logs and reports success; the UI keeps its own local state.
 * Integration phase: POST to the n8n webhook / Airtable update, then return
 * the real outcome so the UI can roll back on failure.
 */
export async function updateStaffOrderStatus(
  orderId: string,
  status: StaffOrderStatus
): Promise<UpdateStaffOrderResult> {
  console.log("STAFF_ORDER_STATUS_UPDATE (mock)", { orderId, status });
  return { success: true };
}
