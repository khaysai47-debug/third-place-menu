# Adapter Contract Checklist

Manual verification list for any `OrderRepository` / `ExpenseRepository`
implementation (used because the repo intentionally has no test framework).
Run this before flipping `ACTIVE_READ_SOURCE` in `src/lib/data/dataSource.ts`,
comparing the candidate adapter's output against the live n8n adapter
**side-by-side on the same data**.

## How to compare (Phase 2B)

In a dev-only scratch (console or temporary route), call both adapters and diff:

```ts
const a = await n8nOrdersAdapter.listOrders();
const b = await supabaseOrdersAdapter.listOrders();
// diff JSON.stringify(a) vs JSON.stringify(b) — order and values must match
```

## Orders — listOrders()

- [ ] Returns `StaffOrder[]` sorted newest-first by `createdAt` (missing createdAt sorts last).
- [ ] `status` values are app vocabulary only: `new / preparing / ready / out_for_delivery / delivered / done / cancelled`.
- [ ] **`"completed"` from the database surfaces as `done`** — never leaks to the UI. (`normalizeOrderStatusFromDb`)
- [ ] Unknown status → `"new"`; unknown orderType → `"dine_in"`; non-numeric money → `0`.
- [ ] `orderKey` (currently `airtableRecordId`) is populated on every row that supports writes — without it, staff action buttons show "can't be updated".
- [ ] `orderId` is the human "TP-…" number, distinct from the row key.
- [ ] `time` renders HH:MM derived from `createdAt` ("—" when invalid).
- [ ] Payment fields preserved: `paymentStatus` (paid/unpaid), `paymentMethod` (exactly `"Cash"`/`"Transfer"` or undefined), `paidAt` ISO.
- [ ] Delivery fields preserved: `customerName`, `customerPhone`, `deliveryAddress`, `deliveryFee`, `subtotalPrice`, and delivery statuses (`out_for_delivery`, `delivered` stays separate from `done`).
- [ ] Cancellation fields preserved: `cancellationReason`, `cancelledAt`.
- [ ] Proof fields preserved: `hasPaymentProof` (true or undefined, never false), `paymentProofUrl`, `paymentProofStatus`, `paymentProofReceivedAt`.
- [ ] `items[]` have `name`, `quantity`, `unitPrice` (Reports best-sellers = qty × unitPrice).
- [ ] Read failures **throw** (UI error state + retry) — no silent empty arrays.

## Orders — writes (when implemented)

- [ ] `updateOrderStatus` / `updateOrderPayment` / `cancelOrder` **never throw** — they return `{ success: true } | { success: false, error }` (UI relies on this for optimistic revert + banner).
- [ ] Status writes store the DB's vocabulary (`normalizeOrderStatusToDb`, `DB_STATUS_USES_COMPLETED` flag verified against real schema).
- [ ] Payment write records method verbatim (`Cash`/`Transfer`) and payment status ("Paid" casing rule verified against schema).
- [ ] `cancelOrder` persists the reason and a cancelled-at timestamp.
- [ ] Writes keyed by row key, never by the human `orderId`.

## Expenses — listExpenses() / addExpense()

- [ ] Returns `Expense[]` newest-first by `createdAt`.
- [ ] snake_case → camelCase mapping matches `mapApiExpense` (item_name→itemName, paid_from→paidFrom, …).
- [ ] Unknown `paidFrom`/`category` fall back to `"Other"`; `reviewStatus` defaults `"Pending"` — owner's color map and paid-from breakdown key on these exact strings.
- [ ] `amount` is a number; Owner Net Today = collected − Σ amount must not change.
- [ ] `addExpense` never throws; payload field names stay snake_case.

## App-level invariants after any flip

- [ ] Owner dashboard: manual refresh only, zero polling, zero writes.
- [ ] Staff flows: advance, cancel (new/preparing + reason), mark paid — all work.
- [ ] Customer checkout unaffected (intake stays on n8n until its own phase).
- [ ] `OrderPayload` field names unchanged (n8n automations consume them).
