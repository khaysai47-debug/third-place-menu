# Adapter Parity Testing (Phase 2D)

**Status:** RUNNABLE — Phase 2C is done: `supabaseOrdersAdapter.listOrders()`
and `supabaseExpensesAdapter.listExpenses()` are implemented (reads only;
writes still throw until Phase 2G).

**Prerequisites:** add to `.env.local` (never commit values):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key — NEVER the service_role key>
```

`ACTIVE_DATA_SOURCE` stays `"n8n"` throughout — the live app never touches
Supabase during parity testing.

**Goal:** prove, on the same underlying data, that the Supabase adapter's
normalized output is identical to the live n8n adapter's output — *before*
`ACTIVE_DATA_SOURCE` is ever flipped.

**Tooling:** `src/lib/data/dev/adapterParity.ts` — pure compare functions,
no I/O, imported by nothing in the app. The companion human checklist is
`docs/adapter-contract-checklist.md`.

## How to run it

This repo is a Vite browser app with no Node script runner (no tsx/ts-node,
no `test` script), and the adapters read `import.meta.env.VITE_*` — they only
run inside the Vite dev server. The runner is
`src/lib/data/dev/runParity.ts` — imported by nothing in the app, so it never
enters a production bundle.

With `npm run dev` running, open any page and paste into the browser console:

```js
const m = await import("/src/lib/data/dev/runParity.ts");
await m.runAdapterParity();                            // presence-mode timestamps
await m.runAdapterParity({ strictTimestamps: true });  // once formats verified
```

It fetches both adapters for both domains, logs the two summaries, and returns
the raw `ParityResult`s for closer inspection.

## Known differences to expect on the first run

Adjudicate these per step 5 below — they are documented, not surprises:

- **Expenses `itemName` / `createdBy` / `id(rowKey)`**: discovery found the
  current n8n Get Expenses output emits `description`/`staff_name` keys and no
  `id`/`item_name`/`created_by`, while the frontend mapper reads the latter —
  so the n8n reference may show `itemName: ""`, `createdBy: null`, and a
  missing row key. The Supabase adapter maps the real columns
  (`description` → itemName, `staff_name` → createdBy, `id` → row key), which
  is the *correct* data. If parity flags these, the fix is in the n8n Get
  Expenses output mapping (upstream), not in the Supabase adapter.
- **Order item ordering**: the Supabase adapter orders lines by
  `order_items.created_at`; if n8n emits a different line order, per-index
  item mismatches appear even though the sets are identical.

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
   (Nothing to delete: the runner lives in `src/lib/data/dev/` and is never
   bundled; it stays as regression tooling.)

## Pass criteria

- `ok: true` for both domains, on at least two different days of data.
- One run with `strictTimestamps: true` passing, or a written note explaining
  the accepted timestamp format difference.
- The human checklist (docs/adapter-contract-checklist.md) also walked once.
