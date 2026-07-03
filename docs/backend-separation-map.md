# Backend Separation Map

**Status:** planning document — nothing in here changes runtime behavior.
**Audience:** whoever executes the backend/frontend separation before real restaurant testing.

Atlas / The Third Place currently runs the whole product through **n8n as a temporary
MVP bridge** (n8n webhooks → Airtable). The target architecture moves dashboard
reads/writes to **Supabase / a real backend**, and reduces n8n to **automation only**
(Instagram/Messenger bot, payment proof intake, notifications).

The frontend is already structured for this: every screen calls domain functions in
`src/lib/`, and only those modules know about webhooks. **Separation = swapping the
implementations inside `src/lib/`, not rewriting screens.**

---

## 1. Current data flow

### Customer (`/` — `src/routes/index.tsx`)

| Concern | Today | Files / functions |
| --- | --- | --- |
| Menu content | Static bundled data, no fetch | `src/data/menu.ts` (`MENU`, `CATEGORIES`) |
| Live availability overlay | n8n read, 30s poll while visible + focus refresh | `src/lib/menuAvailability.ts` → `getMenuAvailability()` |
| Checkout / order submit | n8n webhook POST | `src/lib/orders.ts` → `submitOrder(OrderPayload)`; called from `src/components/menu/CheckoutDrawer.tsx` |
| Delivery fee | Fixed ฿30 constant for MVP | `DELIVERY_FEE` in `CheckoutDrawer.tsx` |
| Cart | localStorage only (`tp_cart`) | `src/routes/index.tsx` |

### Staff (`/staff` — `src/routes/staff.tsx`)

| Concern | Today | Files / functions |
| --- | --- | --- |
| Order board read | n8n read, 5s poll while visible | `src/lib/staffOrders.ts` → `getStaffOrders()` |
| Status advance (incl. delivery flow) | n8n write | `updateStaffOrderStatus(airtableRecordId, status)` |
| Cancel (new/preparing only, reason required) | Same status write with `cancellationReason` | `updateStaffOrderStatus(..., "cancelled", { cancellationReason })` |
| Mark paid (Cash/Transfer) | n8n write | `updateOrderPayment(airtableRecordId, method)` |
| Menu availability board | n8n read + write | `src/lib/menuAvailability.ts` → `getMenuAvailability()`, `updateMenuAvailability()` (via `src/components/staff/MenuAvailabilityBoard.tsx`) |
| Expense log (read + add) | n8n read + write | `src/lib/expenses.ts` → `getExpenses()`, `addExpense()` (via `src/components/staff/ExpenseView.tsx`) |
| Manual order entry | Same submit path as customer | `src/components/staff/ManualOrderForm.tsx` |

### Owner (`/owner` — `src/routes/owner.tsx`)

| Concern | Today | Files / functions |
| --- | --- | --- |
| Orders (all tabs: Overview/Orders/Payments/Reports) | Same feed as staff, **manual refresh only, no polling** | `getStaffOrders()` |
| Expenses (Overview + Reports) | n8n read, manual refresh only | `getExpenses()` |
| Menu tab | Static bundled `src/data/menu.ts`, zero fetch | `OwnerMenuView` in `owner.tsx` |
| Derived money math | Pure frontend functions | `src/lib/ownerSummary.ts` (`summarizeToday`, `todaysOrders`, `isSameLocalDay`) |
| Order business rules | Pure frontend functions | `src/lib/orderRules.ts` (`isPaymentRisk`, `isCompletedStatus`, `isCancellableStatus`, …) |
| Writes | **None.** Owner is read-only by design | — |

### Transport layer

- `src/lib/n8n.ts` — single source of the n8n base URL (`VITE_N8N_BASE_URL`) and
  `n8nWebhook(slug)`. **The only file that knows webhook URLs exist.**
