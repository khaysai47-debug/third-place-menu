// Shared normalization helpers for data adapters (Phase 2B prep).
//
// NOT USED BY THE LIVE PATH. The live n8n mapper (mapApiOrder/mapApiExpense)
// keeps its own private helpers, deliberately untouched. These are the
// canonical versions for the data layer: the Supabase mappers use them today,
// and the n8n adapters can adopt them later if their internals ever move.
//
// Philosophy: never trust the row; unknown in → documented fallback out.
// Unknown STATUS-like values must never be silently coerced into a different
// valid value — closed vocabularies fall back to the contract's designated
// fallback (visible and safe), never to an arbitrary neighbor.
//
// One deliberate superset over the live mapper: numeric normalizers accept
// clean numeric STRINGS (e.g. "150.00"). Postgres numeric/decimal columns
// commonly serialize to JSON as strings via PostgREST; the live n8n path never
// produces those, so for n8n data behavior is identical (numbers pass through,
// garbage → 0). CONFIRMED (Phase 2B): observed money values arrive as JSON
// numbers, so the string branch is a safety net that normally never triggers.

import type {
  NormalizedOrderStatus,
  NormalizedOrderType,
  NormalizedPaymentMethod,
  NormalizedPaymentStatus,
} from "@/lib/data/contracts/orderContract";
import {
  FALLBACK_ORDER_STATUS,
  FALLBACK_ORDER_TYPE,
  ORDER_STATUS_VALUES,
  ORDER_TYPE_VALUES,
} from "@/lib/data/contracts/orderContract";

/* ── Primitives ─────────────────────────────────────────────────────────── */

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Money as a number (baht). Finite numbers pass through; strings that are
 * entirely a plain decimal number (optional sign, no commas/currency symbols)
 * are parsed; everything else → 0, matching the live mapper's fallback.
 * Deliberately does NOT strip formatting ("฿1,500" → 0, loudly wrong in
 * parity diffs) — formatting in a money column is a schema problem to fix at
 * the source, not to paper over here.
 */
