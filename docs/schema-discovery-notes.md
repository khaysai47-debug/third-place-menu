# Schema Discovery Notes — filled 2026-07-06 (STATUS: FILLED)

Phase 2B findings from read-only inspection of the n8n Cloud workflows and
their execution data. How this was gathered: `docs/schema-discovery-guide.md`.
Values marked *observed* were copied verbatim from real executions; values
marked *from workflow config* come from node configuration, not live data.

**⚠️ NO SECRETS IN THIS FILE.** This file is committed to git. Never paste an
anon key, service_role key, password, or full connection string here.

## Supabase project / connection
- Supabase REST API is called directly from n8n **HTTP Request nodes**
  (`supabase.co/rest/v1/<table>` URLs); project URL is visible in those nodes.
- Key type: appears **service-role-style** — the key is sent in both `apikey`
  and `Authorization: Bearer` headers.
- Credential storage: HTTP Request header key present in n8n node; exact key
  intentionally not recorded. Currently **hardcoded in node headers**, not an
  n8n credential.
- ⚠️ Remediation before production: rotate the key and move it into n8n
  credentials/env. The frontend must NEVER receive a service-role key — the
  Phase 2C client needs its own anon key + RLS decision.
- RLS status: **unknown** from n8n discovery.

## Workflows found (all Supabase-backed)
| Workflow | Webhook | Does |
| --- | --- | --- |
| Staff Orders API | GET `third-place-staff-orders` | reads `orders`, `order_items`, `payment_proofs` |
| Update Order Status API | POST `third-place-update-order-status` | PATCH `orders` by `order_number` |
| Order Intake API (Test) | POST `third-place-order-test` | inserts `orders` + `order_items` |
| Add Expense API | POST `third-place-add-expense` | inserts `expenses` |
| Add Payment Proof API | POST `third-place-add-payment-proof` | inserts `payment_proofs` |
| Get Expenses API | GET `third-place-get-expenses` | reads `expenses` for today |
| Menu Availability API | GET `third-place-menu-availability` | reads `menu_items` |
| Update Menu Availability API | POST `third-place-update-menu-availability` | PATCH `menu_items` by `item_code` |
| Update Payment API | POST `third-place-update-payment` | PATCH `orders` payment fields by `order_number` |

## Tables discovered
`orders`, `order_items`, `payment_proofs`, `expenses`, `menu_items`

## Orders table
- Table name: **`orders`**
- Primary key column: **`id`** (internal UUID; `order_items.order_id` points at it)
- Human order number column: **`order_number`** — e.g. `TP-20260705-182306`.
  This is what the frontend calls `orderId` / `airtableRecordId`.
- All columns: `id`, `order_number`, `order_type`, `status`, `table_number`,
  `customer_name`, `customer_phone`, `customer_address`, `customer_note`,
  `source`, `subtotal`, `delivery_fee`, `total`, `payment_method`,
  `payment_status`, `delivery_zone_id`, `delivery_location_name`,
  `airtable_record_id`, `created_at`, `updated_at`, `paid_at`,
  `cancellation_reason`, `cancelled_at`

### Insert mapping (Order Intake workflow)
| Column | Source |
| --- | --- |
| `order_number` | `body.orderId` |
| `order_type` | `body.orderType` |
| `status` | literal `"new"` |
| `table_number` | `body.tableNumber` |
| `customer_name` | `body.customer.name` |
| `customer_phone` | `body.customer.phone` |
| `customer_address` | `body.deliveryAddress` |
| `customer_note` | `body.notes` |
| `source` | literal `"customer_menu"` |
| `subtotal` | `body.subtotalPrice` |
| `delivery_fee` | `body.deliveryFee` |
| `total` | `body.totalPrice` |
| `payment_method` | `null` |

### Status update mapping
- `status` ← `body.status` (⚠️ **unconstrained** — n8n writes any string it receives)
- If status is `"cancelled"`: `cancellation_reason` ← `body.cancellationReason || "Other"`, `cancelled_at` ← now
- If status is NOT `"cancelled"`: `cancellation_reason` ← `null`, `cancelled_at` ← `null`
- Matching key: `order_number` = `body.orderId || body.airtableRecordId || body.recordId`

### Payment update mapping
- `payment_status` ← `body.paymentStatus || "paid"` (⚠️ lowercase default)
- `payment_method` ← `body.paymentMethod`
- `paid_at` ← `new Date().toISOString()`
- Matching key: same `order_number` fallback chain as status update

