// App-facing entry point for expense data. Screens import getExpenseRepository()
// from here — never a concrete adapter. Same split-switch design as
// orderRepository: listExpenses follows ACTIVE_READ_SOURCE (Supabase since
// Phase 2E); addExpense is a STAFF ACTION and follows
// STAFF_ACTION_WRITE_SOURCE (Supabase server route since Phase 2G-G).

import { ACTIVE_READ_SOURCE, STAFF_ACTION_WRITE_SOURCE } from "./dataSource";
import { n8nExpensesAdapter } from "./adapters/n8nExpensesAdapter";
import { supabaseExpensesAdapter } from "./adapters/supabaseExpensesAdapter";
import type { ExpenseRepository } from "./adapters/types";

export type { ExpenseRepository } from "./adapters/types";

const readAdapter =
  ACTIVE_READ_SOURCE === "supabase" ? supabaseExpensesAdapter : n8nExpensesAdapter;
// Staff action — flipped in 2G-G. Rollback: one line in dataSource.ts back to
// "n8n"; the n8n adapter is never modified.
const staffActionAdapter =
  STAFF_ACTION_WRITE_SOURCE === "supabase" ? supabaseExpensesAdapter : n8nExpensesAdapter;

const expenseRepository: ExpenseRepository = {
  // READ — follows ACTIVE_READ_SOURCE.
  listExpenses: readAdapter.listExpenses,
  // WRITE — staff action, follows STAFF_ACTION_WRITE_SOURCE (2G-G).
  addExpense: staffActionAdapter.addExpense,
};

export function getExpenseRepository(): ExpenseRepository {
  return expenseRepository;
}
