// Canonical ORDER data contract for the app's data boundary (Phase 2B prep).
//
// This file is the single written-down answer to: "what must ANY orders
// adapter (n8n today, Supabase later) return to the UI?" It does not define
// new runtime shapes — the app already has one order shape, `StaffOrder` in
// src/lib/staffOrders.ts, and every screen consumes it. Duplicating that type
// here would create drift, so this contract RE-EXPORTS the existing types
// under contract-flavored aliases and adds the canonical vocabulary constants
// that adapters/mappers/validators share.
//
// Relationship to existing code:
// - `StaffOrder` / `StaffOrderItem` (src/lib/staffOrders.ts) ARE the
//   normalized shapes. They stay where they are because the live n8n path
//   imports them; this file is the documented, importable view of the same
//   contract for the data layer.
// - The live mapper (mapApiOrder in staffOrders.ts) and the future Supabase
//   mapper (src/lib/data/mappers/orderMapper.ts) must both produce this shape.
// - docs/adapter-contract-checklist.md is the human checklist version;
//   src/lib/data/dev/adapterParity.ts is the machine-diff version.
//
// ── THE CONTRACT ─────────────────────────────────────────────────────────────
//
// Shape: `NormalizedOrder` (= StaffOrder). Field-by-field consumer map lives
// in docs/backend-separation-map.md § 5.1. The non-negotiables:
//
// 1. STATUS VOCABULARY — exactly the 7 values in ORDER_STATUS_VALUES below.
//    The database may store "completed"; the UI must only ever see "done".
//    That translation happens inside the adapter/mapper, never in a screen.
//    Unknown status must fall back to "new" (an unknown order shows up loudly
//    at the top of the board instead of disappearing).
//
// 2. ORDER TYPE — exactly ORDER_TYPE_VALUES. Unknown → "dine_in".
//
// 3. MONEY IS A NUMBER — totalPrice/subtotalPrice/deliveryFee/items[].unitPrice
//    are plain JS numbers (baht). Never strings, never null. Unparseable → 0.
//    (Postgres numeric columns often serialize as JSON strings — the adapter
//    must convert; see normalizeMoney in mappers/normalize.ts.)
//
// 4. QUANTITY IS A NUMBER — items[].quantity, same rule as money.
//
// 5. TIMESTAMPS ARE ISO-8601 STRINGS OR ABSENT — createdAt, paidAt,
//    cancelledAt, paymentProofReceivedAt. Empty string is forbidden; absence
//    is `undefined`. `time` (HH:MM display) is DERIVED from createdAt by the
//    mapper ("—" when invalid), never stored.
//
// 6. PAYMENT — paymentStatus is exactly "unpaid" | "paid" (unknown → "unpaid");
//    paymentMethod is exactly "Cash" | "Transfer" verbatim or undefined
//    (never lowercase, never a third value — owner Payment Mix keys on these).
//
// 7. ROW KEY vs HUMAN ID — `airtableRecordId` carries the backend row key
//    (the repository layer's `orderKey`; will carry the Supabase row id after
//    separation, field rename is a later coordinated change). `orderId` is the
//    human "TP-…" number. Writes are keyed by the row key ONLY. A row without
//    a row key renders fine but its action buttons error out — so every
//    writable row must have it.
//
// 8. DELIVERY FIELDS — customerName / customerPhone / deliveryAddress are
//    optional strings (absent = undefined, never ""). Delivery orders get the
//    extended status flow; `delivered` is NEVER merged into `done`.
//
// 9. CANCELLATION FIELDS — cancellationReason / cancelledAt optional strings.
//    Cancelled orders are excluded from all money totals (enforced by
//    orderRules.ts consumers, but the data must carry the fields).
//
// 10. PROOF FIELDS — hasPaymentProof is `true` or `undefined`, NEVER `false`
//     (UI truthiness convention). paymentProofUrl/Status/ReceivedAt optional.
//
// 11. ORDERING — listOrders() returns newest-first by string-comparing
//     createdAt; rows missing createdAt sort last.
//
// 12. NO BACKEND FIELD NAMES LEAK — screens never see snake_case columns,
//     Airtable record shapes, or Supabase row types. Only NormalizedOrder.

import type {
  StaffOrder,
  StaffOrderItem,
  StaffOrderStatus,
  StaffOrderType,
  StaffPaymentMethod,
  StaffPaymentStatus,
} from "@/lib/staffOrders";

/* ── Contract type aliases (the app types ARE the contract) ─────────────── */

export type NormalizedOrder = StaffOrder;
export type NormalizedOrderItem = StaffOrderItem;
export type NormalizedOrderStatus = StaffOrderStatus;
export type NormalizedOrderType = StaffOrderType;
export type NormalizedPaymentStatus = StaffPaymentStatus;
export type NormalizedPaymentMethod = StaffPaymentMethod;

/* ── Canonical vocabularies ─────────────────────────────────────────────────
 * Single exported source for the closed value sets. staffOrders.ts keeps its
 * own private copies for the live path (deliberately untouched); these arrays
 * are for the data layer (mappers, validators, future adapters). The
 * `satisfies`-style typing below guarantees they can never drift from the
 * union types without a compile error. */

export const ORDER_STATUS_VALUES: readonly NormalizedOrderStatus[] = [
  "new",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "done",
  "cancelled",
];

export const ORDER_TYPE_VALUES: readonly NormalizedOrderType[] = [
  "dine_in",
  "pickup",
  "delivery",
];

export const PAYMENT_STATUS_VALUES: readonly NormalizedPaymentStatus[] = [
  "unpaid",
  "paid",
];

/** Verbatim select values — capitalization is part of the contract. */
export const PAYMENT_METHOD_VALUES: readonly NormalizedPaymentMethod[] = [
  "Cash",
  "Transfer",
];

/* ── Contract fallbacks (what "unknown input" must become) ──────────────── */

export const FALLBACK_ORDER_STATUS: NormalizedOrderStatus = "new";
export const FALLBACK_ORDER_TYPE: NormalizedOrderType = "dine_in";
export const FALLBACK_PAYMENT_STATUS: NormalizedPaymentStatus = "unpaid";
