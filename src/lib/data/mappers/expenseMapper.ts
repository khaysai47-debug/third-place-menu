// Supabase expense row → app-facing Expense mapper (Phase 2A).
//
// NOT USED BY THE LIVE APP YET. The live n8n path keeps mapApiExpense inside
// src/lib/expenses.ts. This mirrors its exact rules for the future Supabase
// read path so Phase 2B is only: fetch rows → mapSupabaseExpenseRows.
//
// ⚠ PROVISIONAL ROW SHAPE: no Supabase schema exists in this repo (Phase 2A
// inspection). Column names below follow the n8n API's snake_case fields,
// which the backend presumably already stores. Align in Phase 2B.

import {
  EXPENSE_CATEGORY_OPTIONS,
  EXPENSE_PAID_FROM_OPTIONS,
  type Expense,
  type ExpenseCategory,
  type ExpensePaidFrom,
} from "@/lib/expenses";

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
const asNumber = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) ? v : 0;

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
    amount: asNumber(row.amount),
    paidFrom: EXPENSE_PAID_FROM_OPTIONS.includes(rawPaidFrom) ? rawPaidFrom : "Other",
    category: EXPENSE_CATEGORY_OPTIONS.includes(rawCategory) ? rawCategory : "Other",
    note: asString(row.note) || null,
    createdAt: asString(row.created_at),
    createdBy: asString(row.created_by) || null,
    reviewStatus: asString(row.review_status) || "Pending",
  };
}

/** Maps a result set, newest first by createdAt — same as the live getExpenses. */
export function mapSupabaseExpenseRows(rows: SupabaseExpenseRow[]): Expense[] {
  return rows
    .map(mapSupabaseExpenseRow)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
