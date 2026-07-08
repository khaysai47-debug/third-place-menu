// ExpenseRepository backed by Supabase — reads live since the 2E flip;
// addExpense LIVE DEFAULT since Phase 2G-G via STAFF_ACTION_WRITE_SOURCE
// (dataSource.ts), going through the /api/staff/add-expense server route.
//
// Schema source of truth: docs/schema-discovery-notes.md (filled 2026-07-06).
// Row shape + the paid_from→payment_method / description→itemName wiring live
// in ../mappers/expenseMapper.ts; the write-side mapping is applied inside
// the server route (api/_lib/staffOrderWrites.server.ts).
//
// Contract references: contracts/expenseContract.ts, contracts/adapterContract.ts.

import type { ExpenseRepository } from "./types";
import { staffWrite } from "../staffWriteClient";
import { supabaseSelect } from "../supabase";
import { mapSupabaseExpenseRows, type SupabaseExpenseRow } from "../mappers/expenseMapper";

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
  // Frozen snake_case payload passes through verbatim; the server route maps
  // paid_from → payment_method, item_name → description, stamps expense_date.
  addExpense: (payload) => staffWrite("/api/staff/add-expense", { ...payload }),
};
