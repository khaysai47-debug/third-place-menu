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
then a `[coverage]` block showing what the day's data actually exercised
(statuses, order types, payment methods, proof/expense counts) and which gate
scenarios are still missing — parity can pass on thin data, coverage says how
thin. It also reports `fetchErrors` per source. One source failing (missing env,
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
the human checklist. Exact procedures below. Reads don't flip until the
Phase 2E gate in docs/backend-separation-runbook.md is fully checked; writes
stay on n8n until Phase 2G regardless.

## Final pre-flip QA — exact procedures

Work through these in order; each ends with a parity run whose `[coverage]`
block should show the corresponding gap disappearing. Log each result in the
Run log above.

### QA-1 · Real-expense parity

1. Open the deployed staff page → Expenses view, and add a small expense
   through the normal form: item name `PARITY TEST — safe to delete`,
   amount `1`, category `Other`, paid from `Cash`, note optional.
   (This is a normal n8n write — writes are on n8n, that's the point.)
2. Confirm it appears in the staff expense list and in the owner dashboard's
   expense section (manual refresh).
3. Same Bangkok day, run `npm run parity` and `npm run parity -- --strict`.
4. Expect: `[parity:expenses] OK` with counts ≥ 1 on both sides, and the
   coverage gap "no expense rows" gone. Any mismatch here is adjudicated the
   usual way — note the parity doc's "Known differences" section: the n8n
   Get Expenses output may emit keys the frontend mapper doesn't read
   (`itemName`/`createdBy`/row key) — if those mismatch, the fix is the n8n
   output mapping, not the Supabase adapter.
5. Cleanup policy: the row is ฿1 and clearly labeled — keep it until the flip
   is done (it is useful for the second-day run), then delete it in the
   Supabase Table Editor (`expenses` table; no child rows) if the owner
   doesn't want it in reports. Deleting there removes it from BOTH read paths
   (n8n reads the same database).

### QA-2 · Payment-proof parity

Verified facts (2026-07-06): there is NO production UI that adds a payment
proof — the app only displays proof fields; the `third-place-add-payment-proof`
n8n webhook exists for the future bot flow. So the safest way to create one
test row is a one-off POST to that webhook (again: a write via n8n).

1. Pick a safe test order: in the Supabase Table Editor → `orders`, choose an
   old finished test row (e.g. a July 3–5 `completed` order), and copy its
   **`id` (UUID)** — NOT `order_number`. `payment_proofs.order_id` joins on
   `orders.id`; the staff API matches `proof.order_id === order.id`.
2. POST to the webhook (PowerShell; URL base = your `VITE_N8N_BASE_URL`):

```powershell
Invoke-RestMethod -Method Post -ContentType "application/json" `
  -Uri "https://<your-n8n-host>/webhook/third-place-add-payment-proof" `
  -Body (@{
    order_id  = "<orders.id UUID>"
    proof_url = "https://example.com/parity-test-proof.jpg"
    source    = "parity-test"
    status    = "received"
    note      = "PARITY TEST - safe to delete"
  } | ConvertTo-Json)
```

   (`proof_file_path` may be omitted — n8n defaults it to `""`.)
3. Run `npm run parity`. Expect: still `OK`, the chosen order shows
   `hasPaymentProof`/`paymentProofUrl` matching on BOTH sides, and coverage
   shows `proofs=1`.
4. ⚠ This is the first time the n8n Staff Orders API's proof output is
   exercised with a real row (discovery never observed one). If parity
   MISMATCHES on proof fields, that is the test doing its job: compare the
   n8n output keys against the Supabase adapter's mapping
   (`latestPaymentProof` in orderMapper.ts) and fix whichever side is wrong —
   do not flip until clean.
5. Optional visual check: the staff order card and owner order detail should
   show the proof link (deployed app, since local n8n reads are CORS-blocked).
6. Cleanup: delete the row in Supabase Table Editor → `payment_proofs`
   (find it by `source = 'parity-test'`; it has no child rows). Keep it until
   after the flip verification if convenient.

### QA-3 · Second-day parity

1. On a different service day with fresh orders (ideally: ≥1 dine-in,
   ≥1 delivery, ≥1 cancelled, one cash-paid, one transfer-paid — the
   `[coverage]` block tells you what the day actually contains), run both
   `npm run parity` and `npm run parity -- --strict` in a quiet moment
   (not while orders are actively arriving — risk register #9).
2. Expect `ok: true` on both domains. Log the run (date, counts, coverage
   gaps remaining) in the Run log above.

### QA-4 · RLS / security review (decision, not code)

Current state (2026-07-06): anon has SELECT on all four read tables
(`orders`/`order_items` granted + permissive `USING (true)` policies for
parity; `payment_proofs`/`expenses` were already readable). **No anon writes
exist — keep it that way.** Exposure today equals the public n8n
staff-orders GET webhook, so the flip makes nothing worse.

Before REAL restaurant use (regardless of flip), decide and record here:

- [ ] Is public read of all orders acceptable long-term? (Likely no —
      customer PII: names, phones, addresses.)
- [ ] Options, in increasing effort: stricter RLS policies; staff/owner
      auth (password/session) in front of the dashboards; moving Supabase
      reads behind a backend API so the anon key disappears from the
      browser entirely (pairs with the Phase 2G write decision).
- [ ] Also applies to n8n: the staff-orders GET webhook is equally public —
      any fix should cover both, or retire the n8n read path (Phase 2H).

Do not implement auth as part of the flip — it is a separate, deliberate
change. The flip only requires confirming: anon = read-only, service_role
lives only in n8n, no secrets in the repo.
