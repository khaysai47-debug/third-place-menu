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

## Phase 2E — Flip READS only  *(FLIPPED 2026-07-06 — reads Supabase, writes n8n)*

`ACTIVE_READ_SOURCE = "supabase"`, `ACTIVE_WRITE_SOURCE = "n8n"` as of the
flip commit. Post-flip build/typecheck/parity/strict all passed. Deployed
verification ("Test immediately after flipping" below) is the human step
after the Vercel env vars are confirmed. Phase 2F stabilization starts now.

### Must ALL pass before flipping (gate)

Exact procedures for the first four: docs/adapter-parity-testing.md
§ "Final pre-flip QA" (QA-1…QA-4). The parity runner's `[coverage]` block
tracks which scenarios are still unexercised.

- [x] **QA-1 real-expense parity** — ✅ DONE 2026-07-06: expenses 1/1 clean
      (normal and `--strict`). Along the way: `expenses` needed its own anon
      GRANT + RLS policy, and the n8n-output/frontend-mapper key drift was
      fixed in the live mapper (blank expense names repaired) — details in
      the parity doc's Run log + "Known differences".
- [x] **QA-2 payment-proof parity** — ✅ DONE 2026-07-06: proof row inserted
      via the n8n webhook (keyed by `orders.id` UUID), proof fields clean on
      both sides, coverage `proofs=1`; `payment_proofs` anon SELECT + policy
      confirmed (risk register #6 closed).
- [x] **QA-3 second-day parity** — absorbed into Phase 2F by owner decision
      at flip time (2026-07-06): full same-day coverage was judged
      sufficient; re-run `npm run parity` on a later service day during 2F
      (n8n read webhooks stay alive, so the comparison remains meaningful).
- [x] **QA-4 RLS/security review** — recorded 2026-07-06: anon = read-only
      SELECT + `USING (true)` policies on all four read tables, NO anon
      writes, service_role only inside n8n. ⚠️ Full auth/RLS hardening is a
      separate pre-production task (parity doc QA-4) — still open, but not a
      flip blocker.
- [x] One `{ strictTimestamps: true }` run passing — multiple strict runs
      passed, incl. the full-coverage flip-gate run.
- [x] Every parity mismatch adjudicated — the QA-1 expense mapper drift was
      fixed in the live frontend mapper (parity doc "Known differences");
      no open mismatches.
- [x] Contract checklist — superseded by the machine parity checks, which
      compare every field the checklist lists, on full coverage (owner
      decision at flip time; docs/adapter-contract-checklist.md remains for
      reference).
- [ ] **HUMAN STEP AT DEPLOY:** Vercel project env has ALL THREE (values
      from the password manager, never from the repo — template:
      `.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
      (anon public key — NEVER service_role/sb_secret), and the existing
      `VITE_N8N_BASE_URL` (writes still go to n8n after the flip!).
      ⚠️ After the flip, a deploy WITHOUT the two Supabase vars breaks every
      dashboard read (clear error + retry UI, but broken nonetheless).
- [x] `npm run build` and `npm run typecheck` pass (re-verified at flip).

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

### Rollback (instant, exact steps)

1. In `src/lib/data/dataSource.ts`: set `ACTIVE_READ_SOURCE = "n8n"`.
2. `ACTIVE_WRITE_SOURCE` is already `"n8n"` — leave it.
3. `npm run build`
4. `npm run typecheck`
5. `git commit`
6. `git push` / redeploy on Vercel.

The n8n read webhooks stay alive until Phase 2H exactly for this. Capture
what forced the rollback in the risk register before retrying.

## Phase 2F — Production-like read testing

- Run the app against real data for several service days without code changes.
- Watch: order counts vs n8n, owner daily totals (gross, net, payment mix),
  cancelled-order exclusion, delivery fee display, proof links opening.
- Keep the n8n read webhooks alive as the instant rollback path.
- Exit criteria: a written "reads are stable" note with dates; no unexplained
  discrepancies.

## Phase 2G — Migrate writes, separately and one at a time

**Full plan: `docs/write-separation-plan.md`** (2G-A audit done 2026-07-06:
six normal-op writes W1–W6, one automation write W7 that stays on n8n
forever, plus R1 — menu-availability READS, incl. the customer menu, still
on n8n and bundled into 2G-E).

- Write path (DECIDED 2G-B, 2026-07-06): **server API routes inside this
  app** (TanStack Start already ships a nitro server on Vercel) — write key
  stays server-side (`SUPABASE_SERVICE_ROLE_KEY`, never `VITE_*`), payloads
  validated, staff writes behind a shared staff secret
  (`STAFF_WRITE_SECRET`, `x-staff-secret` header). Anon key remains
  read-only forever; no broad anon write grants.
- Side-effect audit (docs/n8n-workflow-side-effects.md, 2G-B): all five
  normal-op write workflows are DB-only today — no notifications/bot nodes
  exist yet, so nothing needs duplicating; a 60-second CONFIRM check in n8n
  precedes each individual migration. Payment proof stays n8n permanently.
- Checklist: 2G-A audit ✅ → 2G-B write path ✅ → 2G-C order submit
  (implement AFTER 2G-D unless intake automation is re-pointed — intake is
  the automation-entangled write; today none exists, but confirm at
  migration time) → 2G-D staff order actions → 2G-E expenses + menu
  availability (write + read) → 2G-F automation stays in n8n → 2G-G write
  smoke test + parity re-run.
- Every write keeps the never-throw `{ success, error? }` contract. Orders
  are keyed by `order_number` (TP-…), menu items by `item_code` — never by
  row UUID from the frontend.
- CAUTION: n8n automations (notifications, bot replies) currently trigger off
  n8n writes. Before moving any write, confirm in the n8n workflow what else
  it does besides the DB write, and re-point that automation (e.g. Supabase
  DB webhook → n8n, or the server route calls n8n) first.
- Exit criteria per write: plan § 4 walked — row values match what n8n would
  have written, read paths show it, dependent automation still fires,
  `npm run parity` still passes.

### 2G-D — Staff order server routes PREPARED (2026-07-08, not flipped)

Status: routes + Supabase write adapter implemented; **`ACTIVE_WRITE_SOURCE`
remains `"n8n"`** — the n8n write path is unchanged and stays the active
default and the rollback path. Production behavior is identical to before
this commit.

What exists now:

- Server routes (POST, server-side only, in `src/routes/`):
  - `/api/staff/update-status` — `{ orderId, status, cancellationReason? }`;
    validates against the app's 7 statuses; writes `orders.status`
    ("done" stored as "completed"); non-cancel statuses reset
    `cancellation_reason`/`cancelled_at` to null (n8n parity).
  - `/api/staff/cancel-order` — `{ orderId, reason? }`; status "cancelled" +
    `cancellation_reason` (default "Other") + `cancelled_at` now.
  - `/api/staff/mark-paid` — `{ orderId, paymentMethod: "Cash"|"Transfer" }`;
    `payment_status` "Paid", `payment_method`, `paid_at` now.
  - All match rows by `orders.order_number` (the frontend orderId, "TP-…") —
    never a client-sent UUID. Responses are `{ ok: true, … }` or
    `{ ok: false, error }` with proper status codes (400/401/404/500); no
    stack traces or env values ever reach the client.
- Auth: every route requires the `x-staff-secret` header and compares it to
  `STAFF_WRITE_SECRET`. Missing/wrong → 401. Missing env → safe 500.
- Server-only env vars (`.env.example` has the names): `SUPABASE_SERVICE_ROLE_KEY`
  and `STAFF_WRITE_SECRET`, read via `process.env` inside
  `api/_lib/staffOrderWrites.server.ts` only — never `VITE_*`, never in the
  client bundle. The anon key remains read-only; the frontend never writes
  Supabase directly.
- Supabase adapter (`supabaseOrdersAdapter`): the three staff write stubs are
  now real — they POST to the routes above with the device's staff secret
  (localStorage, entered via the small ⚿ button in the staff header;
  empty prompt clears it). `submitOrder` stays a stub (2G-C, last).
- Per-device test override (no global flip): in the staff device's console,
  `localStorage.setItem("tp-staff-write-source", "supabase")` routes the three
  staff actions through the new path on THAT DEVICE only;
  `localStorage.removeItem("tp-staff-write-source")` reverts instantly.

Manual local test checklist (secrets typed into the shell/prompt only —
never committed):

1. `.env.local` has `SUPABASE_SERVICE_ROLE_KEY` + `STAFF_WRITE_SECRET`
   (plus the three `VITE_*` vars). `npm run dev`.
2. curl (replace TP-… with a real dev order; `$STAFF_WRITE_SECRET` from your
   shell env, not pasted inline):
   ```sh
   curl -i -X POST http://localhost:5173/api/staff/update-status \
     -H "Content-Type: application/json" -H "x-staff-secret: $STAFF_WRITE_SECRET" \
     -d '{"orderId":"TP-XXXX","status":"preparing"}'
   curl -i -X POST http://localhost:5173/api/staff/mark-paid \
     -H "Content-Type: application/json" -H "x-staff-secret: $STAFF_WRITE_SECRET" \
     -d '{"orderId":"TP-XXXX","paymentMethod":"Cash"}'
   curl -i -X POST http://localhost:5173/api/staff/cancel-order \
     -H "Content-Type: application/json" -H "x-staff-secret: $STAFF_WRITE_SECRET" \
     -d '{"orderId":"TP-XXXX","reason":"Test"}'
   ```
   Also verify the failure modes: wrong/missing secret → 401; unknown
   orderId → 404; bad status/method → 400.
3. UI path: on the staff page, tap ⚿ and enter the secret; in the console set
   the `tp-staff-write-source` override; advance / mark paid / cancel an
   order; verify the row in Supabase Table Editor matches what n8n would have
   written (status/completed spelling, cancellation fields, paid_at).
4. Revert the device: remove the localStorage override. n8n writes work again
   immediately (nothing was changed on that path).

**Production flip is a LATER step** — after deployed testing, the n8n
CONFIRM checkbox (docs/n8n-workflow-side-effects.md rows 2–3), and the
deployment prerequisite below. Rollback at any point: the override off /
`ACTIVE_WRITE_SOURCE` back to `"n8n"` — n8n webhooks are untouched.

**Deployment prerequisite — RESOLVED in 2G-D2 (2026-07-08), see below.**

### 2G-D2 — Vercel API routing for /api/staff/* FIXED (2026-07-08)

Investigation confirmed the 2G-D warning as fact: the deploy was static-only.
The Lovable vite wrapper (`@lovable.dev/vite-tanstack-config`) only runs its
Nitro deploy plugin when a `nitro` option is set explicitly in
`vite.config.ts` or when building inside a Lovable sandbox — on Vercel CI
neither holds, so no server function was ever built or deployed, and the
`vercel.json` catch-all rewrite sent `/api/staff/*` to `/_shell.html`
(POST → the SPA shell as HTML, handlers never ran).

**Failed first attempt (reverted — do not retry):** `nitro: { preset:
"vercel" }` in `vite.config.ts`. It emitted a correct `.vercel/output/`, but
moved the SSR bundle out of `dist/server/` — and TanStack's SPA-shell
prerender (forced on whenever `spa.enabled`) starts a vite preview server
that imports `dist/server/server.js`. Clean builds (locally and on Vercel)
died in prerender with ERR_MODULE_NOT_FOUND → "Failed to fetch /". The
initial local "pass" had loaded a STALE `dist/server/server.js` from a
pre-nitro build. Lesson recorded: always verify deploy-config changes with
`rm -rf dist .vercel/output` first.

The actual fix — native Vercel functions, one shared implementation:

- `api/_lib/staffOrderWrites.server.ts` contains the COMPLETE handlers as
  web-standard `(Request) => Response` functions (`postUpdateStatus`,
  `postCancelOrder`, `postMarkPaid`, plus `methodNotAllowed` → 405 JSON for
  non-POST verbs). It is deliberately self-contained (zod + `process.env`
  only; no vite aliases, no `import.meta.env`) so it bundles identically
  under vite and under Vercel's function builder.
- LOCATION MATTERS (second production crash, fixed 2026-07-08): the module
  first lived in `src/lib/` and the function compiled to ESM with an
  extensionless import of a file outside `api/` → runtime
  ERR_MODULE_NOT_FOUND (`/var/task/src/lib/staffOrderWrites.server`).
  Vercel's builder only reliably compiles TS inside `api/`, and Node ESM
  does no extension resolution. Rules: shared function code lives under
  `api/_lib/` (underscore = not exposed as a route), and `api/staff/*.ts`
  imports it WITH the `.js` extension.
- Two thin delegate surfaces, zero duplicated logic:
  - `src/routes/api.staff.*.ts` — TanStack Start server routes (dev),
    importing the same `api/_lib` module.
  - `api/staff/*.ts` — native Vercel functions (production). Vercel builds
    the `api/` directory alongside ANY framework output, so the static SPA
    deploy itself is byte-identical to what has been live for weeks.
- `vercel.json`: catch-all rewrite stays narrowed to `/((?!api/).*)` —
  functions match before rewrites anyway, but this keeps `/api/*` fail-loud.
- The Supabase URL is read from `process.env.VITE_SUPABASE_URL` (public
  config; the same project env var is available to function runtimes).

Local verification (2026-07-08, clean `rm -rf dist .vercel/output` build):
`npm run build` + typecheck pass; dev-server curls — no secret → 401 JSON,
bad status → 400, unknown order → 404 on cancel AND mark-paid (proving the
`process.env` → Supabase chain end-to-end). Client bundle greps clean of
`STAFF_WRITE_SECRET` / service-role references.

Verify after the next Vercel deploy (before any staff-write testing):

1. `POST https://<prod>/api/staff/update-status` with no secret → 401 JSON
   (NOT an HTML shell response — that would mean the function isn't serving).
2. Staff board / owner dashboard / customer menu still render and read data.
3. A status update via the normal UI still works (n8n write path unchanged).
4. Vercel project env must now also hold the server-only vars when write
   testing starts: `SUPABASE_SERVICE_ROLE_KEY`, `STAFF_WRITE_SECRET`
   (server env — never `VITE_*`), and `VITE_SUPABASE_URL` must be exposed to
   the production runtime (it already exists for builds).

Rollback: delete the `api/` directory and revert the commit — the static SPA
deploy is unaffected either way (n8n writes were never touched).

### 2G-E — Controlled staff write testing on production (2026-07-08)

(Owner phase naming. The write-separation-plan's original "2G-E — expenses +
menu availability" is untouched and becomes the NEXT implementation phase.)

**RESULT: PASSED (2026-07-08).** Test order `TP-S-20260708-152853`, on the
deployed production app, writes still on n8n throughout:

- `POST /api/staff/update-status` with `x-staff-secret` → `ok: true`,
  status became `preparing`. ✅
- `POST /api/staff/mark-paid` with `Cash` → ✅; then `Transfer`
  (overwrite) → ✅.
- `POST /api/staff/cancel-order` with reason "2G-E test cleanup" → ✅
  (test order ends cancelled = excluded from owner money totals).
- Staff / owner / customer pages all still loaded. ✅
- `ACTIVE_WRITE_SOURCE` remained `"n8n"`; NO global write flip happened —
  normal production writes went through n8n the whole time. ✅
- **Production staff server writes are confirmed working end-to-end**
  (auth → validation → Supabase PATCH by order_number → JSON result).
- SECURITY: `STAFF_WRITE_SECRET` was ROTATED after the test because the
  value appeared in a screenshot/chat; after redeploy, POST without the
  secret still returns 401 (auth confirmed working with the new value).
  Standing rule: rotate the secret any time it is displayed anywhere.

**Next phase: the TARGETED staff write flip** (decision gate below):

- Do NOT flip `ACTIVE_WRITE_SOURCE` globally — `submitOrder` (customer
  checkout + staff manual order) still needs n8n; the global flag would
  route it to the throwing Supabase stub and break order intake.
- Rebind ONLY `updateOrderStatus` / `cancelOrder` / `updateOrderPayment` in
  `src/lib/data/orderRepository.ts` to the Supabase route adapter.
- `submitOrder` stays on n8n. n8n status/payment webhooks stay alive as the
  instant fallback/rollback path.

Production writes remain on n8n throughout — every test below targets ONE
disposable test order, keyed by its `order_number`, through the deployed
`/api/staff/*` functions.

**Already verified on production (2026-07-08):**

- `POST /api/staff/update-status` without `x-staff-secret` → 401 JSON.
- `GET /api/staff/update-status` → 405 JSON.
- `/`, `/staff`, `/owner` all load; reads work.
- Vercel env has `SUPABASE_SERVICE_ROLE_KEY` + `STAFF_WRITE_SECRET`.

**Route contracts under test** (single implementation:
`api/_lib/staffOrderWrites.server.ts`; all match rows by
`orders.order_number`, never a UUID):

| Route | Body | Columns written |
| --- | --- | --- |
| `POST /api/staff/update-status` | `{ orderId, status, cancellationReason? }` — status ∈ the app's 7 values | non-cancel: `status` ("done"→`completed`) + `cancellation_reason`/`cancelled_at` reset to null; "cancelled": as cancel-order |
| `POST /api/staff/cancel-order` | `{ orderId, reason? }` | `status="cancelled"`, `cancellation_reason` (reason or "Other"), `cancelled_at=now` — payment fields untouched (n8n parity) |
| `POST /api/staff/mark-paid` | `{ orderId, paymentMethod: "Cash"\|"Transfer" }` | `payment_status="Paid"`, `payment_method`, `paid_at=now` |

**Step 0 — create the test order** (never test on a customer order): staff
page → Add Order 加單 → one cheapest item, dine-in, note
`TEST ORDER 2G-E — do not prepare`. This uses the untouched n8n intake, so
the row is created exactly like production rows. Note its `TP-…` number.
Prefer testing outside service hours (mid-test the transient Paid state
counts in owner Today until the final cancel).

**Step 1 — API tests** (PowerShell; secret via Read-Host so it never enters
shell history — never paste secrets inline):

```powershell
$env:STAFF_SECRET = Read-Host "Paste STAFF_WRITE_SECRET from .env.local"
$env:BASE_URL = "https://third-place-menu.vercel.app"
$env:TEST_ORDER = "TP-XXXX"   # <-- the Step 0 order number
$H = @{ "x-staff-secret" = $env:STAFF_SECRET }

# A) status update
Invoke-RestMethod -Method Post -Uri "$env:BASE_URL/api/staff/update-status" -Headers $H -ContentType "application/json" -Body (@{ orderId = $env:TEST_ORDER; status = "preparing" } | ConvertTo-Json)
# B) mark paid Cash
Invoke-RestMethod -Method Post -Uri "$env:BASE_URL/api/staff/mark-paid" -Headers $H -ContentType "application/json" -Body (@{ orderId = $env:TEST_ORDER; paymentMethod = "Cash" } | ConvertTo-Json)
# C) mark paid Transfer (overwrite)
Invoke-RestMethod -Method Post -Uri "$env:BASE_URL/api/staff/mark-paid" -Headers $H -ContentType "application/json" -Body (@{ orderId = $env:TEST_ORDER; paymentMethod = "Transfer" } | ConvertTo-Json)
# D) cancel — final state doubles as cleanup (cancelled = excluded from owner money)
Invoke-RestMethod -Method Post -Uri "$env:BASE_URL/api/staff/cancel-order" -Headers $H -ContentType "application/json" -Body (@{ orderId = $env:TEST_ORDER; reason = "2G-E test cleanup" } | ConvertTo-Json)
```

Expected: every call returns `ok: True` (Invoke-RestMethod throws on
non-2xx). After A: `status="preparing"`, cancellation fields null. After B:
`payment_status="Paid"`, `payment_method="Cash"`, `paid_at` stamped. After
C: `payment_method="Transfer"`, `paid_at` newer. After D:
`status="cancelled"`, `cancellation_reason="2G-E test cleanup"`,
`cancelled_at` stamped, payment fields unchanged.

**Step 2 — Supabase Table Editor verification**: `orders` table, filter
`order_number = TP-XXXX`; after each call check `status`,
`payment_status`, `payment_method`, `paid_at`, `cancellation_reason`,
`cancelled_at` against the expected values above. Timestamps ISO, sane.

**Step 3 — UI-path test on a staff device** (exercises the Supabase adapter
end-to-end, per-device only): on `/staff`, tap ⚿ and enter the staff
secret; in the browser console run
`localStorage.setItem("tp-staff-write-source", "supabase")`. Re-run Step 0
to make a second test order, then advance / mark paid / cancel it FROM THE
UI. Verify the board updates optimistically and survives the 5s poll
(reads are Supabase, so what you wrote is what it reads). Then
`localStorage.removeItem("tp-staff-write-source")` and confirm a normal n8n
write still works on some other harmless action.

**Step 4 — owner dashboard**: manual refresh; both test orders sit in
cancelled (excluded from gross/net/payment mix); cancelled-today count
includes them (expected).

**Rollback / reset**: the final cancelled state IS the cleanup — no reset
needed. To reset a field manually anyway: Table Editor → orders → the row →
edit the columns listed in Step 2 (e.g. `payment_status` back to `unpaid`,
`payment_method`/`paid_at` to NULL). Full removal, ONLY if desired, via SQL
editor — review before running, children first:

```sql
-- shown for reference; do not run without checking the order_number twice
DELETE FROM order_items WHERE order_id = (SELECT id FROM orders WHERE order_number = 'TP-XXXX');
DELETE FROM orders WHERE order_number = 'TP-XXXX';
```

**Decision gate — before flipping staff writes to Supabase:**

- [ ] Step 1 A–D all `ok: True` with matching Supabase rows (Step 2).
- [ ] Step 3 UI-path test passed on the actual staff device.
- [ ] n8n CONFIRM checkboxes for the two workflows being replaced
      (docs/n8n-workflow-side-effects.md rows 2–3): 60-second node-list
      check that they are still DB-only.
- [ ] ⚠️ FLIP DESIGN (confirmed 2026-07-08): do NOT flip
      `ACTIVE_WRITE_SOURCE` — that would also route `submitOrder` (customer
      checkout + manual order) to the Supabase adapter where it is still a
      THROWING STUB and would break order intake. The staff flip is a small
      code change in `src/lib/data/orderRepository.ts` binding ONLY
      `updateOrderStatus` / `cancelOrder` / `updateOrderPayment` to
      `supabaseOrdersAdapter` (replacing the localStorage override),
      while `ACTIVE_WRITE_SOURCE` stays `"n8n"` for `submitOrder`.
- [ ] Staff devices provisioned: secret entered via ⚿ on each device BEFORE
      the flip deploys (writes fail with a clear error otherwise).
- [ ] n8n status/payment webhooks stay alive as instant rollback.

### 2G-F — TARGETED staff-write flip (2026-07-08)

Staff order actions (status / cancel / mark-paid) now default to the
Supabase server routes via a NEW switch in `src/lib/data/dataSource.ts`:

- `STAFF_ACTION_WRITE_SOURCE = "supabase"` — governs exactly the staff
  actions; deliberately separate from `ACTIVE_WRITE_SOURCE` (still `"n8n"`),
  which still governs `submitOrder` (customer checkout + staff manual order)
  because the Supabase `submitOrder` is a throwing stub.
- The 2G-D per-device localStorage override (`tp-staff-write-source`) was
  REMOVED — superseded by the one constant. The ⚿ secret flow is unchanged;
  a device without the secret gets a clear "tap the key button" error.
- ROLLBACK (one line): `STAFF_ACTION_WRITE_SOURCE` back to `"n8n"`, build,
  deploy. The n8n adapters/webhooks were never modified.
- ⚠️ PROVISIONING: every staff device must have the current
  `STAFF_WRITE_SECRET` entered via ⚿ BEFORE this deploy serves it.

### 2G-G — Expense write server route + targeted flip (2026-07-08)

Pre-check passed: the n8n Add Expense workflow is DB-only (side-effects doc
row 4, rec. A) — safe to move.

- New route `POST /api/staff/add-expense` (same delegate pattern:
  `api/staff/add-expense.ts` for production, `src/routes/
  api.staff.add-expense.ts` for dev, one implementation in
  `api/_lib/staffOrderWrites.server.ts`). Requires `x-staff-secret`;
  validates the frozen snake_case payload (`item_name`, positive `amount`,
  closed `paid_from`/`category` vocabularies, optional `note`/`created_by`).
- INSERT mapping replicates n8n (schema notes § Expenses): `expense_date` ←
  Bangkok yyyy-MM-dd, `description` ← item_name, `payment_method` ←
  paid_from, `staff_name` ← created_by or "Staff", `note`. Returns
  `{ ok: true, expenseId }` (the row UUID — the app's expenseId).
- `supabaseExpensesAdapter.addExpense` implemented via the shared
  `staffWriteClient`; `expenseRepository.addExpense` follows
  `STAFF_ACTION_WRITE_SOURCE` — same one-line rollback as 2G-F.
- Dev-verified: 401 without secret, 400 on bad paid_from and negative
  amount; order routes regression-checked (404 unknown order).

### 2G-H — Menu availability: schema fix + migration (implemented 2026-07-14)

Problem (decision recorded 2026-07-08): the app has three states —
`Available` / `Sold Out` / `Hidden` (`src/lib/menuAvailability.ts`) — but
the DB had only `menu_items.is_available` **boolean**. The n8n write
collapses the states (`is_available ← status === "Available"`) and the n8n
read maps the boolean back to only `Available`/`Sold Out` — **Hidden could
not round-trip**: a hidden item came back as Sold Out.

**Schema fix** — `menu_items.availability_status` text + CHECK
(`available` / `sold_out` / `hidden`; text beats an enum type — extending
later needs no type migration). REVIEW-FIRST SQL (backfill from the boolean,
verification SELECTs, rollback, anon read policy per plan R1):
`docs/sql/2026-07-14-2G-H-menu-availability-status.sql` — run MANUALLY in
the Supabase SQL editor, never by tooling.

- ⚠️ Backfill limitation: previously-hidden rows are `false` =
  indistinguishable from Sold Out; they backfill to `sold_out` and must be
  re-marked Hidden by hand (one-time manual review).

**Code (W6 + R1 together, one switch)** — `MENU_AVAILABILITY_SOURCE` in
`dataSource.ts` ("supabase") governs read AND write together so the two
columns can't drift:

- READ: `menu_items` via the anon key, EXPLICIT public columns only
  (`item_code,name_en,category,price,is_available,availability_status`;
  `sort_order` granted for ORDER BY) — never `select=*`. The SQL file grants
  anon a COLUMN-LIMITED SELECT (RLS enabled, all rows readable, only those
  columns; internal/cost/audit/future columns are unreadable by design;
  200-with-zero-rows means the policy is missing). If the deploy somehow
  precedes the migration, the read retries once without
  `availability_status` → boolean mapping. Transitional mapping: prefer
  `availability_status` when valid; else fall back `is_available` true→
  Available / false→Sold Out (the boolean never invents Hidden). Consumers:
  customer menu (drops Hidden, fails open to local data), staff Menu board
  (shows Hidden; 2G-H added a Hidden action button + filter so staff can
  hide/restore from the UI), manual-order picker (hides Hidden).
- WRITE: `POST /api/staff/update-menu-availability` (same delegate pattern:
  `api/staff/update-menu-availability.ts` production,
  `src/routes/api.staff.update-menu-availability.ts` dev, one implementation
  in `api/_lib/staffOrderWrites.server.ts`). Requires `x-staff-secret`
  (device secret via ⚿, sent by the shared staffWriteClient); zod-validates
  `menuItemId` + strict 3-value `availabilityStatus`; 404 on unknown
  item_code. DUAL-WRITES `availability_status` + `is_available` so n8n
  workflows/old readers keep working; retire the boolean in Phase 2H.
- Unchanged: customer submitOrder + staff Add Order stay on n8n
  (`ACTIVE_WRITE_SOURCE` untouched); n8n menu webhooks stay alive as the
  rollback path.

**Deployment order (2G-H):** 1. review code + SQL → 2. run the SQL file in
Supabase SQL editor → 3. run its verification SELECTs → 4. build/typecheck →
5. deploy → 6. controlled production test (below) → 7. commit. The SQL must
land BEFORE the deploy: the new write route PATCHes `availability_status`
and fails (a safe 500, no data touched) while the column is missing, and the
read needs the anon policy.

**Rollback:** set `MENU_AVAILABILITY_SOURCE` back to `"n8n"`, build, deploy
— nothing else. Keep the column (dropping it discards hidden states — see
the SQL file § 4); while writes are on n8n, `availability_status` goes stale
and must be re-synced (SQL file § 5) before flipping forward again.

### Phase 2G-I — secure order intake (customer checkout + Staff Add Order, 2026-07-14)

The last normal-op write, IMPLEMENTED (code on branch; SQL review-first).
Architecture:

1. **Two server routes**, one shared implementation
   (`api/_lib/orderIntake.server.ts`, same dual-surface pattern as 2G-D2):
   - `POST /api/order/submit` — PUBLIC (customers aren't logged in);
   - `POST /api/staff/add-order` — requires `x-staff-secret`.
   Strict zod validation: request-id shape, order type, item-code format,
   integer quantities (≤20/item, ≤30 lines, ≤60 items), field length caps,
   JSON content type, 16 KB body cap, per-type required fields (dine_in →
   table; pickup → name+phone; delivery → name+phone+address), duplicate
   lines safely combined. dine_in never stores leftover customer data.
2. **The browser is not trusted for money**: the body carries ONLY item
   codes + quantities + order-type details. The route calls the
   `create_order_with_items` Postgres function
   (docs/sql/2026-07-14-2G-I-order-intake.sql) with the service-role key;
   the function re-reads `menu_items`, rejects unknown / sold_out / hidden /
   unpriced items, computes unit price, name snapshot, line totals,
   subtotal, delivery fee (fixed 30 THB delivery / 0 otherwise —
   delivery_zones holds demo rows and is deliberately not consulted), and
   total, and inserts `orders` + `order_items` in ONE transaction (no
   partial orders possible). EXECUTE is service_role-only.
3. **Server-generated order numbers**: `TP-YYYYMMDD-HHMMSS` (customer) /
   `TP-S-…` (staff) in Bangkok time, generated in the function with a
   suffix-retry against the unique `orders.order_number` constraint. The UI
   shows the RETURNED number (checkout success screen + manual-order form).
4. **Idempotency**: new `orders.client_request_id` (partial unique index).
   The frontend makes one `crypto.randomUUID()` per intended order and
   reuses it on retries; the function returns the ORIGINAL order for a
   replayed id (`duplicate: true`) — double-tap / network-retry safe.
5. **Stored defaults** match n8n behavior: status `new`, payment_status
   `unpaid`, payment_method null; source `customer_menu` (customer) /
   `staff_manual` (staff manual — NEW value, previously n8n wrote
   customer_menu for these; nothing reads `source` today).
6. **Switch**: `ORDER_INTAKE_SOURCE` in dataSource.ts governs ONLY
   submitOrder (checkout + manual order). `ACTIVE_WRITE_SOURCE` stays "n8n"
   and now governs nothing in practice.
7. **Automation bridge (optional, OFF by default)**: after a successful
   NON-duplicate insert the route emits a signed `order.created` event to
   `N8N_ORDER_AUTOMATION_WEBHOOK_URL` — upgraded in Phase 3A (next section)
   to short-lived-JWT-authenticated + `waitUntil`-backed delivery. ⚠️ NEVER
   point this at the
   old `third-place-order-test` webhook — its workflow INSERTS an order and
   every order would be duplicated. It needs a NEW automation-only workflow
   (no write nodes).

**Deployment order (2G-I):** 1. review code + SQL → 2. run
docs/sql/2026-07-14-2G-I-order-intake.sql in the Supabase SQL editor →
3. run its verification SELECTs (§ 4) → 4. typecheck/build → 5. deploy a
Preview branch and run the controlled test (below) → 6. verify stored
prices/totals in Table Editor came from menu_items → 7. check the n8n
executions list shows NO new order-intake executions from app orders →
8. clean up test orders (cancel or delete rows) → 9. merge to main.
The SQL must land BEFORE the deploy: without the RPC the new routes fail
with a safe 500 and write nothing.

**Controlled test (Preview):**
- Customer dine-in / pickup / delivery order (one each, disposable): success
  screen shows the SERVER order number; row + items + totals correct in
  Table Editor; delivery total = subtotal + 30.
- Staff Add Order (needs ⚿ secret on the device): TP-S-… number returned,
  board refreshes.
- Price manipulation: POST to /api/order/submit with fake
  unitPrice/totalPrice fields (they're not even in the schema — stripped)
  and verify stored totals are menu prices; POST a sold_out item-code →
  409, no row.
- Idempotency: repeat an identical POST (same requestId) → same
  order_number, `duplicate: true`, ONE row.

**Rollback:** set `ORDER_INTAKE_SOURCE` back to `"n8n"`, build, deploy —
intake returns to the untouched n8n webhook (client still sends the full
legacy payload). The SQL objects are harmless to leave in place. n8n-created
orders have NULL client_request_id, so idempotency simply doesn't apply to
them.

### Phase 3A — signed order-created automation bridge (2026-07-14)

Code on branch (`api/_lib/orderIntake.server.ts`, `fireOrderAutomation`).
Purpose: after a successful NEW order transaction (customer OR staff), the
Vercel route notifies a NEW automation-only n8n webhook so Phase 3
bots/notifications can react — WITHOUT n8n ever inserting an order again.

**Behavior:**

- Fires only after `create_order_with_items` succeeded AND
  `duplicate` is false (idempotent replays never re-fire).
- Skipped silently unless BOTH `N8N_ORDER_AUTOMATION_WEBHOOK_URL` and
  `N8N_AUTOMATION_SECRET` are set (server-only env, never `VITE_*`).
- Delivery runs through Vercel `waitUntil` (`@vercel/functions`): the
  customer response returns immediately; the function stays alive until the
  webhook call finishes. Outside Vercel (dev server) `waitUntil` is a no-op
  and the long-lived process finishes the promise anyway.
- 5 s `AbortSignal.timeout`. Any failure (down, timeout, 500) is logged as
  safe metadata only (event id, order number, status / error NAME — never
  the URL, secret, JWT, body, or error message) and never changes the order
  response.
- Standalone check: `npm run test:bridge`
  (scripts/test-automation-bridge.mjs — JWT shape/signature + skip /
  single-event / duplicate / failure behavior with stubbed fetch).

**Event body:**

```json
{"eventId":"<uuid>","eventType":"order.created","occurredAt":"<ISO-8601>","orderNumber":"TP-...","channel":"customer|staff"}
```

No customer data, no money fields, no secrets. n8n fetches the
authoritative order from Supabase server-to-server using its own credential.

**Auth — short-lived HS256 JWT** (built with node:crypto, no jwt library;
verified by n8n's BUILT-IN Webhook JWT Auth + JWT node, so the secret lives
only in an n8n credential, never in workflow Code nodes, Variables, or
execution data). Signing input is
`base64url(header) + "." + base64url(claims)`, HMAC SHA-256 keyed with
`N8N_AUTOMATION_SECRET`, signature base64url-encoded. Header:
`{"alg":"HS256","typ":"JWT"}`. Claims:

```json
{
  "iss": "atlas-order-bridge",
  "aud": "n8n-order-automation",
  "sub": "order.created",
  "jti": "<eventId>",
  "iat": <unix seconds>,
  "nbf": <iat - 5>,
  "exp": <iat + 120>,
  "eventId": "<same eventId>",
  "eventType": "order.created",
  "occurredAt": "<same ISO timestamp>",
  "orderNumber": "TP-...",
  "channel": "customer|staff"
}
```

**Headers sent:** `Content-Type: application/json`,
`Authorization: Bearer <jwt>` (checked by n8n Webhook JWT Auth BEFORE the
workflow runs; the JWT Verify node reads the same header),
`x-atlas-event-id` (= body eventId), `x-atlas-timestamp` (= body
occurredAt).

**Test vector** (secret `test-secret`, clock frozen at
2026-07-14T12:00:00Z → iat 1784030400, nbf 1784030395, exp 1784030520;
event fields as in the body example with orderNumber
`TP-20260714-120000`, eventId `11111111-2222-3333-4444-555555555555`):

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJhdGxhcy1vcmRlci1icmlkZ2UiLCJhdWQiOiJuOG4tb3JkZXItYXV0b21hdGlvbiIsInN1YiI6Im9yZGVyLmNyZWF0ZWQiLCJqdGkiOiIxMTExMTExMS0yMjIyLTMzMzMtNDQ0NC01NTU1NTU1NTU1NTUiLCJpYXQiOjE3ODQwMzA0MDAsIm5iZiI6MTc4NDAzMDM5NSwiZXhwIjoxNzg0MDMwNTIwLCJldmVudElkIjoiMTExMTExMTEtMjIyMi0zMzMzLTQ0NDQtNTU1NTU1NTU1NTU1IiwiZXZlbnRUeXBlIjoib3JkZXIuY3JlYXRlZCIsIm9jY3VycmVkQXQiOiIyMDI2LTA3LTE0VDEyOjAwOjAwLjAwMFoiLCJvcmRlck51bWJlciI6IlRQLTIwMjYwNzE0LTEyMDAwMCIsImNoYW5uZWwiOiJjdXN0b21lciJ9.vUwdYkl9mU2-49NCJt2Z8bYpw8LHuPO-aQqgMPcG-Vs
```

Paste it into any offline JWT debugger with secret `test-secret` → signature
valid (the token itself is long expired — that's the point of exp). Or:

```
node -e "const{createHmac}=require('node:crypto');const[h,p,s]=process.argv[1].split('.');console.log(s===createHmac('sha256','test-secret').update(h+'.'+p).digest('base64url'))" '<jwt>'
```

**Manual n8n workflow plan (build in Phase 3B — NOT built yet).**
Hard rules first: NO raw HMAC/secret in any Code node, NO secret in n8n
Variables or execution data, never log JWT values, ZERO insert/update nodes
for `orders` / `order_items`, and never reuse or copy
`third-place-order-test` (it inserts orders).

1. **JWT credential** (Credentials → New → JWT): Key Type **Passphrase**,
   Algorithm **HS256**, Passphrase = the exact `N8N_AUTOMATION_SECRET`
   value. This credential is the ONLY place the secret exists in n8n.
2. **Webhook node**: method POST, a BRAND-NEW random path (e.g.
   `atlas-order-events-<random>`), Authentication: **JWT Auth** with the
   credential from step 1, Respond: **Immediately**. Invalid/missing
   `Authorization: Bearer` tokens are rejected BEFORE the workflow executes.
3. **JWT node**: Operation **Verify**, same JWT credential, token from the
   Authorization header minus the Bearer prefix:
   `{{ $json.headers.authorization.replace(/^Bearer\s+/i, '') }}`,
   Ignore Expiration **false**, Ignore Not Before **false**, clock
   tolerance **30 s**. Output = the signed claims.
4. **Validation Code node** (claims and body only — no secret): require
   `iss === "atlas-order-bridge"`, `aud === "n8n-order-automation"`,
   `sub === "order.created"`; require the verified claims' `eventId`,
   `eventType`, `occurredAt`, `orderNumber`, `channel` to EQUAL the parsed
   request-body fields, and `jti === eventId`. Throw on any mismatch so the
   execution fails visibly.
5. **Deduplicate via an n8n Data Table** (NOT workflow static data) named
   `atlas_order_events`, columns: `event_id` string, `occurred_at` date,
   `order_number` string, `channel` string. Look up `event_id`; if found →
   stop (already processed); else insert the row, then continue.
6. **HTTP Request node**: ~~fetch the authoritative order from Supabase
   REST using the existing secured n8n Supabase credential~~ — SUPERSEDED by
   Phase 3B (next section): n8n forwards the SAME incoming Bearer JWT to
   `POST /api/automation/order-details` and never holds a Supabase
   credential for this flow at all.
7. Attach bot/notification actions AFTER that fetch (Phase 3 work).
8. Set `N8N_ORDER_AUTOMATION_WEBHOOK_URL` (the new path's production URL)
   + `N8N_AUTOMATION_SECRET` (long random value, same as the credential
   passphrase) in Vercel env → redeploy → bridge goes live.

**Verification checklist (Preview deploy):**

- [ ] `npm run test:bridge` passes locally (JWT shape, independent HS256
      verification, exp = iat + 120, skip/duplicate/failure behavior).
- [ ] Env vars unset: place a disposable order → succeeds; logs show
      `ORDER_INTAKE` but NO `ORDER_AUTOMATION` line; n8n shows no execution.
- [ ] Both env vars set: one order → succeeds AND exactly one event
      arrives; n8n Webhook JWT Auth accepted it; the JWT Verify node
      returns claims matching the body.
- [ ] Wrong-secret probe: POST to the webhook with an unsigned/garbage
      Bearer token → n8n rejects it before the workflow runs (no execution
      with data).
- [ ] Idempotent replay (re-POST same requestId): `duplicate: true`, NO
      second event.
- [ ] Event replay (re-deliver the same eventId to n8n): dropped by the
      `atlas_order_events` Data Table lookup.
- [ ] Receiver returns 500: order still succeeds; log line says
      `rejected` with the status.
- [ ] Receiver hangs > 5 s: order still succeeds; log line says
      `failed: TimeoutError`.
- [ ] Test vector above validates in an offline JWT debugger with
      `test-secret`.

**Rollback:** unset the two env vars (bridge off, orders unaffected) or
revert the branch. No SQL, no data migration — the bridge is stateless.

### Phase 3B — authoritative order fetch for n8n (2026-07-15)

Code on branch (`api/_lib/orderDetails.server.ts` +
`api/_lib/orderEventJwt.server.ts`). Purpose: after n8n validates and
deduplicates a Phase 3A `order.created` event, it forwards the SAME
short-lived Bearer JWT to a new read-only Vercel endpoint and receives the
authoritative order + items as a deliberately mapped, safe payload. n8n
never holds a Supabase key for this flow; the service-role key stays
server-side in Vercel only.

**Endpoint:** `POST /api/automation/order-details` — dual-surface like every
other route (native Vercel function `api/automation/order-details.ts`,
TanStack dev route `src/routes/api.automation.order-details.ts`, ONE shared
handler in `api/_lib/orderDetails.server.ts`). Server-to-server only: no
CORS headers, no OPTIONS handler, no browser auth. All non-POST verbs → 405.

**Request contract:**

- `Authorization: Bearer <jwt>` — the UNMODIFIED token from the Phase 3A
  event delivery. Exact `Bearer ` scheme; missing/empty/malformed/repeated
  headers → generic 401.
- `Content-Type: application/json`; body ≤ 1024 bytes:

```json
{"eventId":"<uuid from the event>","orderNumber":"TP-..."}
```

- Strict zod validation: object only (arrays/null rejected), unknown fields
  rejected, `eventId` 8–64 chars of `[A-Za-z0-9-]`, `orderNumber` 4–64 chars
  of `[A-Za-z0-9-]` (charset admits no whitespace — padded values are
  rejected, not trimmed). No column names, filters, table names, or query
  text can be expressed in the body at all.

**JWT verification** (`verifyOrderEventJwt`, orderEventJwt.server.ts — the
same module Phase 3A signs with, so the two directions cannot drift):
exactly 3 base64url segments, ≤ 4096 bytes; header must be valid JSON with
`alg` EXACTLY `HS256` (`none` and everything else rejected); signature
recomputed with HMAC-SHA256 over `header.payload` keyed by
`N8N_AUTOMATION_SECRET` and compared with `crypto.timingSafeEqual`
(constant-time; length checked first); claims must satisfy
`iss=atlas-order-bridge`, `aud=n8n-order-automation`, `sub=order.created`,
`jti` present and equal to the `eventId` claim, `eventType=order.created`,
`channel` ∈ {customer, staff}, `occurredAt` a string; `exp`/`nbf`/`iat`
must be numbers, checked against a documented **30 s clock tolerance**
(`JWT_CLOCK_TOLERANCE_S`): expired, nbf-in-the-future, and
iat-in-the-future tokens are rejected. THEN the token is bound to the body:
`claims.eventId === body.eventId` AND
`claims.orderNumber === body.orderNumber` — one token authorizes exactly
one fetch of exactly one order. Every failure is the same generic
`401 Unauthorized.` (no oracle for which check failed); tokens, headers,
and secrets are never logged.

**Supabase access (read-only guarantee):** two GETs with explicit column
lists — `orders?order_number=eq.<n>&select=<fixed columns>&limit=1`, then
`order_items?order_id=eq.<uuid>&select=<fixed columns>`. Server-only env:
`VITE_SUPABASE_URL` (public project URL, same convention as every route) +
`SUPABASE_SERVICE_ROLE_KEY` (never `VITE_*`, never client-side, never
returned or logged). The handler contains NO insert/update/upsert/delete/
RPC — `npm run test:order-details` asserts every outgoing call is a GET.

**Response contract** (mapped field-by-field — never raw rows; `id`,
`client_request_id`, and any unlisted column can never leak):

```json
{
  "ok": true,
  "data": {
    "eventId": "...",
    "order": {
      "orderNumber": "TP-...", "channel": "customer|staff|null",
      "orderType": "...", "status": "...(DB vocabulary, e.g. completed)",
      "paymentStatus": "...", "paymentMethod": "...|null",
      "customerName": "...|null", "customerPhone": "...|null",
      "deliveryAddress": "...|null", "tableNumber": "...|null",
      "customerNote": "...|null", "subtotal": 0, "deliveryFee": 0,
      "total": 0, "createdAt": "ISO-8601"
    },
    "items": [
      {"itemCode": "B01", "itemName": "...", "quantity": 1,
       "unitPrice": 0, "lineTotal": 0}
    ]
  }
}
```

Amounts are THB numbers (Postgres numeric strings coerced); `channel` is
mapped from `orders.source` (`customer_menu`→customer,
`staff_manual`→staff, anything else → null).

**Errors:** 400 invalid body · 401 any auth failure (generic) · 404 order
not found · 405 non-POST · 413 body too large · 415 wrong content type ·
500 server not configured · 502 Supabase read failed. Bodies are always
`{"ok":false,"error":"<generic message>"}` — no Supabase text, no stack, no
claim/secret details.

**n8n workflow update (do AFTER the endpoint is deployed):** insert one
HTTP Request node ("Fetch Authoritative Order Details") into the existing
Phase 3A receiver. Retry-safe node sequence — the dedup row is inserted
ONLY after the fetch succeeded, so a transient Vercel/Supabase failure
leaves no dedup row and the event can be safely retried; inserting first
would permanently block a retry for an order that was never fetched:

```
Receive Order Event
  → Validate Event Claims
  → Look Up Event ID          (dedup LOOKUP: stop if already processed)
  → Fetch Authoritative Order Details   (this endpoint)
  → Insert Event Row          (dedup INSERT — only after a 200)
```

- Method POST, URL `https://third-place-menu.vercel.app/api/automation/order-details`
  (for Preview testing, the Preview deployment URL instead).
- Header `Authorization`: forward the incoming header verbatim —
  `{{ $('Receive Order Event').item.json.headers.authorization }}`
  ("Receive Order Event" is the webhook node's actual name; the normalized
  lowercase `headers.authorization` shape is the same one the Phase 3A
  JWT-node step already documents). ASSUMPTION to confirm during the first
  Preview execution: header keys arrive lowercased on n8n Cloud.
- JSON body: `{"eventId": "<validated eventId claim>", "orderNumber":
  "<validated orderNumber claim>"}` — from the VERIFIED claims, not the raw
  request body.
- Never: put a Supabase key or `N8N_AUTOMATION_SECRET` in this node,
  re-sign or reconstruct the JWT, send the token in query parameters, or
  log/store the token in the Data Table. On non-200, stop the branch
  (Continue On Fail OFF) — later bot/notification nodes only ever see the
  safe response. The 120 s token lifetime means the fetch must stay
  immediately after validation — never behind a Wait node.

**Verification (Preview):** deploy the branch as a Preview → point ONE
disposable n8n execution (or curl with a freshly generated test token) at
`<preview-url>/api/automation/order-details` → place one disposable order →
confirm n8n receives the mapped payload with correct totals/items, and that
replaying the same call after ~2.5 min gets 401 (token expired). Probe:
no Authorization → 401; garbage token → 401; valid token + mismatched
orderNumber → 401; unknown order → 404. Then check Vercel logs show only
`ORDER_DETAILS <order> event=<id> items=<n>` lines (no tokens). Promotion:
merge to main, redeploy Production, flip the n8n node URL to the production
domain. No SQL, no env changes (reuses `N8N_AUTOMATION_SECRET` +
`SUPABASE_SERVICE_ROLE_KEY` + `VITE_SUPABASE_URL` already set for 3A/2G).

**Rollback:** remove/disable the n8n HTTP Request node branch, then revert
the endpoint commit (or leave it — with the secret unset it answers only
safe 500s). Phase 3A validation/dedup keeps working unchanged; order intake
and restaurant operations are untouched either way.

**Remaining risks:** the JWT is bearer-forwardable within its 120 s + 30 s
tolerance window — anyone holding a leaked token could fetch THAT one
order's details (mitigation: n8n must not log/store tokens; HTTPS
everywhere; short lifetime). No replay counter on this endpoint itself —
n8n's Data Table dedup is the replay gate for the WORKFLOW, while repeated
fetches of the same order within the window are read-only and idempotent.
Endpoint enumerates nothing: order numbers not bound to a valid signed
token are unreachable.

### Production test checklist after the 2G-F/2G-G deploy

1. ⚿ on each staff device: enter the CURRENT rotated secret.
2. Staff board: advance a TEST order's status (create via Add Order first,
   as in 2G-E), mark paid Cash, cancel with a reason — all from the UI; the
   board must update and survive the 5s poll.
3. Expenses: add `TEST EXPENSE 2G-G` (small amount, category Other) from
   the staff Expenses view; it must appear in the list (Supabase read) and
   in Supabase Table Editor with description/payment_method/staff_name/
   expense_date correct. Then DELETE that row in Table Editor (expenses
   have no cancelled state — the row otherwise pollutes owner Net Today).
4. Owner dashboard: manual refresh — numbers sane; the cancelled test order
   excluded; after deleting the test expense, Net Today back to normal.
5. Customer checkout: place NO real test order via checkout unless needed —
   intake is unchanged (n8n); a quick page-load check is enough.
6. n8n executions list: status/payment/expense webhooks should now show NO
   new executions from app actions (only bots/manual runs) — confirms the
   app stopped depending on them while they stay alive as fallback.

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
