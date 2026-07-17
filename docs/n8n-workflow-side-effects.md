# n8n Write Workflow Side-Effect Audit — Phase 2G-B

**Purpose:** before any normal-app write moves off n8n, know whether the n8n
workflow does anything BESIDES the database write (notifications, bot
messages, social replies, secondary writes). A workflow that only writes the
DB can be replaced by a server route 1:1; anything else needs its side effect
duplicated or re-pointed first (recommendation B).

**Evidence base (2026-07-06):** the Phase 2B discovery walked every workflow
node-by-node (docs/schema-discovery-notes.md) and recorded ONLY webhook →
mapping → Supabase-REST → respond chains — no notification, message, bot, or
social nodes were reported in ANY of the nine Third Place workflows, and no
bot/notification workflows were found in the account at all (those arrive in
Phase 3). Live webhook behavior matches. Because n8n workflows can change
outside this repo, each row still carries a **CONFIRM** checkbox: before
migrating that write, open the workflow in n8n Cloud and spend 60 seconds
verifying the node list still matches. If a new side-effect node appeared,
the recommendation flips to B for that workflow.

## Write workflows

| # | Workflow | Webhook path | Method | Table(s) | Columns written | DB-only? | Bot/social/payment side effect | Breaks automation if moved? | Rec. | Confirm in n8n |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Order Intake API (Supabase Test) | `third-place-order-test` | POST | `orders` + `order_items` | orders: order_number, order_type, status("new"), table_number, customer_name/phone/address, customer_note, source("customer_menu"), subtotal, delivery_fee, total, payment_method(null) · items: order_id, item_code, item_name, quantity, unit_price, line_total, note(null) | ✅ per 2B discovery | none today; Phase 3 bots/notifications WILL attach here | No (today). Phase 3 must attach to the new path or the kept n8n webhook | **A** — MOVED 2026-07-14 (runbook 2G-I): app intake → `/api/order/submit` + `/api/staff/add-order` → `create_order_with_items` RPC. Webhook stays alive ONLY as the rollback path. ⚠️ THIS WORKFLOW INSERTS AN ORDER — the app must never call it in addition to the Supabase path (instant duplicates), and it must NOT be reused as the Phase 3 automation hook unless its write nodes are removed and verified | [ ] |
| 2 | Update Order Status API | `third-place-update-order-status` | POST | `orders` | status; if "cancelled": cancellation_reason (default "Other") + cancelled_at=now; else both reset to null. Match: order_number | ✅ per 2B discovery | none observed | No | **A** | [ ] |
| 3 | Update Payment API | `third-place-update-payment` | POST | `orders` | payment_status (default "paid" lc), payment_method, paid_at=now ISO. Match: order_number | ✅ per 2B discovery | none observed | No | **A** | [ ] |
| 4 | Add Expense API | `third-place-add-expense` | POST | `expenses` | expense_date (Bangkok yyyy-MM-dd), category (def "Other"), description (← item_name/note), amount (Number), payment_method (← paid_from, def "Other"), staff_name (def "Staff"), note | ✅ per 2B discovery | none observed | No | **A** | [ ] |
| 5 | Update Menu Availability API | `third-place-update-menu-availability` | POST | `menu_items` | is_available ← (availabilityStatus === "Available"). Match: item_code | ✅ per 2B discovery | none observed | No — schema gap resolved 2G-H (availability_status column; app route dual-writes both) | **A** — MOVED 2026-07-14 (runbook 2G-H); webhook stays alive as rollback | [x] |
| 6 | Add Payment Proof API | `third-place-add-payment-proof` | POST | `payment_proofs` | order_id (orders.id UUID), proof_url, proof_file_path(def ""), source(def "manual-test"), status(def "received"), note(def "") | ✅ per 2B discovery | none today — but this IS the Phase 3 bot flow's write | n/a — not moving | **C — stays n8n permanently** (no app caller exists; verified) | [ ] |

