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

const readAdapter =
  ACTIVE_READ_SOURCE === "supabase" ? supabaseOrdersAdapter : n8nOrdersAdapter;
const writeAdapter =
  ACTIVE_WRITE_SOURCE === "supabase" ? supabaseOrdersAdapter : n8nOrdersAdapter;

const orderRepository: OrderRepository = {
  // READ — follows ACTIVE_READ_SOURCE (may flip in Phase 2E).
  listOrders: readAdapter.listOrders,
  // WRITES — follow ACTIVE_WRITE_SOURCE (n8n until Phase 2G; see dataSource.ts).
  updateOrderStatus: writeAdapter.updateOrderStatus,
  cancelOrder: writeAdapter.cancelOrder,
  updateOrderPayment: writeAdapter.updateOrderPayment,
  submitOrder: writeAdapter.submitOrder,
};

export function getOrderRepository(): OrderRepository {
  return orderRepository;
}
