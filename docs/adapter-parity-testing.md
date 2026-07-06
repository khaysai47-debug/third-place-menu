# Adapter Parity Testing (Phase 2D)

**Status:** RUNNABLE — Phase 2C is done: `supabaseOrdersAdapter.listOrders()`
and `supabaseExpensesAdapter.listExpenses()` are implemented (reads only;
writes still throw until Phase 2G).

**Prerequisites:**

1. Add to `.env.local` (never commit values):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key — NEVER the service_role key>
```

2. The anon role must be able to SELECT the four read tables.
   ✅ DONE 2026-07-06: `GRANT SELECT ON public.orders TO anon;` and
   `GRANT SELECT ON public.order_items TO anon;` were executed, plus
   anon SELECT RLS policies (`USING (true)`) on both tables, for read parity
   testing. `payment_proofs` and `expenses` were already readable.
   (Security note: anon SELECT means anyone with the public anon key can read
   order data. This is equivalent exposure to the existing public n8n
   staff-orders GET webhook, so nothing new — but the whole RLS/security
   posture must be reviewed before real restaurant use, and writes must
   NEVER be granted to anon.)

`ACTIVE_READ_SOURCE` / `ACTIVE_WRITE_SOURCE` stay `"n8n"` throughout — the
live app never touches Supabase during parity testing.

**Goal:** prove, on the same underlying data, that the Supabase adapter's
normalized output is identical to the live n8n adapter's output — *before*
`ACTIVE_READ_SOURCE` is ever flipped.

**Tooling:** `src/lib/data/dev/adapterParity.ts` — pure compare functions,
no I/O, imported by nothing in the app. The companion human checklist is
`docs/adapter-contract-checklist.md`.

## How to run it (Node script — the normal way)

```
npm run parity              # presence-mode timestamps
npm run parity -- --strict  # strict timestamp value comparison
```

`scripts/run-parity.mjs` loads the real runner module
(`src/lib/data/dev/runParity.ts`) through Vite's SSR module loader — the same
adapters, mappers, and `.env.local` env the app would use — but executes it in
Node, where browser CORS does not apply. No new dependency; nothing enters any
bundle. Exit code 0 = both domains `ok: true`; 1 = mismatch or fetch failure.

The runner fetches both adapters for both domains, logs a summary per domain,
and reports `fetchErrors` per source. One source failing (missing env,
permission denial, network) skips only that domain's comparison — the other
still runs. A permission denial looks like
`Supabase read failed: orders responded 401` (fix: the GRANT in the
prerequisites above; an empty-but-200 result means RLS filtering — compare
counts against the staff board).

### Browser console (alternative — has a CORS catch)

The same runner works from the devtools console of an `npm run dev` session:

```js
const m = await import("/src/lib/data/dev/runParity.ts");
await m.runAdapterParity();
```

⚠️ CORS limitation: n8n Cloud does not send CORS headers for localhost
origins, so the **n8n side fails in the browser** (`blocked by CORS`) unless
the n8n webhooks set `Access-Control-Allow-Origin`. The Supabase side works
(Supabase sends permissive CORS). This is why the Node script is the normal
way; use the browser path only if n8n CORS is ever opened for localhost.
(This also means the deployed staff/owner pages work only because they are
served from an origin n8n accepts — local `/staff` against n8n Cloud fails
the same way, which is a dev-only limitation, not a production bug.)

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
   adapter *directly* (as above). `ACTIVE_READ_SOURCE` stays `"n8n"` the whole
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

## Run log

| Date | Result | Notes |
| --- | --- | --- |
| 2026-07-06 | ✅ PASS (normal AND `--strict`) | orders: 38/38 clean matches (incl. delivery, cancelled, transfer-paid, completed dine-in). expenses: 0 vs 0 — trivially equal; **must re-run on a day with real expense rows before this counts**. Strict timestamps passing means n8n passes Supabase timestamps through verbatim — no format note needed. |

Still open before the Phase 2E flip: a second day of order data, an expenses
run with real rows, a payment-proof order (none exist yet), and one walk of
the human checklist. Reads don't flip until the Phase 2E gate in
docs/backend-separation-runbook.md is fully checked; writes stay on n8n
until Phase 2G regardless.