### Observed real orders (verbatim)
Delivery order: `order_number: TP-20260705-182306`, `order_type: delivery`,
`status: delivered`, `table_number: ""`, `customer_name: Khaing`,
`customer_address: Test`, `source: customer_menu`, `subtotal: 336`,
`delivery_fee: 30`, `total: 366` (numbers, not strings),
`payment_method: Transfer`, `payment_status: Paid`, `paid_at` present,
`cancellation_reason: null`, `cancelled_at: null`

Cancelled delivery order: `status: cancelled`, `payment_status: unpaid`,
`cancellation_reason: Duplicate order`, `cancelled_at` present (ISO timestamp)

Dine-in completed order: `order_type: dine_in`, `status: completed`,
`table_number: 1`, `payment_status: Paid`, `payment_method: Transfer`

## Items (table or JSON shape)
- Stored as: **separate table `order_items`** (one row per line;
  `order_id` → `orders.id`, NOT `order_number`)
- Columns: `id`, `order_id`, `menu_item_id`, `item_code`, `item_name`,
  `quantity`, `unit_price`, `line_total`, `note`, `created_at`
- Intake input shape per item: `item.id`, `item.name`, `item.quantity`,
  `item.unitPrice`, `item.lineTotal`
- Insert mapping: `order_id` ← inserted `orders.id`, `item_code` ← `item.id`,
  `item_name` ← `item.name`, `quantity` ← `item.quantity`,
  `unit_price` ← `item.unitPrice`, `line_total` ← `item.lineTotal`,
  `note` ← `null`
- Staff API output shape (what the frontend sees today): `id` ← `item_code`,
  `name` ← `item_name`, `quantity` ← `quantity`, `unitPrice` ← `unit_price`

## Expenses table
- Table name: **`expenses`**
- Columns: `id`, `expense_date`, `category`, `description`, `amount`,
  `payment_method`, `staff_name`, `note`, `created_at`
- ⚠️ No `EXP-…` human id column exists — Get Expenses maps `expense_id` ← `id`.
  The snake_case POST keys were NOT literally the column names:
  `paid_from` (frontend) → `payment_method` (column).
- Insert mapping (Add Expense): `expense_date` ← current **Bangkok** date
  `yyyy-MM-dd`; `category` ← `body.category || "Other"`;
  `description` ← `body.description || body.note || ""`;
  `amount` ← `Number(body.amount || 0)`;
  `payment_method` ← `body.paid_from || body.payment_method || "Other"`;
  `staff_name` ← `body.staff_name || "Staff"`; `note` ← `body.note || ""`
- Read output mapping (Get Expenses): `expense_id` ← `id`;
  `paid_from` ← `payment_method || "Other"`; `category` ← `category || "Other"`;
  `description` ← `description || note || ""`; `amount` ← `Number(amount || 0)`;
  `staff_name` ← `staff_name || ""`; `note` ← `note || ""`; plus
  `expense_date`, `created_at` passed through
- review_status: **does not exist** in this table (NOT FOUND)
- Observed row: `expense_date: 2026-07-05`, `category: Drinks`, `amount: 250`,
  `payment_method: Cash`, `staff_name: Staff`

## Payment proof storage
- Stored as: **separate table `payment_proofs`** with a URL column
  (`proof_url`) + file path column (`proof_file_path`)
- Written by: Add Payment Proof API workflow
- Columns (from workflow config): `id`, `order_id`, `proof_url`,
  `proof_file_path`, `source`, `status`, `note`, `received_at`, `created_at`
- Insert mapping: `order_id` ← `body.order_id`; `proof_url` ← `body.proof_url`;
  `proof_file_path` ← `body.proof_file_path || ""`;
  `source` ← `body.source || "manual-test"`; `status` ← `body.status || "received"`;
  `note` ← `body.note || ""`
- Link: Staff API matches `proof.order_id === order.id` (the UUID)
- ⚠️ Real proof row values NOT observed — latest inspected execution returned
  empty proof data. Columns confirmed from config only.

## Status values
- Column name: `orders.status`
- From workflow config (literals): `new`, `cancelled`
- **Observed in real data (verbatim):** `delivered`, `cancelled`, `completed`
- done vs completed: DB uses **`completed`** for finished dine-in;
  **`done` was NOT observed anywhere**. Delivery finishes as `delivered`
  (kept distinct — never merged).
- ⚠️ n8n does not validate status values — any `body.status` string gets
  written. `preparing` / `ready` / `out_for_delivery` are accepted but were
  not present in the inspected sample.

## Payment values
- Payment status column: `payment_status` — observed `Paid` (capital) and
  `unpaid` (lowercase). ⚠️ Workflow default writes lowercase `paid` when
  `paymentStatus` is missing → **adapter must normalize case**.
