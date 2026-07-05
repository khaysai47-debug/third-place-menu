# Adapter Parity Testing (Phase 2D)

**Status:** procedure skeleton — the Supabase side does not exist yet, so this
cannot be run today. It becomes runnable the moment `supabaseOrdersAdapter.listOrders()`
/ `supabaseExpensesAdapter.listExpenses()` are implemented (Phase 2C).

**Goal:** prove, on the same underlying data, that the Supabase adapter's
normalized output is identical to the live n8n adapter's output — *before*
`ACTIVE_DATA_SOURCE` is ever flipped.

**Tooling:** `src/lib/data/dev/adapterParity.ts` — pure compare functions,
no I/O, imported by nothing in the app. The companion human checklist is
`docs/adapter-contract-checklist.md`.

## Why there is no `scripts/compare-adapters.ts`

This repo is a Vite browser app with no Node script runner (no tsx/ts-node,
no `test` script), and the adapters read `import.meta.env.VITE_*` — they only
run inside the Vite dev server. So the comparison runs as **dev-scratch code
inside the running app**, not as a standalone script. Two supported ways:

### Option A — temporary dev-only route (recommended)

Create a scratch route (e.g. `src/routes/dev-parity.tsx`) that is **never
linked from any screen and is deleted before the flip commit**:

```tsx
// TEMPORARY — delete before flipping ACTIVE_DATA_SOURCE.
import { createFileRoute } from "@tanstack/react-router";
import { n8nOrdersAdapter } from "@/lib/data/adapters/n8nOrdersAdapter";
import { supabaseOrdersAdapter } from "@/lib/data/adapters/supabaseOrdersAdapter";
import { n8nExpensesAdapter } from "@/lib/data/adapters/n8nExpensesAdapter";
import { supabaseExpensesAdapter } from "@/lib/data/adapters/supabaseExpensesAdapter";
import {
  compareOrdersForParity,
  compareExpensesForParity,
  summarizeParityResult,
} from "@/lib/data/dev/adapterParity";

async function runParity() {
  const [n8nOrders, sbOrders] = await Promise.all([
    n8nOrdersAdapter.listOrders(),
    supabaseOrdersAdapter.listOrders(),
  ]);
  console.log(summarizeParityResult(compareOrdersForParity(n8nOrders, sbOrders)));

  const [n8nExpenses, sbExpenses] = await Promise.all([
    n8nExpensesAdapter.listExpenses(),
    supabaseExpensesAdapter.listExpenses(),
  ]);
  console.log(summarizeParityResult(compareExpensesForParity(n8nExpenses, sbExpenses)));
}

export const Route = createFileRoute("/dev-parity")({
  component: () => <button onClick={runParity}>Run parity (see console)</button>,
});
```

### Option B — browser console in `npm run dev`

Import the same functions from any dev-loaded module scope (e.g. temporarily
expose them on `window` from a screen you have open) and run the same snippet.
Option A is cleaner; use B only for quick re-checks.

## Full procedure (do all six, in order)

1. **Fetch current n8n output** — `n8nOrdersAdapter.listOrders()` /
   `n8nExpensesAdapter.listExpenses()` (this is exactly what production shows).
2. **Fetch Supabase output behind the inactive adapter** — call the Supabase
   adapter *directly* (as above). `ACTIVE_DATA_SOURCE` stays `"n8n"` the whole
   time; calling the inactive adapter directly is the point.
3. **Normalize both** — automatic: both adapters return normalized shapes.
   If you find yourself massaging data *outside* an adapter to make parity
   pass, the adapter is wrong — fix it there.
4. **Compare parity** — `compareOrdersForParity` / `compareExpensesForParity`,
   then `summarizeParityResult`. Timestamps are compared by presence first;
   re-run with `{ strictTimestamps: true }` once formats are confirmed equal.
5. **Review mismatches** — every line in the summary is either (a) a Supabase
   adapter/mapper bug → fix and re-run, or (b) a real upstream data difference
   → resolve in the n8n/Supabase workflow first. Zero unexplained lines is the
   bar. Check counts on a day with real variety: delivery + cancelled +
   paid-by-transfer + payment-proof orders.
6. **Only then flip reads** — Phase 2E in docs/backend-separation-runbook.md.
   Delete the scratch route in the same commit.

## Pass criteria

- `ok: true` for both domains, on at least two different days of data.
- One run with `strictTimestamps: true` passing, or a written note explaining
  the accepted timestamp format difference.
- The human checklist (docs/adapter-contract-checklist.md) also walked once.
