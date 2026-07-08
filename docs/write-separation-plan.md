# Write Separation Plan — Phase 2G (audit + architecture)

**Status:** 2G-A audit COMPLETE (2026-07-06); 2G-D staff order routes
ROUTE-READY but not active (2026-07-08). Flags unchanged
(`ACTIVE_READ_SOURCE = "supabase"`, `ACTIVE_WRITE_SOURCE = "n8n"`).
Remaining normal-op writes to migrate: expenses (W5), menu availability
(W6 — after the 3-state gap is resolved), customer order intake (W1, last).
Payment proof add (W7) stays n8n long-term for bot/social automation.

**Business goal:** before real restaurant use, normal app operations must not
depend on n8n. n8n becomes the automation layer only (bots, social chat,
payment-proof intake, notifications, future daily summary / LINE MAN import).

---

## 1. Audit — every n8n call the app still makes

All URLs are built by `n8nWebhook()` in `src/lib/n8n.ts` (the only module
that knows them). "Normal op" = the app can't do its job without it.

### W1 · Customer + staff-manual order submit  *(WRITE, normal op)*
- Code: `submitOrder()` in `src/lib/orders.ts`; called by
  `CheckoutDrawer.tsx` (customer) and `ManualOrderForm.tsx` (staff). These
  deliberately bypass the repository layer today (documented in
  `adapters/types.ts`).
- Webhook: `third-place-order-test` (POST).
- Payload: `OrderPayload` — orderId (TP-…, client-generated), createdAt,
  customer{name,phone}, orderType, tableNumber, deliveryAddress, notes,
  items[{id,name,quantity,unitPrice,lineTotal}], totalItems, subtotalPrice,
  deliveryFee, totalPrice, status:"draft".
- Supabase: INSERT `orders` (status forced to "new", source
  "customer_menu", payment_method null) + one `order_items` row per line
  (order_id ← new orders.id).
- Target: **B (server API route)** — and migrate LAST of the writes: order
  intake is where future bot/notification automation hangs; the n8n intake
  webhook must stay alive for Phase 3 bots regardless.
- Security: public by design (customers submit). A server route lets us
  RE-COMPUTE prices/totals server-side from `menu_items` instead of trusting
  client math — an upgrade over today's n8n trust-the-client behavior.
- Risk if moved carelessly: n8n automations listening to intake (current and
  Phase 3) stop firing. Mitigation: re-point via Supabase DB webhook → n8n,
  or have the server route call n8n after insert.

### W2 · Staff: update order status  *(WRITE, normal op)*
- Code: `updateStaffOrderStatus()` in `src/lib/staffOrders.ts`; via
  repository (`updateOrderStatus`) from staff board.
- Webhook: `third-place-update-order-status` (POST).
- Payload: `{ airtableRecordId (= order_number TP-…), status
  (frontend sends "completed" for done), cancellationReason? }`.
- Supabase: PATCH `orders` matched by `order_number`; n8n logic to
  replicate: non-cancel statuses reset `cancellation_reason`/`cancelled_at`
  to null; "cancelled" sets reason (default "Other") + `cancelled_at` now.
- Target: **B (server API route)**.
- Security: this mutates order state — staff-only in spirit, public webhook
  in practice today. Server route should check a staff secret (see § 3).

### W3 · Staff: cancel order  *(WRITE, normal op)*
- Code: same function as W2 with `status: "cancelled"` + reason
  (repository `cancelOrder`). Same webhook, same target, same plan as W2 —
  one server route serves both.

### W4 · Staff: mark paid (Cash / Transfer)  *(WRITE, normal op)*
- Code: `updateOrderPayment()` in `src/lib/staffOrders.ts`; via repository.
- Webhook: `third-place-update-payment` (POST).
- Payload: `{ airtableRecordId (= order_number), paymentStatus: "Paid",
  paymentMethod: "Cash" | "Transfer" }`.
- Supabase: PATCH `orders` by `order_number`: payment_status
  (n8n default "paid" lowercase if missing — keep sending "Paid"),
  payment_method, `paid_at ← now ISO`.
- Target: **B (server API route)** with staff secret. Money-adjacent — the
  most important one to protect.

### W5 · Staff: add expense  *(WRITE, normal op)*
- Code: `addExpense()` in `src/lib/expenses.ts`; via repository from
  ExpenseView.
- Webhook: `third-place-add-expense` (POST).
- Payload (frozen snake_case): `{ item_name, amount, paid_from, category,
  note?, created_by? }`.