- Payment method column: `payment_method` — observed `Transfer` and `null`
  (`Cash` observed in expenses; verbatim casing is capitalized)
- paid_at column: `paid_at` (ISO string, set by n8n at update time)

## Delivery values
- `order_type` = `delivery`; `customer_name` / `customer_phone` /
  `customer_address` on the order row; `delivery_fee` (observed `30`, number);
  `subtotal` + `total` on the row
- `delivery_zone_id`, `delivery_location_name`: exist but observed `null`

## Cancellation values
- Reason column: `cancellation_reason` — observed `Duplicate order`;
  workflow default `"Other"` when body omits a reason
- Cancelled-at column: `cancelled_at` — ISO timestamp, set by n8n
- Non-cancel status updates actively reset both to `null`

## Menu items table (bonus — outside order/expense repos)
- Table: `menu_items`; columns: `id`, `item_code`, `name_en`, `category`,
  `price`, `is_available`, `sort_order`
- Read output mapping: `recordId` ← `id`; `menuItemId` ← `item_code`;
  `name` ← `name_en`; `price` ← `Number(price || 0)`;
  `available` ← `is_available === true`;
  `availability` ← `"Available"` / `"Sold Out"`
- Update: PATCH `menu_items` where `item_code` = `body.menuItemId`;
  `is_available` ← `body.availabilityStatus === "Available"`

## Timestamps & money
- Timestamps: ISO strings; `paid_at` is written as `new Date().toISOString()`
  (UTC). `expense_date` is a **Bangkok-local** `yyyy-MM-dd` date.
  (No full raw `created_at` value was copied — grab one during parity testing.)
- Money: observed as **numbers** (`336`, `30`, `366`, `250`), not strings.

## Adapter notes for Phase 2C
- Read `orders` + `order_items` + `payment_proofs` (orders) and `expenses`.
- `orders.id` = internal UUID; `orders.order_number` = business id the
  frontend uses as `orderId` / `airtableRecordId`.
- `order_items.order_id` and `payment_proofs.order_id` join on `orders.id`.
- Normalize `payment_status` case (`Paid` / `paid` / `unpaid` all live).
- Normalize empty/null strings on customer + cancellation fields.
- `DB_STATUS_USES_COMPLETED` (orderMapper.ts): **true** — DB stores
  `completed`, never `done`.
- Writes stay on n8n; reads don't flip until parity passes
  (`docs/adapter-parity-testing.md`).

### Confirmed 2026-07-06 by calling the live GET webhooks directly
- Staff Orders API emits `airtableRecordId` = `orderId` = **`order_number`**
  ("TP-…") — the frontend's orderKey is the order_number, NOT the row UUID.
  Combined with the write workflows matching by order_number, Supabase reads
  must put order_number in `airtableRecordId` or staff buttons break.
- Staff Orders API returns **all orders, no date filter** (July 3 + July 5
  rows in one response).
- Get Expenses API returns **today only** (empty `data` on a day with no
  expenses, while yesterday's rows exist) — Bangkok-local `expense_date`.
- Timestamps pass through from Supabase verbatim, e.g.
  `2026-07-05T11:23:07.579571+00:00` (created_at, microseconds) and
  `2026-07-05T11:25:34.372+00:00` (paid_at, milliseconds) — UTC offset form.
- Money values are JSON numbers. `paymentStatus` emitted as `Paid`/`unpaid`;
  `paymentMethod` as `Transfer`/`Cash`/null. Absent strings emitted as `""`,
  absent paidAt/paymentMethod as `null`.

## Unknown / risky fields
- RLS status: RESOLVED for reads (2026-07-06) — anon `GRANT SELECT` +
  permissive SELECT RLS policies (`USING (true)`) added manually on `orders`,
  `order_items`, AND `expenses` (the expenses one was found missing during
  QA-1: it returned 200 with rows RLS-filtered to empty — a silent failure
  mode to remember). `payment_proofs` readability gets verified in QA-2.
  No anon write grants exist (keep it that way).
  ⚠️ Full security posture still needs review before real restaurant use.
- `payment_proofs`: no real rows observed yet.
- `preparing` / `ready` / `out_for_delivery`: accepted by n8n, not yet seen
  in Supabase rows.
- `done`: not observed; whether it exists in old data is unconfirmed.
- `delivery_zone_id` / `delivery_location_name`: currently `null`; future
  fee logic TBD.
- `airtable_record_id` column exists on `orders` (legacy) — value not observed.
- No raw `created_at` example copied verbatim yet — capture one in Phase 2D.

---

STATUS is FILLED: every section has an answer or an explicit NOT FOUND.
Phase 2C can start (`docs/backend-separation-runbook.md`).
