// ExpenseRepository backed by the existing n8n bridge — THE LIVE IMPLEMENTATION.
// Thin delegation over src/lib/expenses.ts; behavior is identical to calling
// getExpenses/addExpense directly.
//
// Boundary notes (same as n8nOrdersAdapter, in brief): n8n is the live bridge
// and the frontend never sees Airtable/Supabase details; this adapter's output
// is the reference contract any Supabase adapter must match before reads flip;
// addExpense's snake_case payload names are frozen (n8n automations consume
// them) and writes stay on n8n longer than reads; n8n remains the automation
// engine (bots, payment proof, notifications) after separation.

import { addExpense, getExpenses } from "@/lib/expenses";
import type { ExpenseRepository } from "./types";

export const n8nExpensesAdapter: ExpenseRepository = {
  listExpenses: () => getExpenses(),
  addExpense: (payload) => addExpense(payload),
};
