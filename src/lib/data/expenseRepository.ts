// App-facing entry point for expense data. Screens import getExpenseRepository()
// from here — never a concrete adapter. Same switch design as orderRepository.

import { ACTIVE_DATA_SOURCE } from "./dataSource";
import { n8nExpensesAdapter } from "./adapters/n8nExpensesAdapter";
import { supabaseExpensesAdapter } from "./adapters/supabaseExpensesAdapter";
import type { ExpenseRepository } from "./adapters/types";

export type { ExpenseRepository } from "./adapters/types";

export function getExpenseRepository(): ExpenseRepository {
  return ACTIVE_DATA_SOURCE === "supabase" ? supabaseExpensesAdapter : n8nExpensesAdapter;
}
