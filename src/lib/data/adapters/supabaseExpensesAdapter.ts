// ExpenseRepository backed by Supabase — READ IMPLEMENTED (Phase 2C),
// addExpense still deliberately stubbed until Phase 2G.
//
// NOT USED BY THE LIVE APP while ACTIVE_DATA_SOURCE is "n8n". listExpenses()
// is callable directly for the Phase 2D parity procedure
// (docs/adapter-parity-testing.md); nothing flips before parity passes.
//
// Schema source of truth: docs/schema-discovery-notes.md (filled 2026-07-06).
// Row shape + the paid_from→payment_method / description→itemName wiring live
// in ../mappers/expenseMapper.ts.
//
// Phase 2G — addExpense(): keep the never-throw { success, error? } contract
// and the snake_case AddExpensePayload field names (frozen — n8n automations
// consume them). Note the n8n insert maps paid_from → payment_method column.
//
// Contract references: contracts/expenseContract.ts, contracts/adapterContract.ts.

import type { ExpenseRepository } from "./types";
import { AdapterNotImplementedError } from "./types";
import { supabaseSelect } from "../supabase";
import {
  mapSupabaseExpenseRows,
  type SupabaseExpenseRow,
} from "../mappers/expenseMapper";

const notImplemented = (method: string) =>
  new AdapterNotImplementedError("supabaseExpensesAdapter", method);

/** Bangkok service-day date (yyyy-MM-dd) — the window the n8n Get Expenses API uses. */
const bangkokToday = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

export const supabaseExpensesAdapter: ExpenseRepository = {
  // Mirrors the n8n Get Expenses API: TODAY's expenses only, where "today" is
  // the Bangkok-local expense_date the n8n insert stamps (confirmed live:
  // yesterday's rows are excluded from the API response).
  listExpenses: async () => {
    const rows = await supabaseSelect<SupabaseExpenseRow>(
      "expenses",
      `select=*&expense_date=eq.${bangkokToday()}`,
    );
    return mapSupabaseExpenseRows(rows);
  },
  addExpense: async () => {
    // TODO(phase-2g): never-throw write; payload stays snake_case; paid_from → payment_method.
    throw notImplemented("addExpense");
  },
};
