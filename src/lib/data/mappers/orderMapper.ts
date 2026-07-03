// Supabase order row → app-facing StaffOrder mapper (Phase 2A).
//
// NOT USED BY THE LIVE APP YET. The live n8n path keeps its own mapper inside
// src/lib/staffOrders.ts (mapApiOrder) — including its done ⇄ "completed"
// translation. This file centralizes the same rules for the FUTURE Supabase
// read path, so the Phase 2B adapter is only: fetch rows → mapSupabaseOrderRows.
//
// ⚠ PROVISIONAL ROW SHAPE: no Supabase client, schema, or generated types
// exist in this repo (verified Phase 2A inspection — see the map). The
// SupabaseOrderRow below is a snake_case projection of the fields the app
// needs (docs/backend-separation-map.md § "Phase 1 Data Shape Findings").
// Phase 2B must align every column name with the real schema before use.
//
// Parsing philosophy (identical to the live mapApiOrder): never trust the
// row — unknown in, defensive defaults out. Unknown status → "new", unknown
// order type → "dine_in", bad numbers → 0, empty strings → undefined/null.

import type {
  StaffOrder,
  StaffOrderItem,
  StaffOrderStatus,
  StaffOrderType,
  StaffPaymentMethod,
  StaffPaymentStatus,
} from "@/lib/staffOrders";

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

/* ── Small parsers ──────────────────────────────────────────────────────── */

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asNumber = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

/** HH:MM display time from an ISO timestamp — same rule as staffOrders.ts. */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/* ── Status normalization — THE dangerous translation, centralized ──────── */

// If the Supabase schema inherits Airtable's vocabulary, the database stores
// "completed" where the app says "done". Phase 2B: verify the real schema and
// set this flag accordingly. The READ direction is safe either way (both
// spellings are accepted); this flag only affects the WRITE direction.
export const DB_STATUS_USES_COMPLETED = false; // TODO(phase-2b): verify against real schema

const UI_STATUSES: StaffOrderStatus[] = [
  "new", "preparing", "ready", "out_for_delivery", "delivered", "done", "cancelled",
];
const ORDER_TYPES: StaffOrderType[] = ["dine_in", "pickup", "delivery"];

/** DB → app. Accepts both "done" and "completed"; unknown values → "new". */
export function normalizeOrderStatusFromDb(value: unknown): StaffOrderStatus {
  const raw = asString(value).toLowerCase();
  if (raw === "completed") return "done";
  return UI_STATUSES.includes(raw as StaffOrderStatus) ? (raw as StaffOrderStatus) : "new";
}

/** App → DB. Emits "completed" for done only if the schema demands it. */
export function normalizeOrderStatusToDb(status: StaffOrderStatus): string {
  return DB_STATUS_USES_COMPLETED && status === "done" ? "completed" : status;
}

/* ── Payment normalization ──────────────────────────────────────────────── */

/** Case-insensitive "paid"; anything else is unpaid — same as the live mapper. */
export function normalizePaymentStatus(value: unknown): StaffPaymentStatus {
  return asString(value).toLowerCase() === "paid" ? "paid" : "unpaid";
}

/**
 * Canonicalizes to the exact select values the app (and Airtable) use.
 * Case-insensitive on read (superset of the live mapper's exact match);
 * anything unrecognized is dropped to undefined, never invented.
 */
export function normalizePaymentMethod(value: unknown): StaffPaymentMethod | undefined {
  const raw = asString(value).toLowerCase();
  if (raw === "cash") return "Cash";
  if (raw === "transfer") return "Transfer";
  return undefined;
}

/* ── Items ──────────────────────────────────────────────────────────────── */

/**
 * Parses an items payload (jsonb array or joined rows) into StaffOrderItem[].
 * Accepts both snake_case (unit_price) and camelCase (unitPrice) line shapes.
 * Non-array input yields [] — an order never renders with phantom lines.
 */
export function parseOrderItems(value: unknown): StaffOrderItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((line) => {
    const l = (line ?? {}) as Record<string, unknown>;
    return {
      id: asString(l.id) || undefined,
      name: asString(l.name),
      quantity: asNumber(l.quantity),
      unitPrice: asNumber(l.unit_price ?? l.unitPrice),
    };
  });
}

/* ── Row mapper ─────────────────────────────────────────────────────────── */

/** Maps one provisional Supabase row to the stable app-facing StaffOrder. */
export function mapSupabaseOrderRow(row: SupabaseOrderRow): StaffOrder {
  const orderType = asString(row.order_type) as StaffOrderType;
  const createdAt = asString(row.created_at);
  return {
    // orderKey carrier — see adapters/types.ts. Field keeps its historical
    // name until a coordinated rename; only the data layer reads it as a key.
    airtableRecordId: asString(row.id) || undefined,
    orderId: asString(row.order_id),
    orderType: ORDER_TYPES.includes(orderType) ? orderType : "dine_in",
    tableNumber: asString(row.table_number) || null,
    time: formatTime(createdAt),
    createdAt: createdAt || undefined,
    items: parseOrderItems(row.items),
    notes: asString(row.notes) || null,
    totalPrice: asNumber(row.total_price),
    customerName: asString(row.customer_name) || undefined,
    customerPhone: asString(row.customer_phone) || undefined,
    deliveryAddress: asString(row.delivery_address) || undefined,
    subtotalPrice: asNumber(row.subtotal_price),
    deliveryFee: asNumber(row.delivery_fee),
    status: normalizeOrderStatusFromDb(row.status),
    paymentStatus: normalizePaymentStatus(row.payment_status),
    paymentMethod: normalizePaymentMethod(row.payment_method),
    paidAt: asString(row.paid_at) || undefined,
    hasPaymentProof: row.has_payment_proof === true ? true : undefined,
    paymentProofUrl: asString(row.payment_proof_url) || undefined,
    paymentProofStatus: asString(row.payment_proof_status) || undefined,
    paymentProofReceivedAt: asString(row.payment_proof_received_at) || undefined,
    cancellationReason: asString(row.cancellation_reason) || undefined,
    cancelledAt: asString(row.cancelled_at) || undefined,
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
