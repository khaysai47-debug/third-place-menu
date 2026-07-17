// OrderRepository backed by Supabase — reads live since the 2E flip; the
// three STAFF WRITES (status/cancel/mark-paid) are the LIVE DEFAULT since
// Phase 2G-F via STAFF_ACTION_WRITE_SOURCE (dataSource.ts), going through the
// /api/staff/* server routes validated in 2G-E. submitOrder still throws —
// order intake bypasses the repository entirely (src/lib/orders.ts,
// ORDER_INTAKE_SOURCE — Supabase server routes since 2G-I).
//
// Schema source of truth: docs/schema-discovery-notes.md (filled 2026-07-06).
// Row shapes + field wiring live in ../mappers/orderMapper.ts.
//
// ─── WRITES (Phase 2G-D routes, 2G-F flip) ───────────────────────────────────
//
// - Never-throw { success, error? } contract, same as the n8n path.
// - Writes go through the app's own server routes (src/routes/api.staff.*.ts)
//   with the x-staff-secret header — the service-role key stays server-side;
//   the frontend never writes Supabase directly.
// - orderKey is orders.order_number ("TP-…"), NOT the row UUID — the routes
//   match rows by order_number, same as the n8n workflows.
// - done→"completed" translation and cancellation-field resets happen inside
//   the routes (n8n behavior replicated there).
// - submitOrder stays stubbed — intake moved in 2G-I via src/lib/orders.ts
//   (never through the repository).
//
// Contract references: contracts/orderContract.ts (data shape),
// contracts/adapterContract.ts (behavior rules), docs/backend-separation-runbook.md.

import type { OrderRepository } from "./types";
import { AdapterNotImplementedError } from "./types";
import { staffRead } from "../staffReadClient";
import { staffWrite } from "../staffWriteClient";
import {
  assembleSupabaseOrderRows,
  mapSupabaseOrderRows,
  type SupabaseOrderItemRow,
  type SupabaseOrderRow,
  type SupabasePaymentProofRow,
} from "../mappers/orderMapper";

const notImplemented = (method: string) =>
  new AdapterNotImplementedError("supabaseOrdersAdapter", method);

/** Wire shape of GET /api/staff/orders (staffDashboardReads.server.ts). */
interface StaffOrdersSnapshot {
  orders: SupabaseOrderRow[];
  orderItems: SupabaseOrderItemRow[];
  paymentProofs: SupabasePaymentProofRow[];
}

export const supabaseOrdersAdapter: OrderRepository = {
  // Same data window as the n8n Staff Orders API (confirmed live 2026-07-06):
  // ALL orders, no date filter; items + proofs joined client-side by
  // orders.id. Since the Pre-Pilot Security Hardening phase the rows come
  // from the protected GET /api/staff/orders route (x-staff-secret,
  // service-role key server-side, explicit columns) — NEVER from a browser
  // anon-key read; sensitive tables stop being anonymously readable.
  // Throws StaffAccessError when the device has no/invalid secret — the
  // staff/owner pages show the access gate for it.
  listOrders: async () => {
    const snapshot = await staffRead<StaffOrdersSnapshot>("/api/staff/orders");
    return mapSupabaseOrderRows(
      assembleSupabaseOrderRows(snapshot.orders, snapshot.orderItems, snapshot.paymentProofs),
    );
  },
  updateOrderStatus: (orderKey, status) =>
    staffWrite("/api/staff/update-status", { orderId: orderKey, status }),
  cancelOrder: (orderKey, reason) =>
    staffWrite("/api/staff/cancel-order", { orderId: orderKey, reason }),
  updateOrderPayment: (orderKey, paymentMethod) =>
    staffWrite("/api/staff/mark-paid", { orderId: orderKey, paymentMethod }),
  submitOrder: async () => {
    // Intake never routes through the repository: checkout + manual order call
    // src/lib/orders.ts submitOrder directly (ORDER_INTAKE_SOURCE, 2G-I).
    throw notImplemented("submitOrder");
  },
};
