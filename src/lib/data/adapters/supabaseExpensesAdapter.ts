// ExpenseRepository backed by Supabase / the real backend — STILL A STUB,
// deliberately (Phase 2B prep done; transport blocked on schema discovery).
//
// NOT USED BY THE LIVE APP; methods throw loudly. No fake data, no guessed
// schema, no network calls until discovery is done.
//
// ─── DISCOVERY REQUIRED BEFORE IMPLEMENTING (docs/schema-discovery-guide.md) ──
//
//   DISCOVERY_REQUIRED: expenses table name
//   DISCOVERY_REQUIRED: row primary key column
//   DISCOVERY_REQUIRED: human id column (EXP-…) + who generates it
//   DISCOVERY_REQUIRED: column names vs SupabaseExpenseRow's provisional guess
//                       (the n8n POST already uses snake_case item_name /
//                        paid_from / created_by — LIKELY the column names,
//                        but verify, don't assume)
//   DISCOVERY_REQUIRED: amount column type (numeric→string in JSON?)
//   DISCOVERY_REQUIRED: paid_from / category stored values — must cover the
//                       app's exact option strings (see expenseContract.ts)
//   DISCOVERY_REQUIRED: review_status values + default
//   DISCOVERY_REQUIRED: created_at timezone behavior
//   Shared with orders adapter: Supabase URL/key env vars, RLS posture.
//
// ─── IMPLEMENTATION PLAN ─────────────────────────────────────────────────────
//
//   1. Phase 2C — listExpenses() only:
//        // TODO(phase-2c): real query goes here, e.g.
//        // const { data, error } = await supabase
//        //   .from(EXPENSES_TABLE /* DISCOVERY_REQUIRED */).select("*");
//        // if (error) throw error;              // reads THROW (UI has retry)
//        // return mapSupabaseExpenseRows(data); // mapper ready + sorted
//   2. Phase 2D — parity vs n8n: compareExpensesForParity in
//      src/lib/data/dev/adapterParity.ts; procedure in
//      docs/adapter-parity-testing.md. No flip before it passes.
//   3. Phase 2G — addExpense(): keep the never-throw { success, error? }
//      contract and the snake_case AddExpensePayload field names (frozen —
//      n8n automations consume them).
//
// Contract references: contracts/expenseContract.ts, contracts/adapterContract.ts.

import type { ExpenseRepository } from "./types";
import { AdapterNotImplementedError } from "./types";

const notImplemented = (method: string) =>
  new AdapterNotImplementedError("supabaseExpensesAdapter", method);

export const supabaseExpensesAdapter: ExpenseRepository = {
  listExpenses: async () => {
    // TODO(phase-2c): fetch rows → mapSupabaseExpenseRows(rows). See plan above.
    throw notImplemented("listExpenses");
  },
  addExpense: async () => {
    // TODO(phase-2g): never-throw write; payload stays snake_case.
    throw notImplemented("addExpense");
  },
};
