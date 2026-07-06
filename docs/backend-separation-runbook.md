# Backend Separation Runbook — Phases 2B → 2H

**Status:** runbook — the checklist actually followed during migration.
Background/architecture lives in `docs/backend-separation-map.md`; data
contracts in `src/lib/data/contracts/`; parity procedure in
`docs/adapter-parity-testing.md`.

**Standing rules for every phase below:**

- The data-source switch is SPLIT (Phase 2E prep): `ACTIVE_READ_SOURCE` stays
  `"n8n"` until the Phase 2E gate passes, and only reads flip then;
  `ACTIVE_WRITE_SOURCE` stays `"n8n"` until Phase 2G — NEVER set it to
  "supabase" while the Supabase write methods are stubs.
- No n8n URL/slug changes at any point (`src/lib/n8n.ts` is live production).
- Owner dashboard stays manual-refresh-only; staff keeps its 5s poll. Polling
  changes are product decisions, never migration side effects.
- One phase per commit (or more), never two phases in one commit.

---

## Phase 2B — Schema discovery  *(no code changes)*

- Follow `docs/schema-discovery-guide.md` in n8n Cloud
  (https://shanchin.app.n8n.cloud) — read-only inspection of workflows +
  executions.
- Output: filled worksheet → `docs/schema-discovery-notes.md`.
- Exit criteria: every `DISCOVERY_REQUIRED` marker in
  `supabaseOrdersAdapter.ts` / `supabaseExpensesAdapter.ts` /
  `orderMapper.ts` / `expenseMapper.ts` / `normalize.ts` has an answer or an
  explicit `NOT FOUND`.

## Phase 2C — Implement Supabase READ adapter behind the inactive switch  *(DONE 2026-07-06)*

- Client: `src/lib/data/supabase.ts` — a plain-fetch PostgREST SELECT helper,
  deliberately **no `@supabase/supabase-js` dependency** (two REST reads don't
  justify it; revisit at Phase 2G if writes/auth/realtime demand the SDK).
  Env is read lazily per-request, so the app builds and runs without Supabase
  env while `ACTIVE_READ_SOURCE` is `"n8n"`; calling the adapter without env
  throws a clear developer error.
- Env vars (in `.env.local`, values never committed):
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (anon key ONLY — the
  service-role key stays in n8n; RLS posture still to confirm before 2E).
- `SupabaseOrderRow` / `SupabaseExpenseRow` aligned with the worksheet;
  `DB_STATUS_USES_COMPLETED = true` (verified: DB stores "completed", never
  "done"). orderKey = `orders.order_number` ("TP-…"), NOT the row UUID —
  the n8n write workflows match by order_number, so this keeps staff actions
  working during the mixed phase (Supabase reads + n8n writes).
- ONLY `listOrders()` and `listExpenses()` implemented (reads throw on
  failure). All writes remain `AdapterNotImplementedError` stubs.
- The data-source switch remains `"n8n"` — production is untouched by this commit.
- Exit criteria: app builds; live app behavior unchanged; Supabase reads
  callable directly in dev. ✓

## Phase 2D — Side-by-side parity comparison  *(no flip yet)*

**Status 2026-07-06: first-day parity PASSED** — `npm run parity` and
`npm run parity -- --strict` both `ok: true`: orders 38/38 clean matches,
expenses 0 vs 0 (trivially — re-test on a day with real expense rows).
Supabase-side setup done for read parity: `GRANT SELECT` + permissive anon
SELECT RLS policies (`USING (true)`) on `orders` and `order_items`.
⚠️ Revisit the RLS/security posture before real restaurant use — current anon
read exposure equals the existing public n8n staff-orders GET, but it was
enabled for testing, not decided for production. `ACTIVE_READ_SOURCE` and
`ACTIVE_WRITE_SOURCE` remain `"n8n"`; reads flip only via the Phase 2E gate
below; writes stay on n8n until Phase 2G.

Remaining before the 2E gate: second day of data, expenses with real rows,
a payment-proof order, one walk of docs/adapter-contract-checklist.md.

- Run the full procedure in `docs/adapter-parity-testing.md` — normally
  `npm run parity` (Node script `scripts/run-parity.mjs`, avoids browser
  CORS against n8n Cloud); compare functions live in
  `src/lib/data/dev/adapterParity.ts`.
- Also walk the human checklist `docs/adapter-contract-checklist.md`.
- Exit criteria: `ok: true` for orders AND expenses on ≥2 different days of
  real data, including delivery / cancelled / transfer-paid / proof orders;
  every mismatch explained and fixed at the adapter (never in the UI).

## Phase 2E — Flip READS only

### Must ALL pass before flipping (gate)

Exact procedures for the first four: docs/adapter-parity-testing.md
§ "Final pre-flip QA" (QA-1…QA-4). The parity runner's `[coverage]` block
tracks which scenarios are still unexercised.

- [x] **QA-1 real-expense parity** — ✅ DONE 2026-07-06: expenses 1/1 clean
      (normal and `--strict`). Along the way: `expenses` needed its own anon
      GRANT + RLS policy, and the n8n-output/frontend-mapper key drift was
      fixed in the live mapper (blank expense names repaired) — details in
      the parity doc's Run log + "Known differences".
- [ ] **QA-2 payment-proof parity** — one proof row inserted via the n8n
      Add Payment Proof webhook (order keyed by `orders.id` UUID), proof
      fields matching on both sides. First real exercise of the n8n proof
      output — mismatches here are fixed before flipping (risk register #6).
- [ ] **QA-3 second-day parity** — `ok: true` both domains on a different
      day of real data; coverage ideally shows dine-in + delivery +
      cancelled + cash + transfer.
- [ ] **QA-4 RLS/security review** — decision recorded; confirmed anon =
      read-only SELECT on the four read tables, no anon writes, service_role
      only inside n8n. (Full auth hardening is a separate pre-production
      task, not part of the flip.)
- [ ] One `{ strictTimestamps: true }` run passing, or a written note in the
      parity doc explaining the accepted timestamp format difference.
- [ ] Every parity mismatch adjudicated: adapter bugs fixed, upstream n8n
      output gaps fixed in n8n (the expenses `itemName`/`createdBy`/row-key
      gaps listed in the parity doc), nothing papered over in the UI.
- [ ] Human checklist docs/adapter-contract-checklist.md walked once.
- [ ] Vercel project env has ALL THREE (values from the password manager,
      never from the repo): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
      (anon public key — NEVER service_role/sb_secret), and the existing
      `VITE_N8N_BASE_URL` (writes still go to n8n after the flip!).
- [ ] `npm run build` and `npm run typecheck` pass.

### The flip itself (one small commit)

The read/write switch split already exists (`src/lib/data/dataSource.ts`,
done as Phase 2E prep). The flip is:

1. Set `ACTIVE_READ_SOURCE = "supabase"` in `src/lib/data/dataSource.ts`.
   `ACTIVE_WRITE_SOURCE` stays `"n8n"` — do NOT touch it; the Supabase write
   methods are throwing stubs, so flipping it breaks every staff action.
2. `npm run build` and `npm run typecheck` must pass.
3. `npm run parity` one final time the same day — fresh proof that both
   sources agree at the moment of the flip.
4. Local smoke test (`npm run dev`): staff board, owner dashboard (manual
   refresh), customer menu render; a status update still works (n8n write).
   Note: after this flip local READS come from Supabase and work locally;
   local n8n WRITES may still be CORS-blocked from localhost — deployed
   verification (step 6) is where writes are properly confirmed.
5. Confirm the Vercel env gate item (all three `VITE_*` vars), then deploy.
6. Verify on the deployed Vercel app: run the "Test immediately after
   flipping" list below.
7. Nothing to delete: the parity runner lives in `src/lib/data/dev/` and is
   imported by nothing in the app, so it ships nowhere.

### Test immediately after flipping

- Staff board renders the same orders as before the flip (spot-check counts
  and one delivery + one cancelled order's fields).
- Owner dashboard (manual refresh only — unchanged): Today totals, payment
  mix, cancelled-today count match the pre-flip values on the same data.
- Expense view shows today's expenses; owner Net Today unchanged.
- ALL writes still work via n8n: advance a status, cancel with reason,
  record a payment, add an expense — and the n8n automations behind them
  (notifications) demonstrably still fire.
- Payment proof visibility: the QA-2 test proof (if kept) still shows its
  link on the staff card / owner order detail, and the link opens.
- Customer menu + checkout untouched and working (they never used the
  repository read path).

### Do NOT touch in this phase

- Writes (Phase 2G), order intake `submitOrder` (last of all, maybe never).
- n8n URLs/slugs (`src/lib/n8n.ts`), owner manual-refresh, staff 5s poll.
- Menu availability (stays on n8n until its own phase).

### Rollback (instant)

- Set `ACTIVE_READ_SOURCE` back to `"n8n"` in `src/lib/data/dataSource.ts`,
  redeploy. The n8n read webhooks stay alive until Phase 2H exactly for this.
- Capture what forced the rollback in the risk register before retrying.

## Phase 2F — Production-like read testing

- Run the app against real data for several service days without code changes.
- Watch: order counts vs n8n, owner daily totals (gross, net, payment mix),
  cancelled-order exclusion, delivery fee display, proof links opening.
- Keep the n8n read webhooks alive as the instant rollback path.
- Exit criteria: a written "reads are stable" note with dates; no unexplained
  discrepancies.

## Phase 2G — Migrate writes, separately and one at a time

- Order: `updateOrderStatus` (+ cancellation fields) → `updateOrderPayment`
  → `addExpense` → menu availability → `submitOrder` last (or intake stays on
  n8n permanently — bots and notifications hang off it).
- Every write keeps the never-throw `{ success, error? }` contract and is
  keyed by row id.
- CAUTION: n8n automations (notifications, bot replies) currently trigger off
  n8n writes. Before moving any write, confirm what downstream automation
  listens to it and re-point that automation (e.g. Supabase trigger → n8n
  webhook) first.
- Exit criteria per write: parity of resulting rows + the automation that
  depended on it demonstrably still fires.

## Phase 2H — n8n keeps the automation jobs (end state)

- n8n permanently retains: Instagram/Messenger/LINE/WeChat bot conversations,
  payment-proof intake (writes proof fields the dashboard reads), customer
  notifications, other automation.
- n8n stops being the app's query engine; dashboard reads/writes are Supabase.
- Retire dead read/write webhooks + the n8n adapters only after a full stable
  period, in their own cleanup commit.

---

## Rollback plan (any phase, any time)

1. Set `ACTIVE_READ_SOURCE` back to `"n8n"` in `src/lib/data/dataSource.ts`
   (one line; if `ACTIVE_WRITE_SOURCE` was ever flipped too — Phase 2G+ —
   revert it the same way).
2. Redeploy. Nothing else changes — the n8n adapters were never modified.
3. Writes: unchanged if rollback happens before 2G; if a write was migrated,
   revert that write's switch too — the n8n write path is kept intact until 2H.
4. Owner dashboard manual refresh and staff polling were never touched, so no
   behavioral rollback is needed there.
5. Post-rollback: capture the parity mismatch/failure that forced it into the
   risk register below before retrying.

---

## Risk register

| # | Risk | Prevention | Test that catches it |
| --- | --- | --- | --- |
| 1 | **Status vocabulary mismatch** — DB stores values the app doesn't know (e.g. `completed`, or something new) | Discovery step 3 captures exact values; `normalizeOrderStatus` maps known aliases explicitly and falls back to `new`, never to done/cancelled; `DB_STATUS_USES_COMPLETED` set from evidence | Parity: `status` compared by value on every order; a wrong status also shows as an order stuck in "New" |
| 2 | **Item JSON vs item table difference** — items stored differently than assumed, orders render with 0 items | Discovery step 1 answers jsonb-vs-table; `parseOrderItems` returns `[]` (never phantom lines) on shape surprise | Parity: `items.length` + per-line name/quantity/unitPrice checks |
| 3 | **Timezone/date mismatch** — Supabase timestamps in UTC vs Airtable local, owner "today" windows shift | Discovery step 8 copies a real timestamp verbatim; keep timestamps as raw ISO strings through the mapper (no reformatting) | Parity with `strictTimestamps: true`; manual check that an order placed "now" appears in owner Today on both sources |
| 4 | **Money string vs number** — Postgres numeric serializes as `"150.00"`, totals become 0 or NaN | `normalizeMoney` accepts clean numeric strings, rejects formatted junk to 0 (loud in diffs); discovery step 9 confirms column types | Parity: `totalPrice`/`subtotalPrice`/`deliveryFee`/`amount`/`unitPrice` compared by value |
| 5 | **cancelled/delivered/done vocabulary drift** — `delivered` merged into `done` or cancel writes a different value | Contract forbids merging (orderContract.ts §1, §8); cancel flow columns captured in discovery step 3 | Parity on a day containing delivery + cancelled orders; owner Cancelled-Today count matches |
| 6 | **Payment proof storage mismatch** — proof is a Storage bucket path/attachment, not a URL column; links 404 | Discovery step 6 identifies the real storage; mapper only ever emits a usable URL or `undefined` (never a raw bucket path) | Parity: `hasPaymentProof`/`paymentProofUrl` by value; manually click one proof link from Supabase data |
| 7 | **Expenses table mismatch** — column names differ from the POST payload's snake_case guess | Discovery step 7 verifies instead of assuming; `SupabaseExpenseRow` aligned before any query is written | Parity on expenses; unknown paidFrom/category surfacing as "Other" spike is the visible symptom |
| 8 | **Owner report totals mismatch** — subtle field drift (paidAt fallback, cancelled exclusion) shifts money numbers | All totals are pure frontend math over the normalized shape — parity on the shape implies parity on totals; no total logic changes during migration | Same-day owner dashboard opened against both sources (dev vs prod): gross, net, payment mix, best sellers identical |
| 9 | **n8n and Supabase temporarily disagreeing** — comparing while orders are actively arriving produces false mismatches; or during dual-running, one side is stale | Run parity in a quiet window; re-run on mismatch before investigating; never cache one side's fetch | `missingInCandidate`/`extraInCandidate` lists in the parity result make in-flight rows identifiable by orderId |
| 10 | **Writes migrated too early** — a write moves to Supabase before the n8n automation that listened to it is re-pointed; notifications/bot replies silently stop | Hard phase gate: writes only in 2G, one at a time, each with an automation-dependency check first; write methods stay throwing stubs until then | After each write migration: perform the action, then verify the downstream automation fired (notification received, proof flow works) |
