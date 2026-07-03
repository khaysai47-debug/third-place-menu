// App-facing entry point for order data. Screens import getOrderRepository()
// (or the interface type) from here — never a concrete adapter.
//
// Today this always returns the n8n adapter, so behavior is identical to the
// pre-repository code. The Supabase branch exists only so the Phase 2 switch
// is a one-line change in dataSource.ts; until then it returns loud stubs.

import { ACTIVE_DATA_SOURCE } from "./dataSource";
import { n8nOrdersAdapter } from "./adapters/n8nOrdersAdapter";
import { supabaseOrdersAdapter } from "./adapters/supabaseOrdersAdapter";
import type { OrderRepository } from "./adapters/types";

export type { OrderRepository } from "./adapters/types";

export function getOrderRepository(): OrderRepository {
  return ACTIVE_DATA_SOURCE === "supabase" ? supabaseOrdersAdapter : n8nOrdersAdapter;
}
