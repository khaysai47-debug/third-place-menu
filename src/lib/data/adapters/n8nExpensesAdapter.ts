// ExpenseRepository backed by the existing n8n bridge — the live implementation.
// Thin delegation over src/lib/expenses.ts; behavior is identical to calling
// getExpenses/addExpense directly.

import { addExpense, getExpenses } from "@/lib/expenses";
import type { ExpenseRepository } from "./types";

export const n8nExpensesAdapter: ExpenseRepository = {
  listExpenses: () => getExpenses(),
  addExpense: (payload) => addExpense(payload),
};