- Webhook slugs in use:
  `third-place-order-test` (submit), `third-place-staff-orders` (read),
  `third-place-update-order-status`, `third-place-update-payment`,
  `third-place-menu-availability`, `third-place-update-menu-availability`,
  `third-place-get-expenses`, `third-place-add-expense`.

### Status vocabulary (do not change during separation)

- Flow: `new → preparing → ready → done` (dine-in/pickup), `new → preparing → ready → out_for_delivery → delivered` (delivery). `delivered` is **not** merged into `done`.
- Airtable calls `done` "completed" — translated **only** at the API boundary in `staffOrders.ts` (`API_STATUS_BY_UI` / `UI_STATUS_BY_API`). Keep this mapping (or retire it) inside the data layer.
- Cancellable = `new`/`preparing` only. Payment risk = `done`/`delivered` + `unpaid`. Cancelled orders never count toward money totals.
- All of this is encoded in `src/lib/orderRules.ts` and `nextStaffOrderStatus` in `staffOrders.ts`.

---

## 2. Target architecture after separation

```
Customer/Staff/Owner UI ──► src/lib domain functions ──► Supabase / real backend
                                                          (orders, payments, expenses, menu)

Instagram/Messenger, payment proof, notifications ──► n8n (automation only)
```

- Dashboard reads/writes: Supabase (or backend API in front of it).
- n8n keeps: bot conversations, payment-proof intake (which today sets
  `hasPaymentProof`/`paymentProofUrl` fields), notifications. It becomes an
  *event consumer/producer*, not the app's query engine.
- Order intake (`submitOrder`) may either move to the backend or stay as an n8n
  automation entry point — decide at separation time; the `OrderPayload` contract
  stays either way.

---

## 3. Migration order — safest first

1. **Reads first (lowest risk, biggest n8n-execution savings):**
   1. `getStaffOrders()` — one function, feeds both staff board and the whole owner dashboard.
   2. `getExpenses()` — one function, owner + staff expense views.
   3. `getMenuAvailability()` — customer overlay + staff board (this is the 30s customer poll, so it burns the most executions).
2. **Writes second (need parity testing against the live flows):**
   4. `updateStaffOrderStatus()` (incl. cancellation fields) and `updateOrderPayment()`.
   5. `addExpense()`, `updateMenuAvailability()`.
3. **Order intake last / optional:** `submitOrder()` — it's the piece most entangled
   with n8n automations (order-id generation downstream, notifications, bot replies).

Each step is: reimplement the function body against Supabase, keep the exported
signature and mapped types identical, verify the screen, delete the webhook call.
Mapping helpers (`mapApiOrder`, `mapApiExpense`, `mapApiMenuItem`) get replaced by
Supabase row mappers with the same output types.

### Safe to migrate anytime (no coordination needed)

- Everything in `src/lib/orderRules.ts`, `src/lib/ownerSummary.ts` — pure, transport-free.
- `src/data/menu.ts` static menu (owner Menu tab reads it directly).

### Do NOT touch yet

- `src/lib/n8n.ts` base URL / webhook slugs — live production paths.
- The `done` ⇄ `completed` Airtable translation until the Airtable backend is retired.
- `OrderPayload` shape — n8n automations downstream depend on these exact field names (snake-cased expense payload too: `item_name`, `paid_from`, …).
- Owner dashboard's manual-refresh-only behavior and staff's 5s poll — polling
  changes are a product decision, not part of separation.
- Payment-proof fields (`hasPaymentProof`, `paymentProofUrl`, `paymentProofStatus`) —
  they are written by the n8n bot flow and must keep working through separation.

---

## 4. Invariants to preserve (regression checklist)

- Owner: manual refresh only, zero polling, zero write actions.
- Staff flows unchanged: advance, cancel (new/preparing + reason), mark paid.
- Delivered stays separate from Done everywhere.
- Cancelled orders excluded from money totals; risk = done/delivered + unpaid.
- Fixed ฿30 delivery fee until made dynamic deliberately.
- Baht formatting `฿x,xxx` (`en-US` locale) everywhere.