No other Third Place write workflows were found in the 2B discovery (the
remaining three — Staff Orders, Get Expenses, Menu Availability — are READ
workflows; the first two are already replaced by Supabase reads and retire in
Phase 2H, the menu read moves in 2G-E).

## Current app callers (repo-verified 2026-07-06)

| Action | Caller → function | n8n webhook | Via repository layer? |
| --- | --- | --- | --- |
| Customer order submit | `CheckoutDrawer.tsx` → `submitOrder()` (orders.ts) | order-test only when `ORDER_INTAKE_SOURCE="n8n"` (rollback) — Supabase route `/api/order/submit` since 2G-I | No (deliberate — intake switches inside orders.ts) |
| Staff manual order | `ManualOrderForm.tsx` → `submitOrder(payload, "staff")` | order-test only on rollback — Supabase route `/api/staff/add-order` since 2G-I | No (same) |
| Staff status update | staff board → repo `updateOrderStatus` → `updateStaffOrderStatus()` | update-order-status | Yes |
| Staff cancel | staff board → repo `cancelOrder` → same function, status "cancelled" | update-order-status | Yes |
| Staff mark paid | staff board → repo `updateOrderPayment` → `updateOrderPayment()` | update-payment | Yes |
| Staff add expense | ExpenseView → repo `addExpense` → `addExpense()` (expenses.ts) | add-expense | Yes |
| Menu availability update | `MenuAvailabilityBoard.tsx` → `updateMenuAvailability()` | update-menu-availability | No |
| Payment proof add | — none in app (display only) | add-payment-proof | n/a |
| Menu availability READ | customer menu `index.tsx`, `MenuAvailabilityBoard`, `ManualOrderForm` → `getMenuAvailability()` | menu-availability (GET) | No — still n8n; moves in 2G-E |

## Phase 3A — order-created automation bridge (2026-07-14)

The app emits an `order.created` event authenticated by a short-lived
HS256 JWT (`Authorization: Bearer`) to
`N8N_ORDER_AUTOMATION_WEBHOOK_URL` after a successful non-duplicate
order — **since Phase 3C (2026-07-17) only for server-resolved BOT channels
(instagram/messenger)**. Customer checkout, dine-in QR, and staff manual
orders never dispatch: normal restaurant operations cost zero n8n
executions. No public route can create a bot-channel order yet (trusted
bot sessions are a later phase), so the bridge is currently silent. Full
spec, n8n workflow plan, and verification checklist in
docs/backend-separation-runbook.md § Phase 3A + § Phase 3C. Hard rules for the
receiving workflow:

- It must be a **brand-new automation-only webhook path** — never the old
  `third-place-order-test` webhook (row 1 above), which INSERTS an order
  and would duplicate every order.
- The workflow must contain **NO insert/update nodes for `orders` or
  `order_items`** — it authenticates via the webhook's built-in JWT Auth,
  re-verifies with the JWT node, compares signed claims to the body,
  deduplicates `eventId` in the `atlas_order_events` Data Table, then
  FETCHES the authoritative order from Supabase and runs bot/notification
  actions only.
- The shared secret exists in n8n ONLY as the JWT credential's passphrase —
  never in Code nodes, n8n Variables, or execution data; JWT values are
  never logged.
- The event body carries identifiers only (eventId, orderNumber, channel,
  timestamp) — n8n must not treat it as order data. Since Phase 3B the
  workflow gets the authoritative order by forwarding the SAME Bearer JWT to
  `POST /api/automation/order-details` (read-only, JWT-verified server
  route) — n8n holds NO Supabase credential for this flow. Full contract in
  docs/backend-separation-runbook.md § Phase 3B.

## Bottom line

All five normal-op write workflows are DB-only today → recommendation **A**
across the board, with the per-workflow CONFIRM checkbox as the last look
before each migration. The only long-term n8n write is payment proof (#6).
The automation-bridge design exists for when Phase 3 adds notifications —
nothing needs duplicating today, which makes this the cheapest possible
moment to move the writes.
