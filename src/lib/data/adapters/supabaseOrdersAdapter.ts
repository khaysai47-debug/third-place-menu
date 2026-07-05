// OrderRepository backed by Supabase / the real backend — STILL A STUB,
// deliberately (Phase 2B prep done; transport blocked on schema discovery).
//
// NOT USED BY THE LIVE APP. Every method throws AdapterNotImplementedError so
// an accidental switch fails loudly on first use instead of silently breaking.
// No fake data, no guessed schema, no network calls until discovery is done.
//
// ─── DISCOVERY REQUIRED BEFORE IMPLEMENTING (docs/schema-discovery-guide.md) ──
//
// Tables (names are UNKNOWN to this repo — n8n owns them today):
//   DISCOVERY_REQUIRED: orders table name
//   DISCOVERY_REQUIRED: items storage — jsonb column on orders vs child table
//   DISCOVERY_REQUIRED: payment-proof storage (columns on orders vs own table/bucket)
//
// Columns to confirm against SupabaseOrderRow (mappers/orderMapper.ts), which
// is a PROVISIONAL snake_case guess:
//   DISCOVERY_REQUIRED: row primary key column (id? uuid? bigint?)
//   DISCOVERY_REQUIRED: human order number column (TP-…)
//   DISCOVERY_REQUIRED: status column + exact stored values
//                       (does the DB store "done" or Airtable's "completed"?
//                        → set DB_STATUS_USES_COMPLETED in orderMapper.ts)
//   DISCOVERY_REQUIRED: payment_status values + casing ("Paid" vs "paid")
//   DISCOVERY_REQUIRED: payment_method values ("Cash"/"Transfer" verbatim?)
//   DISCOVERY_REQUIRED: money column types (numeric→string in JSON, or float?)
//   DISCOVERY_REQUIRED: timestamp columns + timezone (timestamptz? UTC?)
//   DISCOVERY_REQUIRED: delivery columns (customer name/phone/address, fee, subtotal)
//   DISCOVERY_REQUIRED: cancellation columns (reason, cancelled_at)
//   DISCOVERY_REQUIRED: proof columns (has proof flag, url, status, received_at)
//
// Environment/client (verified absent from repo — see map § 7):
//   DISCOVERY_REQUIRED: Supabase project URL + anon key (VITE_* env pattern)
//   DISCOVERY_REQUIRED: RLS posture for dashboard reads (anon vs server-side)
//   TODO(phase-2c): add @supabase/supabase-js + one client module ONLY when
//   the above is known — no new dependency before then.
//
// ─── IMPLEMENTATION PLAN (Phase 2C — reads first, in this order) ─────────────
//
//   1. listOrders() — the ONLY method to implement first:
//        // TODO(phase-2c): real query goes here, e.g.
//        // const { data, error } = await supabase
//        //   .from(ORDERS_TABLE /* DISCOVERY_REQUIRED */)
//        //   .select("*" /* + items join if child table */);
//        // if (error) throw error;            // reads THROW (UI has retry)
//        // return mapSupabaseOrderRows(data); // mapper is ready + sorted
//      Before wiring: align SupabaseOrderRow column names with discovery notes.
//   2. Prove parity vs n8n on the same data:
//      src/lib/data/dev/adapterParity.ts → compareOrdersForParity, procedure
//      in docs/adapter-parity-testing.md. Do NOT flip reads before it passes.
//   3. Writes (updateOrderStatus / cancelOrder / updateOrderPayment /
//      submitOrder) stay stubbed MUCH longer — they migrate in Phase 2G after
//      reads are proven in production. They must keep the never-throw
//      { success, error? } contract, key by row id (never "TP-…"), and write
//      the DB's status vocabulary via normalizeOrderStatusToDb.
//      submitOrder is last of all — n8n automations hang off order intake.
//
// Contract references: contracts/orderContract.ts (data shape),
// contracts/adapterContract.ts (behavior rules), docs/backend-separation-runbook.md.

import type { OrderRepository } from "./types";
import { AdapterNotImplementedError } from "./types";

const notImplemented = (method: string) =>
  new AdapterNotImplementedError("supabaseOrdersAdapter", method);

export const supabaseOrdersAdapter: OrderRepository = {
  listOrders: async () => {
    // TODO(phase-2c): fetch rows → mapSupabaseOrderRows(rows). See plan above.
    throw notImplemented("listOrders");
  },
  updateOrderStatus: async () => {
    // TODO(phase-2g): never-throw write, normalizeOrderStatusToDb, key by row id.
    throw notImplemented("updateOrderStatus");
  },
  cancelOrder: async () => {
    // TODO(phase-2g): status write + cancellation_reason + cancelled_at.
    throw notImplemented("cancelOrder");
  },
  updateOrderPayment: async () => {
    // TODO(phase-2g): payment status/method write ("Paid" casing DISCOVERY_REQUIRED).
    throw notImplemented("updateOrderPayment");
  },
  submitOrder: async () => {
    // TODO(last): order intake — most entangled with n8n automations; may stay on n8n.
    throw notImplemented("submitOrder");
  },
};
