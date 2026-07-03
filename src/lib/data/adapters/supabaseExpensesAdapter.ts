// ExpenseRepository backed by Supabase / the real backend — STILL A STUB after
// Phase 2A, deliberately. NOT USED BY THE LIVE APP; methods throw loudly.
//
// Same verified blockers as supabaseOrdersAdapter: no Supabase client, no env
// vars, expenses table/column names unknown to the frontend.
//
// Phase 2B sketch once those exist:
//   listExpenses():
//     const { data, error } = await supabase.from(EXPENSES_TABLE).select("*");
//     if (error) throw error;                        // reads throw (UI has retry)
//     return mapSupabaseExpenseRows(data);           // src/lib/data/mappers/expenseMapper.ts
//   addExpense(): keep the never-throw { success, error? } contract; the n8n
//   POST payload's snake_case field names (item_name, paid_from, …) very
//   likely match the column names — verify, don't assume.

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
