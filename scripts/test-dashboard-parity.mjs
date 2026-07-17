// Dashboard shape-parity check (no test framework — run with
// `npm run test:dashboard-parity`). Proves the protected read routes hand
// the frontend EXACTLY the data the old direct anon reads did, for every
// field the mappers consume:
//
//   OLD: browser anon read select=* → full rows → orderMapper/expenseMapper
//   NEW: /api/staff/* → explicit-column rows → the SAME unchanged mappers
//
// Method: fixture DB rows (a superset, incl. columns the dashboard never
// used) are served through the compiled handler; the response rows must
// deep-equal the fixture restricted to the mapper-consumed field lists
// below. The lists are cross-checked against the mapper source files so a
// future mapper field can't silently drift out of the API contract.
// Controlled local fixtures only — no network, no Production.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/dashboard-parity-test";
execSync(
  `npx tsc api/_lib/staffDashboardReads.server.ts --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const { getStaffOrders, getStaffExpenses } = await import(
  pathToFileURL(path.resolve(outDir, "staffDashboardReads.server.js")).href
);

/* ── The mapper-consumed field lists (the dashboard's real data needs) ───── */

// Mirrors SupabaseOrderRow in src/lib/data/mappers/orderMapper.ts (minus the
// items/payment_proofs children, which are attached client-side).
const ORDER_FIELDS = [
  "id",
  "order_number",
  "order_type",
  "status",
  "table_number",
  "customer_name",
  "customer_phone",
  "customer_address",
  "customer_note",
  "subtotal",
  "delivery_fee",
  "total",
  "payment_method",
  "payment_status",
  "created_at",
  "paid_at",
  "cancellation_reason",
  "cancelled_at",
];
// Mirrors SupabaseOrderItemRow (created_at is only the server-side sort key).
const ORDER_ITEM_FIELDS = ["order_id", "item_code", "item_name", "quantity", "unit_price"];
// Mirrors SupabasePaymentProofRow.
const PAYMENT_PROOF_FIELDS = ["order_id", "proof_url", "status", "received_at", "created_at"];
// Mirrors SupabaseExpenseRow (minus expense_date — only ever the day filter).
const EXPENSE_FIELDS = [
  "id",
  "category",
  "description",
  "amount",
  "payment_method",
  "staff_name",
  "note",
  "created_at",
];

// Drift guard: every field above must still exist in the mapper row types.
// (created_at of order_items is exempt: it exists in the mapper type but is
// deliberately not returned — parseOrderItems never reads it.)
const orderMapperSource = readFileSync("src/lib/data/mappers/orderMapper.ts", "utf8");
const expenseMapperSource = readFileSync("src/lib/data/mappers/expenseMapper.ts", "utf8");
for (const field of [...ORDER_FIELDS, ...ORDER_ITEM_FIELDS, ...PAYMENT_PROOF_FIELDS]) {
  assert.ok(orderMapperSource.includes(`${field}?:`), `orderMapper still declares ${field}`);
}
for (const field of EXPENSE_FIELDS) {
  assert.ok(expenseMapperSource.includes(`${field}?:`), `expenseMapper still declares ${field}`);
}

/* ── Fixtures: what the OLD anon select=* read would have returned ───────── */

const OLD_ORDER_ROWS = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    order_number: "TP-20260717-180000",
    order_type: "dine_in",
    status: "completed",
    table_number: "4",
    customer_name: null,
    customer_phone: null,
    customer_address: null,
    customer_note: null,
    subtotal: 90,
    delivery_fee: 0,
    total: 90,
    payment_method: "Cash",
    payment_status: "Paid",
    created_at: "2026-07-17T11:00:00.000+00:00",
    paid_at: "2026-07-17T11:30:00.000+00:00",
    cancellation_reason: null,
    cancelled_at: null,
    // Columns select=* also returned but the dashboard never consumed:
    source: "customer_menu",
    client_request_id: "abc-123",
    airtable_record_id: null,
    delivery_zone_id: null,
    delivery_location_name: null,
    updated_at: "2026-07-17T11:30:00.000+00:00",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    order_number: "TP-20260717-190000",
    order_type: "delivery",
    status: "cancelled",
    table_number: null,
    customer_name: "Khaing",
    customer_phone: "0999",
    customer_address: "Condo A",
    customer_note: "call first",
    subtotal: 336,
    delivery_fee: 30,
    total: 366,
    payment_method: null,
    payment_status: "unpaid",
    created_at: "2026-07-17T12:00:00.000+00:00",
    paid_at: null,
    cancellation_reason: "Duplicate order",
    cancelled_at: "2026-07-17T12:05:00.000+00:00",
    source: "staff_manual",
    client_request_id: null,
    airtable_record_id: "recOld",
    delivery_zone_id: null,
    delivery_location_name: null,
    updated_at: "2026-07-17T12:05:00.000+00:00",
  },
];
const OLD_ITEM_ROWS = [
  {
    id: "line-1",
    order_id: OLD_ORDER_ROWS[0].id,
    menu_item_id: "menu-uuid",
    item_code: "A01",
    item_name: "Fried Rice",
    quantity: 1,
    unit_price: 90,
    line_total: 90,
    note: null,
    created_at: "2026-07-17T11:00:01.000+00:00",
  },
];
const OLD_PROOF_ROWS = [
  {
    id: "proof-1",
    order_id: OLD_ORDER_ROWS[1].id,
    proof_url: "https://proofs.invalid/slip.jpg",
    proof_file_path: "",
    source: "manual-test",
    status: "received",
    note: "",
    received_at: "2026-07-17T12:03:00.000+00:00",
    created_at: "2026-07-17T12:03:00.000+00:00",
  },
];
const OLD_EXPENSE_ROWS = [
  {
    id: "33333333-3333-3333-3333-333333333333",
    expense_date: "2026-07-17",
    category: "Drinks",
    description: "Soda restock",
    amount: 250,
    payment_method: "Cash",
    staff_name: "Staff",
    note: "",
    created_at: "2026-07-17T09:00:00.000+00:00",
  },
];

process.env.STAFF_WRITE_SECRET = "parity-test-secret";
process.env.VITE_SUPABASE_URL = "https://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-not-a-real-key";

globalThis.fetch = async (url) => {
  const u = String(url);
  // The stub honors the select= column list exactly like PostgREST would:
  // only requested columns come back. This keeps the fixture honest — the
  // handler cannot "accidentally" see unrequested columns.
  const select = new URL(u).searchParams.get("select")?.split(",") ?? [];
  const serve = (rows) =>
    Response.json(
      rows.map((row) => Object.fromEntries(select.map((field) => [field, row[field] ?? null]))),
    );
  if (u.includes("/rest/v1/orders?")) return serve(OLD_ORDER_ROWS);
  if (u.includes("/rest/v1/order_items?")) return serve(OLD_ITEM_ROWS);
  if (u.includes("/rest/v1/payment_proofs?")) return serve(OLD_PROOF_ROWS);
  if (u.includes("/rest/v1/expenses?")) return serve(OLD_EXPENSE_ROWS);
  throw new Error("unexpected fetch target in test");
};

const request = () =>
  new Request("https://app.invalid/api/staff/orders", {
    method: "GET",
    headers: { "x-staff-secret": "parity-test-secret" },
  });

/* ── The parity assertion: NEW rows === OLD rows on every consumed field ── */

const pick = (row, fields) => Object.fromEntries(fields.map((f) => [f, row[f] ?? null]));

const ordersResponse = await (await getStaffOrders(request())).json();
assert.equal(ordersResponse.ok, true, "orders snapshot ok");
assert.deepEqual(
  ordersResponse.data.orders,
  OLD_ORDER_ROWS.map((row) => pick(row, ORDER_FIELDS)),
  "orders: protected API returns exactly what the mappers consumed before",
);
assert.deepEqual(
  ordersResponse.data.orderItems,
  OLD_ITEM_ROWS.map((row) => pick(row, ORDER_ITEM_FIELDS)),
  "order_items parity",
);
assert.deepEqual(
  ordersResponse.data.paymentProofs,
  OLD_PROOF_ROWS.map((row) => pick(row, PAYMENT_PROOF_FIELDS)),
  "payment_proofs parity",
);

const expensesResponse = await (await getStaffExpenses(request())).json();
assert.equal(expensesResponse.ok, true, "expenses snapshot ok");
assert.deepEqual(
  expensesResponse.data.expenses,
  OLD_EXPENSE_ROWS.map((row) => pick(row, EXPENSE_FIELDS)),
  "expenses parity",
);

console.log("test-dashboard-parity: all assertions passed");