- Supabase: INSERT `expenses`; n8n logic to replicate: `expense_date` ←
  Bangkok-local yyyy-MM-dd, `payment_method` ← paid_from || "Other",
  `description` ← item_name (observed), `staff_name` default "Staff",
  `amount` ← Number.
- Target: **B (server API route)** with staff secret.

### W6 · Staff: menu availability update  *(WRITE, normal op)*
- Code: `updateMenuAvailability()` in `src/lib/menuAvailability.ts`; called
  by `MenuAvailabilityBoard.tsx` (staff). NOT behind the repository layer.
- Webhook: `third-place-update-menu-availability` (POST).
- Payload: `{ menuItemId (item_code e.g. "B01"), availabilityStatus:
  "Available" | "Sold Out" | "Hidden" }`.
- Supabase: PATCH `menu_items` by `item_code`:
  `is_available ← availabilityStatus === "Available"`.
  ⚠️ Schema gap: the DB stores a boolean, but the app has THREE states
  (Hidden ≠ Sold Out). Resolve during 2G-E (either a status column exists
  that discovery missed, or Hidden is derived elsewhere — verify in n8n
  before porting).
- Target: **B (server API route)** with staff secret.

### W7 · Payment proof add  *(WRITE, automation)*
- Code: NONE in the app (verified — the app only displays proof fields).
- Webhook: `third-place-add-payment-proof` (POST), used manually/by bots.
- Target: **C — stays n8n permanently.** This is the Phase 3 bot flow's
  write. No action in 2G.

### R1 · Menu availability READ  *(READ, normal op — found by this audit)*
- Code: `getMenuAvailability()` — used by the CUSTOMER MENU (`index.tsx`),
  staff `MenuAvailabilityBoard`, and staff `ManualOrderForm`.
- Webhook: `third-place-menu-availability` (GET) → reads `menu_items`.
- The customer menu itself still depends on n8n. The Phase 2E read flip
  covered orders + expenses only.
- Target: **A (direct Supabase read with anon SELECT + RLS)** — same pattern
  as the flipped reads; `menu_items` is public-by-nature data (it IS the
  menu). Needs `GRANT SELECT ON public.menu_items TO anon` + a `USING (true)`
  SELECT policy (remember the expenses lesson: 200-with-empty-rows = missing
  policy). Bundle into 2G-E.

### R2 · Order/expense reads via n8n — already migrated (Phase 2E); n8n read
webhooks stay alive as the parity reference + rollback until Phase 2H.

---

## 2. Write-path options evaluated

| | 1 · Anon key + strict RLS | 2 · Supabase Edge Functions | 3 · Keep n8n (temporary) | 4 · Server routes in this app (Vercel) |
| --- | --- | --- | --- | --- |
| Speed | Fastest (SQL only) | Medium | Zero work | Medium |
| Security | ❌ Weakest: RLS can't distinguish staff from anyone holding the public anon key; anon UPDATE on `orders` = anyone can mark-paid/cancel; no server-side validation of totals/transitions | ✅ Key server-side | Same as today (public webhooks) | ✅ Key server-side, can validate payloads, recompute totals, check staff secret |
| Complexity | Low code, high policy subtlety | New runtime (Deno), second deploy surface, CORS config | None | Modest — **this stack already ships a server** (TanStack Start + nitro on Vercel, `src/server.ts`) |
| MVP fit | Stopgap only — fails the security intent for real use | Works, but adds infra this project doesn't need | Fails the business goal | ✅ Best fit: one codebase, one deploy, no new infra |
| Before real use | Would need auth anyway | Fine | Not acceptable | Fine — pair with the staff secret below |

**Recommendation (decide formally in 2G-B): Option 4** — API routes inside
this TanStack Start app, deployed with the existing Vercel deployment.
Options 2 and 4 are the same architecture (server-side key, validated
writes); 4 wins because the server already exists. Option 1 is acceptable
ONLY for `menu_items` READS (R1). Option 3 remains true for W7 and for any
write whose n8n automation isn't re-pointed yet.

