// App-facing entry point for expense data. Screens import getExpenseRepository()
// from here — never a concrete adapter. Same split-switch design as
// orderRepository: listExpenses follows ACTIVE_READ_SOURCE (may flip in
// Phase 2E), addExpense follows ACTIVE_WRITE_SOURCE (n8n until Phase 2G —
// the Supabase write is a throwing stub; see dataSource.ts).

import { ACTIVE_READ_SOURCE, ACTIVE_WRITE_SOURCE } from "./dataSource";
import { n8nExpensesAdapter } from "./adapters/n8nExpensesAdapter";
import { supabaseExpensesAdapter } from "./adapters/supabaseExpensesAdapter";
import type { ExpenseRepository } from "./adapters/types";

export type { ExpenseRepository } from "./adapters/types";

const readAdapter =
  ACTIVE_READ_SOURCE === "supabase" ? supabaseExpensesAdapter : n8nExpensesAdapter;
const writeAdapter =
  ACTIVE_WRITE_SOURCE === "supabase" ? supabaseExpensesAdapter : n8nExpensesAdapter;

const expenseRepository: ExpenseRepository = {
  // READ — follows ACTIVE_READ_SOURCE (may flip in Phase 2E).
  listExpenses: readAdapter.listExpenses,
  // WRITE — follows ACTIVE_WRITE_SOURCE (n8n until Phase 2G; see dataSource.ts).
  addExpense: writeAdapter.addExpense,
};

export function getExpenseRepository(): ExpenseRepository {
  return expenseRepository;
}
