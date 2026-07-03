// ExpenseRepository backed by Supabase / the real backend — PHASE 2 STUB.
// NOT USED BY THE LIVE APP; methods throw so an accidental switch fails loudly.
//
// Phase 2 notes:
// - listExpenses(): map snake_case rows (item_name, paid_from, created_at, …)
//   to the camelCase Expense type exactly as mapApiExpense does today,
//   including the "unknown value → Other" fallbacks for paidFrom/category and
//   reviewStatus defaulting to "Pending". Sort newest-first by createdAt.
// - addExpense(): keep the never-throw { success, error? } contract.

import type { ExpenseRepository } from "./types";
import { AdapterNotImplementedError } from "./types";

const notImplemented = (method: string) =>
  new AdapterNotImplementedError("supabaseExpensesAdapter", method);

export const supabaseExpensesAdapter: ExpenseRepository = {
  listExpenses: async () => {
    throw notImplemented("listExpenses");
  },
  addExpense: async () => {
    throw notImplemented("addExpense");
  },
};
