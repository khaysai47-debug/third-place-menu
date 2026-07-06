// DEV TOOL ONLY — manual parity runner (Phase 2D). Imported by NOTHING in the
// app, so it never enters a production bundle. Run it from the browser console
// of an `npm run dev` session (any page):
//
//   const m = await import("/src/lib/data/dev/runParity.ts");
//   await m.runAdapterParity();
//   await m.runAdapterParity({ strictTimestamps: true });
//
// Prerequisites: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in .env.local
// (anon key only). ACTIVE_DATA_SOURCE stays "n8n" the whole time — calling
// the inactive Supabase adapter directly is the point.
// Full procedure + pass criteria: docs/adapter-parity-testing.md.

import { n8nOrdersAdapter } from "@/lib/data/adapters/n8nOrdersAdapter";
import { n8nExpensesAdapter } from "@/lib/data/adapters/n8nExpensesAdapter";
import { supabaseOrdersAdapter } from "@/lib/data/adapters/supabaseOrdersAdapter";
import { supabaseExpensesAdapter } from "@/lib/data/adapters/supabaseExpensesAdapter";
import {
  compareExpensesForParity,
  compareOrdersForParity,
  summarizeParityResult,
  type ParityOptions,
  type ParityResult,
} from "./adapterParity";

/** Fetches both adapters for both domains, compares, and logs the summaries. */
export async function runAdapterParity(
  options: ParityOptions = {},
): Promise<{ orders: ParityResult; expenses: ParityResult }> {
  const [n8nOrders, sbOrders, n8nExpenses, sbExpenses] = await Promise.all([
    n8nOrdersAdapter.listOrders(),
    supabaseOrdersAdapter.listOrders(),
    n8nExpensesAdapter.listExpenses(),
    supabaseExpensesAdapter.listExpenses(),
  ]);
  const orders = compareOrdersForParity(n8nOrders, sbOrders, options);
  const expenses = compareExpensesForParity(n8nExpenses, sbExpenses, options);
  console.log(summarizeParityResult(orders));
  console.log(summarizeParityResult(expenses));
  return { orders, expenses };
}
