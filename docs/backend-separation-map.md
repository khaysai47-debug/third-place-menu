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

---

## 5. Phase 1 Data Shape Findings

Read straight from the code (types + mappers + every UI consumer). This is the
contract the Supabase adapters must reproduce field-for-field.

### 5.1 StaffOrder — the dashboard order shape (`src/lib/staffOrders.ts`)

**Required fields (non-optional in the type):**

| Field | Type | Consumers |
| --- | --- | --- |
| `orderId` | `string` (human "TP-…") | all cards/rows/modals, React keys |
| `orderType` | `"dine_in" \| "pickup" \| "delivery"` | `orderLocation`, delivery flow, filters, `orderRules` |
| `tableNumber` | `string \| null` | `orderLocation` (dine-in title) |
| `time` | `string` HH:MM, **derived from `createdAt` by the mapper** ("—" if invalid) | every card/row/modal |
| `items` | `{ id?, name, quantity, unitPrice }[]` | staff cards, owner modal, Reports best sellers (qty × unitPrice) |
| `notes` | `string \| null` | staff drawer, owner modal |
| `totalPrice` | `number` | all money math (summary, filters, reports) |
| `status` | 7-value union | everything; see translation warning below |
| `paymentStatus` | `"unpaid" \| "paid"` | payment badges, risk, summary |

**Optional fields and who needs them:**

| Field | Consumers | Notes |
| --- | --- | --- |
| `airtableRecordId` | staff writes only | **gates all actions** — no id ⇒ buttons error out ("this order can't be updated"). This is the `orderKey` of the repository layer. |
| `createdAt` (ISO) | owner "today" windows (`isSameLocalDay`), newest-first sort, revenue-by-hour fallback | orders without it fall out of owner views; sort treats missing as `""` |
| `customerName` / `customerPhone` / `deliveryAddress` | staff delivery block, owner modal/rows | delivery orders only in practice |
| `subtotalPrice`, `deliveryFee` | owner modal + staff card fee row | mapper coerces to `0` when absent; **UI displays ฿30 when `deliveryFee` is 0/absent** (`displayDeliveryFee` fallback in StaffOrderCard + OwnerOrderModal) |
| `paymentMethod` | badges, Payment Mix, cash/transfer totals | only `"Cash"`/`"Transfer"` verbatim (Airtable select values); anything else is dropped to `undefined` by the mapper |
| `paidAt` (ISO) | owner Paid At column, modal, revenue-by-hour (falls back to `createdAt`) | written by n8n on payment |
| `hasPaymentProof` | proof badges/links | mapper yields `true` or `undefined`, never `false` |
| `paymentProofUrl` | "View proof/slip" links (staff card, owner modal, Payments tab) | |
| `paymentProofStatus` | owner modal small text | |
| `paymentProofReceivedAt` | **mapped but not displayed anywhere yet** | keep mapping it |
| `cancellationReason` | staff card/drawer, owner rows/modal/Reports | required by the cancel flow |
| `cancelledAt` (ISO) | owner Cancelled Today day-attribution (falls back to `createdAt`), modal | |

**Mapper defense rules (must survive the adapter swap):** unknown `status` → `"new"`,
unknown `orderType` → `"dine_in"`, non-numeric numbers → `0`, empty strings → `undefined`/`null`,
list sorted newest-first by `createdAt` string compare.

### 5.2 Dangerous translation rules

1. **`done` ⇄ `"completed"`** — Airtable stores "completed"; the whole UI uses `done`.
   Translated **only** in `staffOrders.ts` (`API_STATUS_BY_UI` / `UI_STATUS_BY_API`), both
   read and write directions. A Supabase implementation must either store `done`
   or reproduce this exact mapping in its adapter — never let "completed" leak into the UI.
2. **Payment status casing** — reads lowercase (`"paid"` else unpaid); the write path
   sends capitalized `"Paid"` (Airtable select value). Case-sensitive on the DB side.
3. **Delivery fee display fallback** — `deliveryFee: 0` renders as ฿30 in staff/owner
   detail views. If Supabase stores real zeros for free delivery someday, this UI rule
   must be revisited deliberately.
4. **Write results never throw** — `updateStaffOrderStatus` / `updateOrderPayment` /
   `addExpense` return `{ success, error? }`; the UIs rely on that for optimistic
   revert + inline banners. Reads (`getStaffOrders`, `getExpenses`) **do** throw.

### 5.3 Expense shape (`src/lib/expenses.ts`)

- API is snake_case, UI is camelCase: `item_name→itemName`, `paid_from→paidFrom`,
  `created_at→createdAt`, `created_by→createdBy`, `review_status→reviewStatus`,
  `expense_id→expenseId`.
