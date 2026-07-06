// Supabase order row → app-facing StaffOrder mapper (Phase 2C — real schema).
//
// NOT USED BY THE LIVE APP while ACTIVE_DATA_SOURCE is "n8n". The live n8n
// path keeps its own mapper inside src/lib/staffOrders.ts (mapApiOrder) —
// including its done ⇄ "completed" translation. This file centralizes the same
// rules for the Supabase read path: fetch rows → assemble → mapSupabaseOrderRows.
//
// The primitive rules (money, timestamps, closed vocabularies) live in
// ./normalize.ts and the contract in ../contracts/orderContract.ts — this file
// only owns the row shape and field wiring.
//
// ROW SHAPE: verified against the real schema (docs/schema-discovery-notes.md,
// filled 2026-07-06). Items live in a separate `order_items` table and proofs
// in `payment_proofs`, both joined on orders.id (the UUID) — the adapter
// fetches all three and attaches children via assembleSupabaseOrderRows.
//
// Parsing philosophy (identical to the live mapApiOrder): never trust the
// row — unknown in, defensive defaults out. Unknown status → "new", unknown
// order type → "dine_in", bad numbers → 0, empty strings → undefined/null.

import type { StaffOrder, StaffOrderItem, StaffOrderStatus } from "@/lib/staffOrders";
import {
  normalizeCancellationFields,
  normalizeDeliveryFields,
  normalizeMoney,
  normalizeNullableString,
  normalizeOptionalString,
  normalizeOrderStatus,
  normalizeOrderType,
  normalizePaymentMethod,
  normalizePaymentStatus,
  normalizeQuantity,
  normalizeTimestamp,
} from "./normalize";

/* ── Row types — real schema (docs/schema-discovery-notes.md) ───────────── */

/** One `orders` row (+ children attached by assembleSupabaseOrderRows). */
export interface SupabaseOrderRow {
  /** UUID primary key — used ONLY to join child rows; never shown to the app. */
  id?: unknown;
  /** Human order number (TP-…) — the app's orderId AND its orderKey (see mapper). */
  order_number?: unknown;
  order_type?: unknown;
  status?: unknown;
  table_number?: unknown;
  customer_name?: unknown;
  customer_phone?: unknown;
  customer_address?: unknown;
  customer_note?: unknown;
  subtotal?: unknown;
  delivery_fee?: unknown;
  total?: unknown;
  payment_method?: unknown;
  payment_status?: unknown;
  created_at?: unknown;
  paid_at?: unknown;
  cancellation_reason?: unknown;
  cancelled_at?: unknown;
  /** order_items child rows — attached by assembleSupabaseOrderRows. */
  items?: unknown;
  /** payment_proofs child rows — attached by assembleSupabaseOrderRows. */
  payment_proofs?: unknown;
}

/** One `order_items` row (subset the app consumes). */
export interface SupabaseOrderItemRow {
  order_id?: unknown;
  item_code?: unknown;
  item_name?: unknown;
  quantity?: unknown;
  unit_price?: unknown;
  created_at?: unknown;
}

/** One `payment_proofs` row (subset the app consumes). */
export interface SupabasePaymentProofRow {
  order_id?: unknown;
  proof_url?: unknown;
  status?: unknown;
  received_at?: unknown;
  created_at?: unknown;
}

/* ── Small local helpers ────────────────────────────────────────────────── */

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/** HH:MM display time from an ISO timestamp — same rule as staffOrders.ts. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/* ── Status write direction — THE dangerous translation ─────────────────── */

// CONFIRMED (Phase 2B, real execution data): the database stores "completed"
// where the app says "done"; "done" was never observed in the DB. "delivered"
// stays its own value (contract §8 — never merged). The READ direction is safe
// either way (normalizeOrderStatus accepts both spellings); this flag makes
// the WRITE direction emit "completed" when writes migrate in Phase 2G.
export const DB_STATUS_USES_COMPLETED = true;

/** DB → app. Accepts both "done" and "completed"; unknown values → "new". */
export const normalizeOrderStatusFromDb = normalizeOrderStatus;

/** App → DB. Emits "completed" for done only if the schema demands it. */
export function normalizeOrderStatusToDb(status: StaffOrderStatus): string {
  return DB_STATUS_USES_COMPLETED && status === "done" ? "completed" : status;
}

/* Payment normalization moved to ./normalize.ts — re-exported for continuity. */
export { normalizePaymentMethod, normalizePaymentStatus };

/* ── Items ──────────────────────────────────────────────────────────────── */

