# Schema Discovery Guide (Phase 2B) — for a non-backend person

**Goal:** find out what the database behind n8n *actually* looks like, by
reading the n8n workflows. You are only LOOKING — do not edit, activate,
deactivate, or re-run anything. Everything you find goes into the worksheet at
the bottom; the code changes come later and are not your job in this phase.

**Why this matters:** the frontend has never seen a table or column name —
n8n owns all of that. Every `DISCOVERY_REQUIRED` marker in the code is a blank
that only this exercise can fill. Guessed names are forbidden in code.

---

## Step 1 — Open n8n

1. Go to **https://shanchin.app.n8n.cloud** and log in.
2. Open **Workflows** (left sidebar). You are looking for the workflows that
   power Atlas / The Third Place. The frontend calls these webhook paths — the
   workflow list should contain one workflow per path (names may differ;
   match by the webhook node's **Path** field):

   | Webhook path | What it does |
   | --- | --- |
   | `third-place-order-test` | order submit (customer checkout) |
   | `third-place-staff-orders` | order board READ |
   | `third-place-update-order-status` | status update WRITE |
   | `third-place-update-payment` | payment update WRITE |
   | `third-place-get-expenses` | expenses READ |
   | `third-place-add-expense` | expense WRITE |
   | `third-place-menu-availability` | menu availability READ |
   | `third-place-update-menu-availability` | menu availability WRITE |

## Step 2 — For each workflow, look at the data nodes

Open a workflow. You'll see connected boxes (nodes). The interesting ones:

- **Supabase nodes** (Supabase logo) — jackpot. Click one and note:
  - **Table** name (a dropdown or text field)
  - For inserts/updates: the **field/column list** it writes
  - For reads: any **filters/columns** it selects
- **Postgres nodes** — same as Supabase for our purposes; note table + columns
  (may contain raw SQL — copy the whole query text).
- **HTTP Request nodes** — check the URL. If it contains
  `supabase.co/rest/v1/<something>`, that `<something>` is a **table name**,
  and the JSON body keys are **column names**. Copy both.
- **Airtable nodes** — if still present, the store hasn't (fully) moved to
  Supabase yet. Note the **Base**, **Table**, and **field names** anyway —
  they tell us the current vocabulary that Supabase will inherit or translate.
- **Set / Edit Fields / Code nodes** — these often rename fields between the
  webhook and the database. If a Code node builds the response, its output
  keys are what the frontend sees, and its *input* keys are the real columns.

**Pro tip:** open a workflow's **Executions** tab and click a recent
successful execution. You can click each node and see the REAL input/output
JSON that flowed through it — actual field names and actual values. This is
the most reliable source; copy generously.

## Step 3 — Specific things to hunt down

Work through this list; each maps to a `DISCOVERY_REQUIRED` in code.

1. **Orders READ** (`third-place-staff-orders`): which table is read; how item
   lines are attached (a JSON column on the order row, or a second table
   joined/queried separately?).
2. **Order insert** (`third-place-order-test`): table + every column written.
3. **Status update** (`third-place-update-order-status`): which column stores
   status, and the EXACT values written — especially: does it write `done` or
   `completed`? What happens on cancel — which columns get the reason and the
   cancelled-at time?
4. **Payment update** (`third-place-update-payment`): columns for payment
   status/method/paid-at, and exact values with casing (`Paid` vs `paid`,
   `Cash`/`Transfer` vs lowercase).
5. **Delivery fields**: where customer name / phone / address / delivery fee /
   subtotal live on the order row.
6. **Payment proof**: which workflow (probably the bot flow) writes proof
   fields — is the image a URL column, a Supabase Storage bucket path, or an
   Airtable attachment? Which columns: has-proof flag, url, status, received-at?
7. **Expenses** (`third-place-get-expenses` / `third-place-add-expense`):
   table + columns; whether the insert's snake_case keys (`item_name`,
   `paid_from`, `created_by`…) are literally the column names; who generates
   the `EXP-…` id; what `review_status` defaults to.
8. **Timestamps**: for any `created_at`-like value in an execution, copy one
   real example verbatim (e.g. `2026-07-05T13:45:12+07:00`) — the suffix tells
   us the timezone story.
9. **Money values**: in execution output, is `total_price` shown as `150`
   (number) or `"150"` / `"150.00"` (string)? Copy one real example.
10. **Supabase connection info**: from any Supabase/HTTP node, note the
    project URL (`https://<ref>.supabase.co`) and which *kind* of credential
    n8n uses (anon key / service_role key / postgres password).
    **⚠️ Never copy the key itself anywhere** — not into the worksheet, not
    into chat. Record only the credential's *name* in n8n and its *type*.

## Step 4 — Fill in the worksheet

The blank worksheet already exists at `docs/schema-discovery-notes.md` — open
it and fill it in directly. Write `NOT FOUND` rather than guessing; partial is
fine — blanks just stay blocked. **Never paste keys/passwords into it** (it is
committed to git); the worksheet's header explains what's safe to record.

## Step 5 — Hand off

When the worksheet is filled, the next code phase (2C) is mechanical:
align `SupabaseOrderRow` / `SupabaseExpenseRow` with your notes, set
`DB_STATUS_USES_COMPLETED`, implement the two read methods, run parity
(docs/adapter-parity-testing.md). Nothing flips until parity passes.