- GET response is **wrapped**: `{ success: true, data: [...] }` (orders GET is a raw array — inconsistent, adapters normalize).
- Fallbacks: unknown `paidFrom`/`category` → `"Other"`; `reviewStatus` defaults `"Pending"`.
- POST payload stays snake_case (`item_name, amount, paid_from, category, note?, created_by?`) — n8n depends on these names.
- UI consumers: ExpenseView list/form; owner ExpenseSummary (paidFrom breakdown, category colors keyed by exact category strings); owner Net Today = collected − sum(amount).

### 5.4 Customer OrderPayload (`src/lib/orders.ts`)

- camelCase throughout; `status: "draft"` always; items carry `lineTotal` and `unitPrice`
  (derived `subtotal/qty`); `totalItems`, `subtotalPrice`, `deliveryFee`, `totalPrice`.
- Dine-in: `customer.name/phone` forced `null`, `tableNumber` set; delivery: `deliveryAddress` set.
- `orderId` generated client-side: `TP-YYYYMMDD-HHMMSS` (second-resolution — a real
  backend should own id generation eventually).
- **Do not rename fields** — n8n automations consume them verbatim.

### 5.5 Menu shapes

- Static bundle `src/data/menu.ts` (`MenuItem`): customer menu + owner Menu tab use
  `id, nameEn, category, price?, unit?, available, popular, order, descriptionEn, image?`.
  `price === undefined` means "needs price confirmation" (owner Needs Price filter).
- Live overlay `src/lib/menuAvailability.ts` (`MenuAvailabilityItem`): keyed by
  `menuItemId` (e.g. "B01"), **never recordId**; `availability: "Available" | "Sold Out" | "Hidden"`;
  unknown → `"Hidden"` (fail-closed). Customer menu drops `Hidden`, flags `Sold Out`.

---

## 6. Phase 1 adapter layer (built, wired, behavior unchanged)

```
staff.tsx / owner.tsx / ExpenseView
        │  (unchanged public behavior)
        ▼
src/lib/data/orderRepository.ts · expenseRepository.ts   ← screens import these
        ▼
src/lib/data/dataSource.ts   ACTIVE_DATA_SOURCE = "n8n"  ← the one-line Phase 2 switch
        ▼                                    ▼
adapters/n8nOrdersAdapter        adapters/supabaseOrdersAdapter   (stub, throws)
adapters/n8nExpensesAdapter      adapters/supabaseExpensesAdapter (stub, throws)
        ▼
src/lib/staffOrders.ts · orders.ts · expenses.ts   (unchanged n8n implementations)
```

- The n8n adapters are pure delegation — no logic duplicated, signatures identical.
- Wired call sites: staff board (list/status/payment/cancel), owner dashboard
  (orders + expenses reads), staff ExpenseView (list/add). **Owner still calls
  only list methods — read-only invariant intact.**
- NOT wired (deliberate): customer checkout + staff ManualOrderForm `submitOrder`
  (order intake stays an n8n automation for now) and menu availability
  (`getMenuAvailability`/`updateMenuAvailability`) — both migrate in later phases.
- The switch is a code constant, **not** an env var, so production cannot drift to
  the unimplemented Supabase adapter through configuration. Flipping it today makes
  every data call throw `AdapterNotImplementedError` — loud, not silent.
- Phase 2 = implement the two Supabase adapters against the shapes in section 5,
  flip `ACTIVE_DATA_SOURCE`, run the section 4 checklist.

---

## 7. Future Menu Management Architecture

Today: customer menu + owner Menu tab render the static bundled snapshot
(`src/data/menu.ts`); staff Menu board reads/writes live availability through n8n.
After separation the menu becomes real backend-managed data with one repository:

```ts
// Future MenuRepository (documentation only — do not implement in Phase 1/2)
interface MenuRepository {
  listMenuItems(): Promise<MenuItem[]>;            // replaces static MENU + availability overlay
  updateAvailability(menuItemId, status): Promise<Result>; // absorbs staff Menu board writes
  updatePrice(menuItemId, price): Promise<Result>;          // owner, clears "needs price"
  updateStock(menuItemId, stock): Promise<Result>;          // new capability (low-stock alerts)
  createItem(draft): Promise<Result>;
  updateItem(menuItemId, patch): Promise<Result>;
  archiveItem(menuItemId): Promise<Result>;                 // soft delete — order history references items
}
```

Notes for that phase:
- Owner Menu tab is already structured for this (summary cards, filters, table) —
  it swaps its data source from `MENU` to `listMenuItems()` and gains write actions.
- Customer menu must keep the fail-open behavior: if live menu data is unreachable,
  render the last-known/bundled snapshot with a soft notice rather than an empty menu.
- `menuItemId` (e.g. "B01") stays the public key; keep record/row ids internal.
- The `price === undefined` "needs confirmation" state should become an explicit
  flag or nullable column, not an accidental absence.
