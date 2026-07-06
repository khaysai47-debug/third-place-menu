// OrderRepository backed by Supabase — READS IMPLEMENTED (Phase 2C),
// writes still deliberately stubbed until Phase 2G.
//
// NOT USED BY THE LIVE APP while ACTIVE_DATA_SOURCE is "n8n"
// (src/lib/data/dataSource.ts). listOrders() is callable directly for the
// Phase 2D parity procedure (docs/adapter-parity-testing.md); nothing flips
// before parity passes.
//
// Schema source of truth: docs/schema-discovery-notes.md (filled 2026-07-06).
// Row shapes + field wiring live in ../mappers/orderMapper.ts.
//
// ─── WRITES (Phase 2G — keep stubbed until then) ─────────────────────────────
//
// - Keep the never-throw { success, error? } contract.
// - orderKey is orders.order_number ("TP-…"), NOT the row UUID — confirmed
//   live: the n8n Staff API emits airtableRecordId = order_number and the n8n
//   status/payment write workflows match rows by order_number. Future Supabase
//   writes must PATCH by order_number too (or the key changes in a coordinated
//   commit across adapter + n8n workflows).
// - Status writes go through normalizeOrderStatusToDb (DB stores "completed",
//   never "done"); cancel writes cancellation_reason + cancelled_at, and
//   non-cancel status writes reset both to null (n8n behavior).
// - submitOrder last of all — n8n automations hang off order intake.
//
// Contract references: contracts/orderContract.ts (data shape),
// contracts/adapterContract.ts (behavior rules), docs/backend-separation-runbook.md.

import type { OrderRepository } from "./types";
import { AdapterNotImplementedError } from "./types";
import { supabaseSelect } from "../supabase";
import {
  assembleSupabaseOrderRows,
  mapSupabaseOrderRows,
  type SupabaseOrderItemRow,
  type SupabaseOrderRow,
  type SupabasePaymentProofRow,
} from "../mappers/orderMapper";

const notImplemented = (method: string) =>
  new AdapterNotImplementedError("supabaseOrdersAdapter", method);

export const supabaseOrdersAdapter: OrderRepository = {
  // Mirrors the n8n Staff Orders API (confirmed live 2026-07-06): ALL orders,
  // no date filter; items from order_items; proof fields from payment_proofs;
  // joined client-side by orders.id so we don't depend on PostgREST FK embeds.
  // ponytail: three unbounded selects — add embeds/date filters when volume demands.
  listOrders: async () => {
    const [orders, items, proofs] = await Promise.all([
      supabaseSelect<SupabaseOrderRow>("orders", "select=*"),
      supabaseSelect<SupabaseOrderItemRow>("order_items", "select=*&order=created_at.asc"),
      supabaseSelect<SupabasePaymentProofRow>("payment_proofs", "select=*"),
    ]);
    return mapSupabaseOrderRows(assembleSupabaseOrderRows(orders, items, proofs));
  },
  updateOrderStatus: async () => {
    // TODO(phase-2g): never-throw write, normalizeOrderStatusToDb, key by order_number.
    throw notImplemented("updateOrderStatus");
  },
  cancelOrder: async () => {
    // TODO(phase-2g): status write + cancellation_reason + cancelled_at.
    throw notImplemented("cancelOrder");
  },
  updateOrderPayment: async () => {
    // TODO(phase-2g): payment_status "Paid" + payment_method + paid_at.
    throw notImplemented("updateOrderPayment");
  },
  submitOrder: async () => {
    // TODO(last): order intake — most entangled with n8n automations; may stay on n8n.
    throw notImplemented("submitOrder");
  },
};