/**
 * Parses an items payload into StaffOrderItem[]. Accepts real order_items rows
 * (item_code / item_name / unit_price) and the n8n API's camelCase line shape
 * (id / name / unitPrice) — the n8n Staff API itself maps id ← item_code.
 * Non-array input yields [] — an order never renders with phantom lines.
 */
export function parseOrderItems(value: unknown): StaffOrderItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((line) => {
    const l = (line ?? {}) as Record<string, unknown>;
    return {
      id: normalizeOptionalString(l.item_code ?? l.id),
      name: asString(l.item_name ?? l.name),
      quantity: normalizeQuantity(l.quantity),
      unitPrice: normalizeMoney(l.unit_price ?? l.unitPrice),
    };
  });
}

/* ── Payment proofs ─────────────────────────────────────────────────────── */

const proofTime = (p: SupabasePaymentProofRow): string =>
  asString(p.received_at) || asString(p.created_at);

/** Latest proof row wins when an order has several (newest received_at). */
function latestPaymentProof(value: unknown): SupabasePaymentProofRow | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return [...(value as SupabasePaymentProofRow[])].sort((a, b) =>
    proofTime(b).localeCompare(proofTime(a)),
  )[0];
}

/* ── Assembly: attach child rows to their order ─────────────────────────── */

function groupByOrderId<T extends { order_id?: unknown }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = asString(row.order_id);
    if (!key) continue;
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  }
  return map;
}

/**
 * Joins order_items and payment_proofs onto their orders by orders.id — the
 * same join the n8n Staff API performs (proof.order_id === order.id). Kept
 * client-side so the adapter doesn't depend on PostgREST FK embedding.
 */
export function assembleSupabaseOrderRows(
  orders: SupabaseOrderRow[],
  itemRows: SupabaseOrderItemRow[],
  proofRows: SupabasePaymentProofRow[],
): SupabaseOrderRow[] {
  const itemsByOrder = groupByOrderId(itemRows);
  const proofsByOrder = groupByOrderId(proofRows);
  return orders.map((order) => {
    const key = asString(order.id);
    return {
      ...order,
      items: itemsByOrder.get(key) ?? [],
      payment_proofs: proofsByOrder.get(key) ?? [],
    };
  });
}

/* ── Row mapper ─────────────────────────────────────────────────────────── */

/** Maps one assembled Supabase row to the stable app-facing StaffOrder. */
export function mapSupabaseOrderRow(row: SupabaseOrderRow): StaffOrder {
  const createdAt = normalizeTimestamp(row.created_at);
  const proof = latestPaymentProof(row.payment_proofs);
  return {
    // orderKey carrier. CONFIRMED live (2026-07-06): the n8n Staff API emits
    // airtableRecordId = order_number ("TP-…"), and the n8n status/payment
    // write workflows match rows by order_number — so during the mixed phase
    // (Supabase reads + n8n writes) this MUST be order_number, not orders.id.
    airtableRecordId: normalizeOptionalString(row.order_number),
    orderId: asString(row.order_number),
    orderType: normalizeOrderType(row.order_type),
    tableNumber: normalizeNullableString(row.table_number),
    time: formatTime(createdAt ?? ""),
    createdAt,
    items: parseOrderItems(row.items),
    notes: normalizeNullableString(row.customer_note),
    totalPrice: normalizeMoney(row.total),
    ...normalizeDeliveryFields({
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      deliveryAddress: row.customer_address,
      subtotalPrice: row.subtotal,
      deliveryFee: row.delivery_fee,
    }),
    status: normalizeOrderStatusFromDb(row.status),
    paymentStatus: normalizePaymentStatus(row.payment_status),
    paymentMethod: normalizePaymentMethod(row.payment_method),
    paidAt: normalizeTimestamp(row.paid_at),
    // Contract: true or undefined, never false (UI truthiness convention).
    hasPaymentProof: proof ? true : undefined,
    paymentProofUrl: proof ? normalizeOptionalString(proof.proof_url) : undefined,
    paymentProofStatus: proof ? normalizeOptionalString(proof.status) : undefined,
    paymentProofReceivedAt: proof ? normalizeTimestamp(proof.received_at) : undefined,
    ...normalizeCancellationFields({
      cancellationReason: row.cancellation_reason,
      cancelledAt: row.cancelled_at,
    }),
  };
}

/**
 * Maps a result set and applies the board's contract ordering (newest first
 * by createdAt, missing timestamps last) — same as the live getStaffOrders.
 */
export function mapSupabaseOrderRows(rows: SupabaseOrderRow[]): StaffOrder[] {
  return rows
    .map(mapSupabaseOrderRow)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
