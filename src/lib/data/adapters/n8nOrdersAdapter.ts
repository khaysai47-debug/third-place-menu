// OrderRepository backed by the existing n8n bridge — the live implementation.
//
// This adapter is a thin delegation layer: every method calls the exact
// function the UI called before the repository layer existed, so behavior
// (fetch semantics, error contracts, status translation, sorting) is
// byte-identical. All n8n/Airtable knowledge stays in src/lib/staffOrders.ts
// and src/lib/orders.ts.

import {
  getStaffOrders,
  updateOrderPayment,
  updateStaffOrderStatus,
} from "@/lib/staffOrders";
import { submitOrder } from "@/lib/orders";
import type { OrderRepository } from "./types";

export const n8nOrdersAdapter: OrderRepository = {
  listOrders: () => getStaffOrders(),

  updateOrderStatus: (orderKey, status) => updateStaffOrderStatus(orderKey, status),

  // Cancellation is the same status write with the reason attached — matching
  // how staff.tsx has always called it.
  cancelOrder: (orderKey, reason) =>
    updateStaffOrderStatus(orderKey, "cancelled", { cancellationReason: reason }),

  updateOrderPayment: (orderKey, paymentMethod) => updateOrderPayment(orderKey, paymentMethod),

  submitOrder: (payload) => submitOrder(payload),
};
