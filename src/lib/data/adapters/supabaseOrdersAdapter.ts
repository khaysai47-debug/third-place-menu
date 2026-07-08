// OrderRepository backed by Supabase — reads implemented (Phase 2C, live since
// the 2E flip); STAFF WRITES implemented in Phase 2G-D via the /api/staff/*
// server routes. NOT the live write path: ACTIVE_WRITE_SOURCE stays "n8n"
// (src/lib/data/dataSource.ts) — only the per-device localStorage override in
// orderRepository.ts reaches these writes, for testing.
//
// Schema source of truth: docs/schema-discovery-notes.md (filled 2026-07-06).
// Row shapes + field wiring live in ../mappers/orderMapper.ts.
//
// ─── WRITES (Phase 2G-D) ─────────────────────────────────────────────────────
//
// - Never-throw { success, error? } contract, same as the n8n path.
// - Writes go through the app's own server routes (src/routes/api.staff.*.ts)
//   with the x-staff-secret header — the service-role key stays server-side;
//   the frontend never writes Supabase directly.
// - orderKey is orders.order_number ("TP-…"), NOT the row UUID — the routes
//   match rows by order_number, same as the n8n workflows.
// - done→"completed" translation and cancellation-field resets happen inside
//   the routes (n8n behavior replicated there).
// - submitOrder stays stubbed — order intake migrates last (2G-C), n8n
//   automations hang off it.
//
// Contract references: contracts/orderContract.ts (data shape),
// contracts/adapterContract.ts (behavior rules), docs/backend-separation-runbook.md.

import type { OrderRepository } from "./types";
import { AdapterNotImplementedError } from "./types";
import type { UpdateStaffOrderResult } from "@/lib/staffOrders";
import { getStaffWriteSecret } from "@/lib/staffWriteSecret";
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

/**
 * POSTs one staff write to an /api/staff/* server route with the device's
 * staff secret. Never throws — mirrors the n8n path's result contract and
 * bilingual error copy so the staff UI behaves identically.
 */
async function staffWrite(
  path: string,
  body: Record<string, unknown>,
): Promise<UpdateStaffOrderResult> {
  const secret = getStaffWriteSecret();
  if (!secret) {
    return {
      success: false,
      error: "未設定員工密碼 · Staff secret not set — tap the key button in the header.",
    };
  }
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-staff-secret": secret },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
    } | null;
    if (!response.ok || data?.ok !== true) {
      return { success: false, error: data?.error ?? "更新失敗 · Update failed. Try again." };
    }
    return { success: true };
  } catch {
    return { success: false, error: "無法連接伺服器 · Can't reach order server." };
  }
}

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
  updateOrderStatus: (orderKey, status) =>
    staffWrite("/api/staff/update-status", { orderId: orderKey, status }),
  cancelOrder: (orderKey, reason) =>
    staffWrite("/api/staff/cancel-order", { orderId: orderKey, reason }),
  updateOrderPayment: (orderKey, paymentMethod) =>
    staffWrite("/api/staff/mark-paid", { orderId: orderKey, paymentMethod }),
  submitOrder: async () => {
    // TODO(last): order intake — most entangled with n8n automations; may stay on n8n.
    throw notImplemented("submitOrder");
  },
};
