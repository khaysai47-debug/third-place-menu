// Adapter parity validator — DEV TOOL ONLY (Phase 2D).
//
// Pure comparison functions for proving that a candidate adapter (Supabase)
// returns the same normalized data as the live adapter (n8n) on the same
// underlying rows. Nothing in src/ imports this module, so it is never part
// of a production bundle path unless deliberately imported from a dev scratch
// (console snippet or a temporary dev-only route — see
// docs/adapter-parity-testing.md for the procedure). It performs no I/O and
// has no side effects: callers fetch from both adapters and pass the arrays in.
//
// Design choices:
// - Orders are matched by the human `orderId` (both backends carry it and it
//   survives the row-key change from Airtable "rec…" ids to Supabase ids).
//   The row key itself is compared only for PRESENCE, since its value is
//   expected to differ between backends.
// - Timestamps are compared for PRESENCE by default, not value: Airtable and
//   Supabase may render the same instant with different ISO formatting.
//   `strictTimestamps: true` upgrades them to value comparison once formats
//   are confirmed equal.
// - Money and vocabulary fields are compared by VALUE — those must be
//   identical, that is the whole point of the mapping layer.

import type { StaffOrder } from "@/lib/staffOrders";
import type { Expense } from "@/lib/expenses";

/* ── Result shapes ──────────────────────────────────────────────────────── */

/** One field-level difference on one matched record. */
export interface ParityMismatch {
  /** Matching key — orderId ("TP-…") or expenseId ("EXP-…"). */
  recordId: string;
  /** Field path, e.g. "status" or "items[2].quantity". */
  field: string;
  /** Value from the reference adapter (n8n). */
  expected: unknown;
  /** Value from the candidate adapter (Supabase). */
  actual: unknown;
}

export interface ParityResult {
  domain: "orders" | "expenses";
  /** true only when counts match, no records are missing, and no field mismatches. */
  ok: boolean;
  referenceCount: number;
  candidateCount: number;
  /** Record ids present in the reference (n8n) but absent from the candidate. */
  missingInCandidate: string[];
  /** Record ids present in the candidate but absent from the reference. */
  extraInCandidate: string[];
  /** Duplicate ids inside either list — a keying bug that would corrupt matching. */
  duplicateIds: string[];
  /** Field-level differences on records present in both lists. */
  mismatches: ParityMismatch[];
  /** Number of matched records with zero field mismatches. */
  cleanMatches: number;
}

export interface ParityOptions {
  /** Compare timestamp VALUES instead of presence (enable once formats verified). */
  strictTimestamps?: boolean;
}

/* ── Internals ──────────────────────────────────────────────────────────── */

type FieldCheck<T> = {
  field: string;
  /** "value" compares strictly; "presence" compares defined-vs-undefined only. */
  mode: "value" | "presence" | "timestamp";
  get: (record: T) => unknown;
};

function indexById<T>(
  list: T[],
  getId: (record: T) => string,
  duplicates: string[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const record of list) {
    const id = getId(record);
    if (map.has(id)) duplicates.push(id);
    map.set(id, record);
  }
  return map;
}

const isPresent = (v: unknown): boolean => v !== undefined && v !== null && v !== "";

function compareRecords<T>(
  recordId: string,
  reference: T,
  candidate: T,
  checks: FieldCheck<T>[],
  options: ParityOptions,
  out: ParityMismatch[],
): boolean {
  let clean = true;
  for (const check of checks) {
    const expected = check.get(reference);
    const actual = check.get(candidate);
    const compareByValue =
      check.mode === "value" || (check.mode === "timestamp" && options.strictTimestamps);
    const equal = compareByValue
      ? expected === actual
      : isPresent(expected) === isPresent(actual);
    if (!equal) {
      clean = false;
      out.push({ recordId, field: check.field, expected, actual });
    }
  }
  return clean;
}

function diffLists<T>(
  domain: ParityResult["domain"],
  reference: T[],
  candidate: T[],
  getId: (record: T) => string,
  checks: FieldCheck<T>[],
  itemChecks: ((recordId: string, a: T, b: T, out: ParityMismatch[]) => boolean) | null,
  options: ParityOptions,
): ParityResult {
  const duplicateIds: string[] = [];
  const refById = indexById(reference, getId, duplicateIds);
  const candById = indexById(candidate, getId, duplicateIds);

  const missingInCandidate = [...refById.keys()].filter((id) => !candById.has(id));
  const extraInCandidate = [...candById.keys()].filter((id) => !refById.has(id));

  const mismatches: ParityMismatch[] = [];
  let cleanMatches = 0;
  for (const [id, ref] of refById) {
    const cand = candById.get(id);
    if (!cand) continue;
    const fieldsClean = compareRecords(id, ref, cand, checks, options, mismatches);
    const itemsClean = itemChecks ? itemChecks(id, ref, cand, mismatches) : true;
    if (fieldsClean && itemsClean) cleanMatches += 1;
  }

  return {
    domain,
    ok:
      reference.length === candidate.length &&
      missingInCandidate.length === 0 &&
      extraInCandidate.length === 0 &&
      duplicateIds.length === 0 &&
      mismatches.length === 0,
    referenceCount: reference.length,
    candidateCount: candidate.length,
    missingInCandidate,
    extraInCandidate,
    duplicateIds,
    mismatches,
    cleanMatches,
  };
}

/* ── Orders ─────────────────────────────────────────────────────────────── */

