// OrderRepository backed by Supabase / the real backend — STILL A STUB after
// Phase 2A, deliberately.
//
// NOT USED BY THE LIVE APP. Every method throws AdapterNotImplementedError so
// an accidental switch fails loudly on first use instead of silently breaking.
//
// Phase 2A prepared the mapping layer; what this adapter is missing is ONLY
// the transport. Verified blockers (from code inspection — see the map's
// "Phase 2A Supabase Inspection"):
//   1. No Supabase client in the repo (no @supabase/supabase-js dependency).
//   2. No SUPABASE_URL / anon-key env vars in the project's env pattern.
//   3. Orders table name + real column names are unknown to the frontend
//      (n8n owns that knowledge today).
//
// Phase 2B implementation sketch, once those exist:
//   listOrders():
//     const { data, error } = await supabase.from(ORDERS_TABLE).select("*");
//     if (error) throw error;                       // reads throw (UI has retry)
//     return mapSupabaseOrderRows(data);            // src/lib/data/mappers/orderMapper.ts
//   The mapper already handles: done ⇄ "completed" (normalizeOrderStatusFromDb /
//   normalizeOrderStatusToDb + DB_STATUS_USES_COMPLETED flag), payment
//   status/method normalization, item parsing, newest-first sort, and all
//   defensive defaults. Align SupabaseOrderRow column names with the real
//   schema before wiring.
//
//   Writes (updateOrderStatus / updateOrderPayment / cancelOrder / submitOrder)
//   stay stubbed until the read path is proven side-by-side against n8n — and
//   they must keep the never-throw { success, error? } contract when built.

import type { OrderRepository } from "./types";
import { AdapterNotImplementedError } from "./types";

const notImplemented = (method: string) =>
  new AdapterNotImplementedError("supabaseOrdersAdapter", method);

export const supabaseOrdersAdapter: OrderRepository = {
  listOrders: async () => {
    throw notImplemented("listOrders");
  },
  updateOrderStatus: async () => {
    throw notImplemented("updateOrderStatus");
  },
  cancelOrder: async () => {
    throw notImplemented("cancelOrder");
  },
  updateOrderPayment: async () => {
    throw notImplemented("updateOrderPayment");
  },
  submitOrder: async () => {
    throw notImplemented("submitOrder");
  },
};
