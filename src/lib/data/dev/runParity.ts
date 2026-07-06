// DEV TOOL ONLY — manual parity runner (Phase 2D). Imported by NOTHING in the
// app, so it never enters a production bundle.
//
// Normal way to run it:  npm run parity   (scripts/run-parity.mjs loads this
// module through Vite's SSR loader and runs it in Node — n8n Cloud blocks
// localhost browser origins by CORS, Node has no CORS).
// It also works from the browser console of `npm run dev` IF n8n CORS ever
// allows localhost:
//
//   const m = await import("/src/lib/data/dev/runParity.ts");
//   await m.runAdapterParity({ strictTimestamps: true });
//
// Prerequisites: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY in .env.local
// (anon key only). ACTIVE_READ_SOURCE / ACTIVE_WRITE_SOURCE stay "n8n" the
// whole time — calling the inactive Supabase adapter directly is the point.
// Full procedure + pass criteria: docs/adapter-parity-testing.md.

import { n8nOrdersAdapter } from "@/lib/data/adapters/n8nOrdersAdapter";
import { n8nExpensesAdapter } from "@/lib/data/adapters/n8nExpensesAdapter";
import { supabaseOrdersAdapter } from "@/lib/data/adapters/supabaseOrdersAdapter";
import { supabaseExpensesAdapter } from "@/lib/data/adapters/supabaseExpensesAdapter";
import {
  compareExpensesForParity,
  compareOrdersForParity,
  formatCoverage,
  summarizeCoverage,
  summarizeParityResult,
  type ParityCoverage,
  type ParityOptions,
  type ParityResult,
} from "./adapterParity";

/** A domain's comparison, or the fetch error that prevented it. */
export interface ParityRun {
  orders?: ParityResult;
  expenses?: ParityResult;
  /** What the day's data exercised (from the n8n reference lists). */
  coverage?: ParityCoverage;
  /** Fetch failures by source, e.g. "supabase orders" — comparison skipped. */
  fetchErrors: Record<string, string>;
}

const message = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

/**
 * Fetches both adapters for both domains, compares whatever succeeded, and
 * logs the summaries. One source failing (bad env, RLS, network) doesn't hide
 * the others — its error is logged and returned in fetchErrors instead.
 */
export async function runAdapterParity(options: ParityOptions = {}): Promise<ParityRun> {
  const [n8nOrders, sbOrders, n8nExpenses, sbExpenses] = await Promise.allSettled([
    n8nOrdersAdapter.listOrders(),
    supabaseOrdersAdapter.listOrders(),
    n8nExpensesAdapter.listExpenses(),
    supabaseExpensesAdapter.listExpenses(),
  ]);

  const run: ParityRun = { fetchErrors: {} };
  const sources: [string, PromiseSettledResult<unknown>][] = [
    ["n8n orders", n8nOrders],
    ["supabase orders", sbOrders],
    ["n8n expenses", n8nExpenses],
    ["supabase expenses", sbExpenses],
  ];
  for (const [name, result] of sources) {
    if (result.status === "rejected") {
      run.fetchErrors[name] = message(result.reason);
      console.error(`[parity] ${name} fetch FAILED — comparison skipped:`, message(result.reason));
    }
  }

  if (n8nOrders.status === "fulfilled" && sbOrders.status === "fulfilled") {
    run.orders = compareOrdersForParity(n8nOrders.value, sbOrders.value, options);
    console.log(summarizeParityResult(run.orders));
  }
  if (n8nExpenses.status === "fulfilled" && sbExpenses.status === "fulfilled") {
    run.expenses = compareExpensesForParity(n8nExpenses.value, sbExpenses.value, options);
    console.log(summarizeParityResult(run.expenses));
  }
  // Coverage: parity can pass on thin data — show what today actually proved.
  if (n8nOrders.status === "fulfilled" && n8nExpenses.status === "fulfilled") {
    run.coverage = summarizeCoverage(n8nOrders.value, n8nExpenses.value);
    console.log(formatCoverage(run.coverage));
  }
  return run;
}
