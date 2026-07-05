// Canonical EXPENSE data contract for the app's data boundary (Phase 2B prep).
//
// Same philosophy as orderContract.ts: the app already has one expense shape,
// `Expense` in src/lib/expenses.ts, consumed by the staff ExpenseView and the
// owner dashboard. This file re-exports it as the contract and documents what
// any adapter must produce — it does not define a competing type.
//
// Relationship to existing code:
// - `Expense`, `ExpensePaidFrom`, `ExpenseCategory` and the two OPTIONS arrays
//   live in src/lib/expenses.ts (live path imports them; left untouched).
// - The live mapper (mapApiExpense in expenses.ts) and the future Supabase
//   mapper (src/lib/data/mappers/expenseMapper.ts) must both produce this shape.
//
// ── THE CONTRACT ─────────────────────────────────────────────────────────────
//
// 1. `id` — backend row key (Airtable "rec…" today, Supabase row id later).
//    Internal only: React list keys. `expenseId` is the human "EXP-…" number.
//
// 2. MONEY IS A NUMBER — `amount` is a plain JS number (baht). Owner's
//    Net Today = collected − Σ amount depends on this being numeric.
//
// 3. CLOSED VOCABULARIES WITH "Other" FALLBACK — `paidFrom` must be one of
//    EXPENSE_PAID_FROM_VALUES and `category` one of EXPENSE_CATEGORY_VALUES;
//    any unknown input becomes "Other" (never dropped, never invented).
//    Owner's category color map and paid-from breakdown key on these EXACT
//    strings, capitalization included.
//
// 4. `reviewStatus` — free string, defaults to "Pending" when absent.
//
// 5. `note` / `createdBy` — `string | null` (empty string normalizes to null).
//
// 6. `createdAt` — ISO-8601 string; used for display AND newest-first sort.
//    Unlike orders it is required (empty string sorts last naturally).
//
// 7. ORDERING — listExpenses() returns newest-first by createdAt compare.
//
// 8. WRITE PAYLOAD IS snake_case AND FROZEN — AddExpensePayload keeps
//    item_name / paid_from / created_by names verbatim; n8n automations
//    consume them. This is a WIRE contract, not a UI shape.
//
// 9. NO BACKEND FIELD NAMES LEAK — screens only ever see the camelCase
//    Expense shape.

import type {
  AddExpensePayload,
  AddExpenseResult,
  Expense,
  ExpenseCategory,
  ExpensePaidFrom,
} from "@/lib/expenses";
import {
  EXPENSE_CATEGORY_OPTIONS,
  EXPENSE_PAID_FROM_OPTIONS,
} from "@/lib/expenses";

/* ── Contract type aliases (the app types ARE the contract) ─────────────── */

export type NormalizedExpense = Expense;
export type NormalizedExpensePaidFrom = ExpensePaidFrom;
export type NormalizedExpenseCategory = ExpenseCategory;
export type { AddExpensePayload, AddExpenseResult };

/* ── Canonical vocabularies (re-exported, not duplicated) ───────────────── */

export const EXPENSE_PAID_FROM_VALUES: readonly ExpensePaidFrom[] =
  EXPENSE_PAID_FROM_OPTIONS;
export const EXPENSE_CATEGORY_VALUES: readonly ExpenseCategory[] =
  EXPENSE_CATEGORY_OPTIONS;

/* ── Contract fallbacks ─────────────────────────────────────────────────── */

export const FALLBACK_PAID_FROM: ExpensePaidFrom = "Other";
export const FALLBACK_CATEGORY: ExpenseCategory = "Other";
export const FALLBACK_REVIEW_STATUS = "Pending";
