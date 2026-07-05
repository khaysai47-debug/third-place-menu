// Supabase expense row → app-facing Expense mapper (Phase 2A, hardened 2B-prep).
//
// NOT USED BY THE LIVE APP YET. The live n8n path keeps mapApiExpense inside
// src/lib/expenses.ts. This mirrors its exact rules for the future Supabase
// read path so Phase 2B is only: fetch rows → mapSupabaseExpenseRows.
// Primitive rules come from ./normalize.ts; the contract is
// ../contracts/expenseContract.ts.
//
// ⚠ PROVISIONAL ROW SHAPE: no Supabase schema exists in this repo (Phase 2A
// inspection). Column names below follow the n8n API's snake_case fields,
// which the backend presumably already stores. DISCOVERY_REQUIRED: align with
// the real schema (worksheet: docs/schema-discovery-guide.md) in Phase 2B.

import type { Expense, ExpenseCategory, ExpensePaidFrom } from "@/lib/expenses";
import {
  EXPENSE_CATEGORY_VALUES,
  EXPENSE_PAID_FROM_VALUES,
  FALLBACK_CATEGORY,
  FALLBACK_PAID_FROM,
  FALLBACK_REVIEW_STATUS,
} from "@/lib/data/contracts/expenseContract";
import {
  normalizeMoney,
  normalizeNullableString,
} from "./normalize";

/** One expense row. Column names are PROVISIONAL (see header). */
export interface SupabaseExpenseRow {
  /** Row primary key — maps to Expense.id (internal key for React lists). */
  id?: unknown;
  /** Human-readable id (EXP-...). */
  expense_id?: unknown;
  item_name?: unknown;
  amount?: unknown;
  paid_from?: unknown;
  category?: unknown;
  note?: unknown;
  created_at?: unknown;
  created_by?: unknown;
  review_status?: unknown;
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Maps one row to the stable Expense type with the live mapper's exact
 * fallbacks: unknown paid_from/category → "Other", review_status → "Pending".
 * Owner's category color map and paid-from breakdown key on these exact strings.
 */
export function mapSupabaseExpenseRow(row: SupabaseExpenseRow): Expense {
  const rawPaidFrom = asString(row.paid_from) as ExpensePaidFrom;
  const rawCategory = asString(row.category) as ExpenseCategory;
  return {
    id: asString(row.id),
    expenseId: asString(row.expense_id),
    itemName: asString(row.item_name),
    amount: normalizeMoney(row.amount),
    paidFrom: EXPENSE_PAID_FROM_VALUES.includes(rawPaidFrom) ? rawPaidFrom : FALLBACK_PAID_FROM,
    category: EXPENSE_CATEGORY_VALUES.includes(rawCategory) ? rawCategory : FALLBACK_CATEGORY,
    note: normalizeNullableString(row.note),
    createdAt: asString(row.created_at),
    createdBy: normalizeNullableString(row.created_by),
    reviewStatus: asString(row.review_status) || FALLBACK_REVIEW_STATUS,
  };
}

/** Maps a result set, newest first by createdAt — same as the live getExpenses. */
export function mapSupabaseExpenseRows(rows: SupabaseExpenseRow[]): Expense[] {
  return rows
    .map(mapSupabaseExpenseRow)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