Mechanics of Option 4:
- Server env vars (Vercel, server-only — NOT `VITE_*`, never in the client
  bundle): `SUPABASE_URL` + a write-capable key (`SUPABASE_SERVICE_ROLE_KEY`
  or a dedicated role's key). `.env.local` gets server-side entries for dev.
- The Supabase write adapters (currently throwing stubs) implement their
  methods as `fetch("/api/…")` calls — the repository layer means ZERO UI
  changes, and `ACTIVE_WRITE_SOURCE` keeps working as the switch, flipped
  per the runbook (consider splitting per-write if migration is staggered).
- Each route replicates the n8n workflow's logic documented in § 1 and in
  docs/schema-discovery-notes.md (defaults, timestamps, match-by
  order_number/item_code, cancellation-field resets).

## 3. Security plan (required before real restaurant use)

- **Staff secret for staff writes (W2–W6):** a single shared secret entered
  once on the staff device (stored in localStorage), sent as a header,
  checked by the server routes. Not enterprise auth — but it closes the
  "anyone with the URL can cancel orders" hole that exists today with public
  n8n webhooks. Decide exact UX in 2G-B; owner dashboard stays read-only.
- **Customer submit (W1):** stays public (it's how customers order), but the
  server route validates: known item codes, server-recomputed prices/totals
  against `menu_items`, sane quantities, payload size. Rate limiting if
  Vercel makes it easy; otherwise accept MVP risk (equal to today).
- **Anon key:** stays read-only forever. NO anon INSERT/UPDATE/DELETE
  policies — the write path is the server. service_role / sb_secret: server
  env + n8n only, never `VITE_*`.
- **RLS reads:** current permissive SELECT policies are the documented
  pre-production review item (parity doc QA-4) — unchanged by this plan.

## 4. Per-write test + rollback plan (applies to each of W1–W6)

Test, per write, on the deployed app (writes still land in the same
Supabase DB, so verification is direct):
1. Perform the action in the UI (or checkout flow for W1).
2. Verify the row in Supabase Table Editor: same columns/values the n8n
   workflow would have written (compare against a pre-migration row).
3. Verify the read path shows it (staff board / owner refresh / menu).
4. Verify whatever n8n automation depended on that write still fires
   (check the n8n executions list) — or was consciously re-pointed.
5. `npm run parity` still passes (n8n reads vs Supabase reads are unaffected
   by where writes come from — both read the same DB).

Rollback, per write: `ACTIVE_WRITE_SOURCE` back to `"n8n"` (or the
per-write switch if split), build, deploy. The n8n write webhooks stay
untouched and alive until every write is proven — same doctrine as reads.

## 2G-B DECISION RECORD (2026-07-06)

**Write path: Option 4 confirmed** — TanStack Start / Nitro server routes
inside this app, deployed with the existing Vercel deployment. Side-effect
audit (docs/n8n-workflow-side-effects.md): all five normal-op write
workflows are DB-only today — recommendation A across the board; payment
proof stays n8n permanently. A 60-second per-workflow CONFIRM check in n8n
remains before each individual migration.

### Server env var names (placeholders — values NEVER in the repo)

| Name | Where | Purpose |
| --- | --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel server env + `.env.local` (dev), server-only | Write-capable key used ONLY inside server routes |
| `STAFF_WRITE_SECRET` | same, server-only | Shared secret staff devices must present for staff writes |
| `N8N_AUTOMATION_SECRET` | same, server-only, OPTIONAL/later | Auth for server→n8n automation callbacks (Phase 3 bridge) |

The Supabase URL itself can be read from the existing `VITE_SUPABASE_URL`
(it is public by nature and already ships in the client bundle).

**Why these must NOT be `VITE_*`:** Vite statically inlines every
`import.meta.env.VITE_*` value into the CLIENT bundle at build time — a
`VITE_` prefix ships the value to every browser that loads the page. The
three names above must be read via `process.env` on the Nitro server only,
where they never enter any client artifact. Rule of thumb: `VITE_` = public
by definition; anything secret gets a bare name.

### Staff secret UX (MVP)

- **Provisioning:** owner sets `STAFF_WRITE_SECRET` in Vercel; tells staff
  the PIN/phrase verbally. One shared secret for the whole shop (per-person
  accounts are post-MVP; Supabase Auth is the upgrade path).
- **Entry:** the staff page prompts once for the secret (tiny settings
  prompt, added in 2G-D) and stores it in `localStorage` on the staff iPad.
- **Transport:** every staff write sends it as an `x-staff-secret` header;
  server routes compare against `process.env.STAFF_WRITE_SECRET` and reject
  with 401 otherwise. Always HTTPS on Vercel.
- **Exposure surface:** never in the repo, never in the bundle; it lives on
  the staff device and in transit inside TLS. It is NOT sent on customer
  routes (order submit is public and secretless).
- **Realistic MVP risk:** anyone with physical access to the staff device
  is "staff"; a leaked PIN requires rotating one Vercel env var. Both are
  acceptable for a single-shop MVP and strictly better than today, where
  the write webhooks are public URLs needing no secret at all.

### Design confirmations for the implementation phases

- **Customer order submit (2G-C):** PUBLIC server route (no staff secret).
  Server validates item codes against `menu_items`, RE-COMPUTES unit prices,
  line totals, subtotal, delivery fee and total server-side — client-sent
  money values are treated as display hints, never trusted. Writes `orders`
  + `order_items` (atomicity: prefer a single Postgres RPC
  `create_order(...)`; decide in 2G-C — n8n today does two sequential
  inserts, so an RPC is an improvement, not a regression).
- **Staff writes (2G-D/E):** status / cancel / mark-paid / add-expense /
  menu-availability routes all require the `x-staff-secret` header. Same
  column mappings and defaults the n8n workflows apply today (§ 1 tables).
- **Menu availability read (2G-E):** moves to the direct Supabase read path
  (anon SELECT + `USING (true)` policy on `menu_items`) — the customer menu
  must not depend on n8n. Watch for the 200-but-empty RLS failure mode.

### Automation bridge (design only — DO NOT implement now)

When Phase 3 adds notifications/bots that today would have hung off n8n
writes, the options are:

| Approach | Notes |
| --- | --- |
| **Server route calls an n8n automation webhook after a successful write** | ✅ RECOMMENDED first: explicit, no new infra, testable, auth via `N8N_AUTOMATION_SECRET`; fire-and-forget so a slow n8n never blocks the write |
| Supabase Database Webhooks (DB trigger → n8n) | Most robust (fires no matter who wrote); good second step; config lives in Supabase, mind auth + retries |
| n8n scheduled polling | Simple but laggy and wasteful; only for non-urgent digests (daily summary) |
| Supabase Realtime | Post-MVP; needs a persistent listener — n8n Cloud isn't one |

## 5. Phase 2G checklist

- [x] **2G-A — audit complete** (this document, 2026-07-06).
- [x] **2G-B — write path chosen** (2026-07-06): Option 4 server routes;
      env names, staff-secret UX, automation bridge recorded above;
      side-effect audit in docs/n8n-workflow-side-effects.md — all
      normal-op writes are DB-only (rec. A), payment proof stays n8n.
      Remaining: the per-workflow CONFIRM checkbox in n8n right before each
      write's migration.
- [ ] **2G-C — customer order submit** (W1): server route with
      server-recomputed totals; intake automation re-pointed or deliberately
      dual-fired. NOTE: despite the C-before-D numbering, implement AFTER
      2G-D if intake automations aren't re-pointed yet — intake is the
      automation-entangled one (runbook has always ordered it last).
- [x] **2G-D — staff order actions ROUTE-READY** (2026-07-08): status +
      cancel + mark-paid server routes (`/api/staff/*`, `x-staff-secret`) and
      the Supabase adapter writes implemented — but NOT ACTIVE by default:
      `ACTIVE_WRITE_SOURCE` stays `"n8n"`; a per-device localStorage override
      (`tp-staff-write-source`) is the controlled test path. 2G-D2
      (2026-07-08) fixed deployed `/api/*` serving: native Vercel functions
      in `api/staff/*` delegating to the same shared handlers as the dev
      routes (the Nitro `vercel` preset attempt broke the SPA-shell prerender
      and was reverted — details in runbook 2G-D2). Remaining before the
      actual flip: verify `/api/staff/*` on the deployed app, deployed write
      testing, and the n8n CONFIRM checkboxes (side-effects doc rows 2–3).
      n8n status/payment webhooks stay the live default + rollback.
- [ ] **2G-E — expenses + menu availability** (W5/W6 + R1): expense insert
      route; menu-availability update route (resolve the is_available
      boolean vs 3-state gap first); `menu_items` anon SELECT for the read.
- [ ] **2G-F — automation stays in n8n** (W7 + Phase 3 surface): payment
      proof intake, bots, notifications; document which n8n workflows remain
      and which retire.
- [ ] **2G-G — parity / write smoke test**: full § 4 pass over every
      migrated write on the deployed app + one `npm run parity` run + the
      runbook's post-flip verification list.
