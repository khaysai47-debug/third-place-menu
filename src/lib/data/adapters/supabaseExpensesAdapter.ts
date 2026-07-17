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
import { staffRead } from "../staffReadClient";
import { staffWrite } from "../staffWriteClient";
import { mapSupabaseExpenseRows, type SupabaseExpenseRow } from "../mappers/expenseMapper";

export const supabaseExpensesAdapter: ExpenseRepository = {
  // Same window as the n8n Get Expenses API: TODAY's expenses only (Bangkok
  // expense_date, filtered server-side). Since the Pre-Pilot Security
  // Hardening phase the rows come from the protected GET /api/staff/expenses
  // route (x-staff-secret, service-role key server-side, explicit columns) —
  // NEVER from a browser anon-key read. Throws StaffAccessError when the
  // device has no/invalid secret.
  listExpenses: async () => {
    const { expenses } = await staffRead<{ expenses: SupabaseExpenseRow[] }>("/api/staff/expenses");
    return mapSupabaseExpenseRows(expenses);
  },
  // Frozen snake_case payload passes through verbatim; the server route maps
  // paid_from → payment_method, item_name → description, stamps expense_date.
  addExpense: (payload) => staffWrite("/api/staff/add-expense", { ...payload }),
};