export function normalizeMoney(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/**
 * Quantity as a number. Same acceptance rules as money (Postgres int columns
 * can also arrive as strings through some JSON paths). Not rounded — a
 * fractional quantity is a data bug we want to SEE in parity output, not hide.
 */
export function normalizeQuantity(value: unknown): number {
  return normalizeMoney(value);
}

/**
 * Timestamp as an ISO-8601 string, or undefined when absent/blank.
 * Deliberately does NOT validate parseability (matches the live mapper):
 * downstream `formatTime` renders "—" for junk, and owner day-windows use
 * `new Date()` with their own NaN guards. Returning the raw string keeps
 * parity diffs honest.
 */
export function normalizeTimestamp(value: unknown): string | undefined {
  const s = asString(value).trim();
  return s || undefined;
}

/** Non-empty string, else null — for `string | null` fields (notes, tableNumber). Not trimmed (live rule). */
export function normalizeNullableString(value: unknown): string | null {
  const s = asString(value);
  return s || null;
}

/** Non-empty string, else undefined — for optional fields (customerName, …). */
export function normalizeOptionalString(value: unknown): string | undefined {
  const s = asString(value);
  return s || undefined;
}

/* ── Closed vocabularies ────────────────────────────────────────────────── */

/**
 * DB → app order status. Accepts the app's 7 statuses case-insensitively plus
 * the known legacy alias "completed" (Airtable) → "done". Anything else falls
 * back to "new": the unknown order surfaces at the top of the staff board
 * instead of vanishing, and never masquerades as done/cancelled (which would
 * corrupt money totals).
 * CONFIRMED (Phase 2B): the DB stores "completed" (never "done"), "delivered",
 * "cancelled", "new" — but n8n does NOT constrain the column, so any string
 * the frontend flow writes (preparing/ready/out_for_delivery) can appear.
 * If a NEW spelling ever shows up, extend this mapping EXPLICITLY — do not
 * rely on the fallback in production.
 */
export function normalizeOrderStatus(value: unknown): NormalizedOrderStatus {
  const raw = asString(value).toLowerCase();
  if (raw === "completed") return "done"; // legacy Airtable vocabulary
  return ORDER_STATUS_VALUES.includes(raw as NormalizedOrderStatus)
    ? (raw as NormalizedOrderStatus)
    : FALLBACK_ORDER_STATUS;
}

/**
 * DB → app payment status. Case-insensitive "paid" → "paid"; EVERYTHING else
 * (including unknown values like "pending" or "refunded") → "unpaid". This is
 * the live rule and it fails safe: an order that might not be paid shows as
 * unpaid, which staff can fix, rather than as paid, which loses money.
 * CONFIRMED (Phase 2B): real rows hold "Paid" AND "unpaid", and the n8n
 * default can write lowercase "paid" — case-insensitive matching here is
 * mandatory, not defensive.
 */
export function normalizePaymentStatus(value: unknown): NormalizedPaymentStatus {
  return asString(value).toLowerCase() === "paid" ? "paid" : "unpaid";
}

/**
 * DB → app payment method. Canonicalizes case-insensitively to the exact
 * select values "Cash" / "Transfer"; anything unrecognized → undefined, never
 * invented (owner Payment Mix must not gain a phantom method).
 * CONFIRMED (Phase 2B): Supabase stores "Cash"/"Transfer" verbatim
 * (capitalized), or null before payment.
 */
export function normalizePaymentMethod(value: unknown): NormalizedPaymentMethod | undefined {
  const raw = asString(value).toLowerCase();
  if (raw === "cash") return "Cash";
  if (raw === "transfer") return "Transfer";
  return undefined;
}

/**
 * DB → app order type. Exact-match against the closed set; unknown →
 * "dine_in" (the live rule: a mistyped order still appears and is servable).
 */
export function normalizeOrderType(value: unknown): NormalizedOrderType {
  const raw = asString(value).toLowerCase() as NormalizedOrderType;
  return ORDER_TYPE_VALUES.includes(raw) ? raw : FALLBACK_ORDER_TYPE;
}

/* ── Field-group helpers ────────────────────────────────────────────────── */

/** Normalized delivery/customer slice of an order. */
export interface NormalizedDeliveryFields {
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  subtotalPrice: number;
  deliveryFee: number;
}

/**
 * Normalizes the delivery-related field group in one call so both future
 * adapters treat absence identically (undefined strings, 0 money).
 * NOTE: deliveryFee 0/absent renders as ฿30 in staff/owner detail views
 * (displayDeliveryFee UI fallback) — that rule lives in the UI on purpose.
 */
export function normalizeDeliveryFields(raw: {
  customerName?: unknown;
  customerPhone?: unknown;
  deliveryAddress?: unknown;
  subtotalPrice?: unknown;
  deliveryFee?: unknown;
}): NormalizedDeliveryFields {
  return {
    customerName: normalizeOptionalString(raw.customerName),
    customerPhone: normalizeOptionalString(raw.customerPhone),
    deliveryAddress: normalizeOptionalString(raw.deliveryAddress),
    subtotalPrice: normalizeMoney(raw.subtotalPrice),
    deliveryFee: normalizeMoney(raw.deliveryFee),
  };
}

/** Normalized cancellation slice of an order. */
export interface NormalizedCancellationFields {
  cancellationReason?: string;
  cancelledAt?: string;
}

/**
 * Normalizes the cancellation field group. cancelledAt falls back to
 * createdAt in owner day-attribution — that fallback stays in the UI layer;
 * here absence stays absent.
 */
export function normalizeCancellationFields(raw: {
  cancellationReason?: unknown;
  cancelledAt?: unknown;
}): NormalizedCancellationFields {
  return {
    cancellationReason: normalizeOptionalString(raw.cancellationReason),
    cancelledAt: normalizeTimestamp(raw.cancelledAt),
  };
}
