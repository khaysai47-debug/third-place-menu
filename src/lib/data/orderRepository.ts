// App-facing entry point for order data. Screens import getOrderRepository()
// (or the interface type) from here — never a concrete adapter.
//
// Reads and writes select their adapter independently (Phase 2E prep):
// reads may move to Supabase first (ACTIVE_READ_SOURCE); every write stays on
// n8n until Phase 2G (ACTIVE_WRITE_SOURCE) because the Supabase write methods
// are throwing stubs and n8n automations hang off n8n writes. With both flags
// on "n8n" this composes to exactly the n8n adapter — behavior unchanged.

import { ACTIVE_READ_SOURCE, ACTIVE_WRITE_SOURCE } from "./dataSource";
import { n8nOrdersAdapter } from "./adapters/n8nOrdersAdapter";
import { supabaseOrdersAdapter } from "./adapters/supabaseOrdersAdapter";
import type { OrderRepository } from "./adapters/types";

export type { OrderRepository } from "./adapters/types";

const readAdapter = ACTIVE_READ_SOURCE === "supabase" ? supabaseOrdersAdapter : n8nOrdersAdapter;
const writeAdapter = ACTIVE_WRITE_SOURCE === "supabase" ? supabaseOrdersAdapter : n8nOrdersAdapter;

// Phase 2G-D per-device TEST override for the three staff order writes only.
// Production default is untouched (ACTIVE_WRITE_SOURCE stays "n8n"); a tester
// opts THIS DEVICE into the Supabase server-route path via the console:
//   localStorage.setItem("tp-staff-write-source", "supabase")   // opt in
//   localStorage.removeItem("tp-staff-write-source")            // back to n8n
// Checked at call time so switching needs no reload. Requires the staff
// secret (key button in the staff header) or writes fail with a clear error.
function staffWriteAdapter() {
  try {
    if (localStorage.getItem("tp-staff-write-source") === "supabase") {
      return supabaseOrdersAdapter;
    }
  } catch {
    // SSR / localStorage unavailable — use the active default
  }
  return writeAdapter;
}

const orderRepository: OrderRepository = {
  // READ — follows ACTIVE_READ_SOURCE (may flip in Phase 2E).
  listOrders: readAdapter.listOrders,
  // WRITES — follow ACTIVE_WRITE_SOURCE (n8n until Phase 2G; see dataSource.ts),
  // except the per-device 2G-D test override above for the three staff actions.
  updateOrderStatus: (orderKey, status) => staffWriteAdapter().updateOrderStatus(orderKey, status),
  cancelOrder: (orderKey, reason) => staffWriteAdapter().cancelOrder(orderKey, reason),
  updateOrderPayment: (orderKey, paymentMethod) =>
    staffWriteAdapter().updateOrderPayment(orderKey, paymentMethod),
  // Order intake is NOT overridable — it migrates last (2G-C).
  submitOrder: writeAdapter.submitOrder,
};

export function getOrderRepository(): OrderRepository {
  return orderRepository;
}
