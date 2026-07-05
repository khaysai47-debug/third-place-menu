// Supabase order row → app-facing StaffOrder mapper (Phase 2A, hardened 2B-prep).
//
// NOT USED BY THE LIVE APP YET. The live n8n path keeps its own mapper inside
// src/lib/staffOrders.ts (mapApiOrder) — including its done ⇄ "completed"
// translation. This file centralizes the same rules for the FUTURE Supabase
// read path, so the Phase 2B adapter is only: fetch rows → mapSupabaseOrderRows.
//
// The primitive rules (money, timestamps, closed vocabularies) live in
// ./normalize.ts and the contract in ../contracts/orderContract.ts — this file
// only owns the row shape and field wiring.
//
// ⚠ PROVISIONAL ROW SHAPE: no Supabase client, schema, or generated types
// exist in this repo (verified Phase 2A inspection — see the map). The
// SupabaseOrderRow below is a snake_case projection of the fields the app
// needs (docs/backend-separation-map.md § "Phase 1 Data Shape Findings").
// DISCOVERY_REQUIRED: Phase 2B must align every column name with the real
// schema (worksheet: docs/schema-discovery-guide.md) before use.
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

/* ── Provisional row types — align with real schema in Phase 2B ─────────── */

/** One order row. Column names are PROVISIONAL (see header). */
export interface SupabaseOrderRow {
  /** Row primary key — becomes the app's orderKey (carried in StaffOrder.airtableRecordId for now). */
  id?: unknown;
  /** Human-readable order number (TP-...). */
  order_id?: unknown;
  order_type?: unknown;
  table_number?: unknown;
  created_at?: unknown;
  notes?: unknown;
  total_price?: unknown;
  subtotal_price?: unknown;
  delivery_fee?: unknown;
  status?: unknown;
  payment_status?: unknown;
  payment_method?: unknown;
  paid_at?: unknown;
  has_payment_proof?: unknown;
  payment_proof_url?: unknown;
  payment_proof_status?: unknown;
  payment_proof_received_at?: unknown;
  customer_name?: unknown;
  customer_phone?: unknown;
  delivery_address?: unknown;
  cancellation_reason?: unknown;
  cancelled_at?: unknown;
  /** Item lines — jsonb column or joined child rows; parseOrderItems accepts both shapes. */
  items?: unknown;
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

// If the Supabase schema inherits Airtable's vocabulary, the database stores
// "completed" where the app says "done". DISCOVERY_REQUIRED (phase 2B): verify
// the real schema and set this flag accordingly. The READ direction is safe
// either way (normalizeOrderStatus accepts both spellings); this flag only
// affects the WRITE direction.
export const DB_STATUS_USES_COMPLETED = false;

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
 * Parses an items payload (jsonb array or joined rows) into StaffOrderItem[].
 * Accepts both snake_case (unit_price) and camelCase (unitPrice) line shapes.
 * Non-array input yields [] — an order never renders with phantom lines.
 * DISCOVERY_REQUIRED: confirm whether items are a jsonb column on the orders
 * table or a child table joined via select — and the exact line field names.
 */
export function parseOrderItems(value: unknown): StaffOrderItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((line) => {
    const l = (line ?? {}) as Record<string, unknown>;
    return {
      id: normalizeOptionalString(l.id),
      name: asString(l.name),
      quantity: normalizeQuantity(l.quantity),
      unitPrice: normalizeMoney(l.unit_price ?? l.unitPrice),
    };
  });
}

/* ── Row mapper ─────────────────────────────────────────────────────────── */

/** Maps one provisional Supabase row to the stable app-facing StaffOrder. */
export function mapSupabaseOrderRow(row: SupabaseOrderRow): StaffOrder {
  const createdAt = normalizeTimestamp(row.created_at);
  return {
    // orderKey carrier — see adapters/types.ts. Field keeps its historical
    // name until a coordinated rename; only the data layer reads it as a key.
    airtableRecordId: normalizeOptionalString(row.id),
    orderId: asString(row.order_id),
    orderType: normalizeOrderType(row.order_type),
    tableNumber: normalizeNullableString(row.table_number),
    time: formatTime(createdAt ?? ""),
    createdAt,
    items: parseOrderItems(row.items),
    notes: normalizeNullableString(row.notes),
    totalPrice: normalizeMoney(row.total_price),
    ...normalizeDeliveryFields({
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      deliveryAddress: row.delivery_address,
      subtotalPrice: row.subtotal_price,
      deliveryFee: row.delivery_fee,
    }),
    status: normalizeOrderStatusFromDb(row.status),
    paymentStatus: normalizePaymentStatus(row.payment_status),
    paymentMethod: normalizePaymentMethod(row.payment_method),
    paidAt: normalizeTimestamp(row.paid_at),
    // Contract: true or undefined, never false (UI truthiness convention).
    hasPaymentProof: row.has_payment_proof === true ? true : undefined,
    paymentProofUrl: normalizeOptionalString(row.payment_proof_url),
    paymentProofStatus: normalizeOptionalString(row.payment_proof_status),
    paymentProofReceivedAt: normalizeTimestamp(row.payment_proof_received_at),
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
