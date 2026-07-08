// App-facing entry point for order data. Screens import getOrderRepository()
// (or the interface type) from here — never a concrete adapter.
//
// Three switches (dataSource.ts):
// - reads follow ACTIVE_READ_SOURCE (Supabase since Phase 2E);
// - the three STAFF order actions follow STAFF_ACTION_WRITE_SOURCE
//   (Supabase server routes since Phase 2G-F);
// - submitOrder follows ACTIVE_WRITE_SOURCE and MUST stay on n8n until the
//   customer-intake phase — its Supabase method is a throwing stub.

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
  // ORDER INTAKE — follows ACTIVE_WRITE_SOURCE; stays n8n (customer checkout
  // + manual order must not break; Supabase submitOrder is a throwing stub).
  submitOrder: writeAdapter.submitOrder,
};

export function getOrderRepository(): OrderRepository {
  return orderRepository;
}