const ORDER_CHECKS: FieldCheck<StaffOrder>[] = [
  { field: "status", mode: "value", get: (o) => o.status },
  { field: "orderType", mode: "value", get: (o) => o.orderType },
  { field: "paymentStatus", mode: "value", get: (o) => o.paymentStatus },
  { field: "paymentMethod", mode: "value", get: (o) => o.paymentMethod },
  { field: "totalPrice", mode: "value", get: (o) => o.totalPrice },
  { field: "subtotalPrice", mode: "value", get: (o) => o.subtotalPrice },
  { field: "deliveryFee", mode: "value", get: (o) => o.deliveryFee },
  { field: "tableNumber", mode: "value", get: (o) => o.tableNumber },
  { field: "notes", mode: "value", get: (o) => o.notes },
  { field: "customerName", mode: "value", get: (o) => o.customerName },
  { field: "customerPhone", mode: "value", get: (o) => o.customerPhone },
  { field: "deliveryAddress", mode: "value", get: (o) => o.deliveryAddress },
  { field: "cancellationReason", mode: "value", get: (o) => o.cancellationReason },
  { field: "hasPaymentProof", mode: "value", get: (o) => o.hasPaymentProof },
  { field: "paymentProofUrl", mode: "value", get: (o) => o.paymentProofUrl },
  // Row key differs by design between backends — presence is what matters
  // (without it, staff action buttons error out).
  { field: "airtableRecordId(orderKey)", mode: "presence", get: (o) => o.airtableRecordId },
  { field: "createdAt", mode: "timestamp", get: (o) => o.createdAt },
  { field: "paidAt", mode: "timestamp", get: (o) => o.paidAt },
  { field: "cancelledAt", mode: "timestamp", get: (o) => o.cancelledAt },
  { field: "paymentProofReceivedAt", mode: "timestamp", get: (o) => o.paymentProofReceivedAt },
  { field: "items.length", mode: "value", get: (o) => o.items.length },
];

function compareOrderItems(
  recordId: string,
  reference: StaffOrder,
  candidate: StaffOrder,
  out: ParityMismatch[],
): boolean {
  let clean = true;
  const n = Math.min(reference.items.length, candidate.items.length);
  for (let i = 0; i < n; i++) {
    const a = reference.items[i];
    const b = candidate.items[i];
    for (const key of ["name", "quantity", "unitPrice"] as const) {
      if (a[key] !== b[key]) {
        clean = false;
        out.push({ recordId, field: `items[${i}].${key}`, expected: a[key], actual: b[key] });
      }
    }
  }
  return clean;
}

/**
 * Compares two normalized order lists — reference (live n8n) first, candidate
 * (Supabase) second. Both must already be adapter OUTPUT (StaffOrder[]), so
 * this validates the full fetch→map pipeline, not raw rows.
 */
export function compareOrdersForParity(
  n8nOrders: StaffOrder[],
  supabaseOrders: StaffOrder[],
  options: ParityOptions = {},
): ParityResult {
  return diffLists(
    "orders",
    n8nOrders,
    supabaseOrders,
    (o) => o.orderId,
    ORDER_CHECKS,
    compareOrderItems,
    options,
  );
}

/* ── Expenses ───────────────────────────────────────────────────────────── */

const EXPENSE_CHECKS: FieldCheck<Expense>[] = [
  { field: "itemName", mode: "value", get: (e) => e.itemName },
  { field: "amount", mode: "value", get: (e) => e.amount },
  { field: "paidFrom", mode: "value", get: (e) => e.paidFrom },
  { field: "category", mode: "value", get: (e) => e.category },
  { field: "note", mode: "value", get: (e) => e.note },
  { field: "createdBy", mode: "value", get: (e) => e.createdBy },
  { field: "reviewStatus", mode: "value", get: (e) => e.reviewStatus },
  { field: "id(rowKey)", mode: "presence", get: (e) => e.id },
  { field: "createdAt", mode: "timestamp", get: (e) => e.createdAt },
];

/**
 * Compares two normalized expense lists — reference (n8n) first, candidate
 * (Supabase) second. Matched by the human expenseId ("EXP-…").
 */
export function compareExpensesForParity(
  n8nExpenses: Expense[],
  supabaseExpenses: Expense[],
  options: ParityOptions = {},
): ParityResult {
  return diffLists(
    "expenses",
    n8nExpenses,
    supabaseExpenses,
    (e) => e.expenseId,
    EXPENSE_CHECKS,
    null,
    options,
  );
}

/* ── Human-readable summary ─────────────────────────────────────────────── */

/** Renders a ParityResult as a readable multi-line report for the console. */
export function summarizeParityResult(result: ParityResult): string {
  const lines: string[] = [];
  lines.push(
    `[parity:${result.domain}] ${result.ok ? "OK — outputs match" : "MISMATCH — do not flip reads"}`,
  );
  lines.push(
    `  counts: reference(n8n)=${result.referenceCount} candidate(supabase)=${result.candidateCount}`,
  );
  lines.push(`  clean matches: ${result.cleanMatches}`);
  if (result.duplicateIds.length) {
    lines.push(`  DUPLICATE ids (keying bug!): ${result.duplicateIds.join(", ")}`);
  }
  if (result.missingInCandidate.length) {
    lines.push(`  missing in candidate: ${result.missingInCandidate.join(", ")}`);
  }
  if (result.extraInCandidate.length) {
    lines.push(`  extra in candidate: ${result.extraInCandidate.join(", ")}`);
  }
  for (const m of result.mismatches) {
    lines.push(
      `  ${m.recordId} · ${m.field}: expected ${JSON.stringify(m.expected)} got ${JSON.stringify(m.actual)}`,
    );
  }
  return lines.join("\n");
}
