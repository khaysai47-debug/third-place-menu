// Supabase expense row → app-facing Expense mapper (Phase 2C — real schema).
//
// NOT USED BY THE LIVE APP while ACTIVE_DATA_SOURCE is "n8n". The live n8n
// path keeps mapApiExpense inside src/lib/expenses.ts. Primitive rules come
// from ./normalize.ts; the contract is ../contracts/expenseContract.ts.
//
// ROW SHAPE: verified against the real `expenses` table
// (docs/schema-discovery-notes.md, filled 2026-07-06). Corrections vs the old
// provisional guess:
// - There is NO "EXP-…" column and no expense_id column — the n8n Get
//   Expenses API maps expense_id ← id (the row UUID). We do the same, so
//   Expense.id === Expense.expenseId on this path.
// - There is NO review_status column → contract fallback "Pending" always.
// - The frontend's paid_from lives in the payment_method column.
// - The display name lives in description (n8n read chain:
//   description || note || ""); there is no item_name column.
// - staff_name is the closest column to the frontend's createdBy.

import type { Expense, ExpenseCategory, ExpensePaidFrom } from "@/lib/expenses";
import {
  EXPENSE_CATEGORY_VALUES,
  EXPENSE_PAID_FROM_VALUES,
  FALLBACK_CATEGORY,
  FALLBACK_PAID_FROM,
  FALLBACK_REVIEW_STATUS,
} from "@/lib/data/contracts/expenseContract";
import { normalizeMoney, normalizeNullableString } from "./normalize";

/** One `expenses` row — real columns (see header). */
export interface SupabaseExpenseRow {
  /** Row UUID — both Expense.id and Expense.expenseId (no EXP-… column exists). */
  id?: unknown;
  expense_date?: unknown;
  category?: unknown;
  description?: unknown;
  amount?: unknown;
  payment_method?: unknown;
  staff_name?: unknown;
  note?: unknown;
  created_at?: unknown;
}

const asString = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Maps one row to the stable Expense type with the live mapper's exact
 * fallbacks: unknown paidFrom/category → "Other", reviewStatus → "Pending".
 * Owner's category color map and paid-from breakdown key on these exact strings.
 */
export function mapSupabaseExpenseRow(row: SupabaseExpenseRow): Expense {
  const rawPaidFrom = asString(row.payment_method) as ExpensePaidFrom;
  const rawCategory = asString(row.category) as ExpenseCategory;
  return {
    id: asString(row.id),
    expenseId: asString(row.id),
    itemName: asString(row.description) || asString(row.note),
    amount: normalizeMoney(row.amount),
    paidFrom: EXPENSE_PAID_FROM_VALUES.includes(rawPaidFrom) ? rawPaidFrom : FALLBACK_PAID_FROM,
    category: EXPENSE_CATEGORY_VALUES.includes(rawCategory) ? rawCategory : FALLBACK_CATEGORY,
    note: normalizeNullableString(row.note),
    createdAt: asString(row.created_at),
    createdBy: normalizeNullableString(row.staff_name),
    reviewStatus: FALLBACK_REVIEW_STATUS,
  };
}

/** Maps a result set, newest first by createdAt — same as the live getExpenses. */
export function mapSupabaseExpenseRows(rows: SupabaseExpenseRow[]): Expense[] {
  return rows
    .map(mapSupabaseExpenseRow)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
