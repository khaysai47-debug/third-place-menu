// App-facing entry point for order data. Screens import getOrderRepository()
// (or the interface type) from here — never a concrete adapter.
//
// Switches (dataSource.ts):
// - reads follow ACTIVE_READ_SOURCE (Supabase since Phase 2E);
// - the three STAFF order actions follow STAFF_ACTION_WRITE_SOURCE
//   (Supabase server routes since Phase 2G-F);
// - ORDER INTAKE does NOT go through this repository: checkout and the
//   manual-order form call submitOrder() in src/lib/orders.ts directly,
//   governed by ORDER_INTAKE_SOURCE (Phase 2G-I). The repository's
//   submitOrder below still follows ACTIVE_WRITE_SOURCE but has no callers.

import { ACTIVE_READ_SOURCE, ACTIVE_WRITE_SOURCE, STAFF_ACTION_WRITE_SOURCE } from "./dataSource";
import { n8nOrdersAdapter } from "./adapters/n8nOrdersAdapter";
import { supabaseOrdersAdapter } from "./adapters/supabaseOrdersAdapter";
import type { OrderRepository } from "./adapters/types";

export type { OrderRepository } from "./adapters/types";

const readAdapter = ACTIVE_READ_SOURCE === "supabase" ? supabaseOrdersAdapter : n8nOrdersAdapter;
const writeAdapter = ACTIVE_WRITE_SOURCE === "supabase" ? supabaseOrdersAdapter : n8nOrdersAdapter;
// Staff actions only — flipped independently in 2G-F. Rollback: one line in
// dataSource.ts back to "n8n"; the n8n adapter below is never modified.
const staffActionAdapter =
  STAFF_ACTION_WRITE_SOURCE === "supabase" ? supabaseOrdersAdapter : n8nOrdersAdapter;

const orderRepository: OrderRepository = {
  // READ — follows ACTIVE_READ_SOURCE.
  listOrders: readAdapter.listOrders,
  // STAFF ACTIONS — follow STAFF_ACTION_WRITE_SOURCE (Supabase since 2G-F).
  updateOrderStatus: staffActionAdapter.updateOrderStatus,
  cancelOrder: staffActionAdapter.cancelOrder,
  updateOrderPayment: staffActionAdapter.updateOrderPayment,
  // ORDER INTAKE — UNUSED: checkout + manual order call src/lib/orders.ts
  // submitOrder directly (ORDER_INTAKE_SOURCE, Phase 2G-I), not this method.
  submitOrder: writeAdapter.submitOrder,
};

export function getOrderRepository(): OrderRepository {
  return orderRepository;
}
