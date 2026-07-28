// Standalone Pre-Pilot Security Hardening check (no test framework — run with
// `npm run test:dashboard`). Compiles api/_lib/staffDashboardReads.server.ts
// to node_modules/.cache/staff-dashboard-test, then asserts the protected
// dashboard read contract:
//   - missing/wrong x-staff-secret → generic 401, ZERO Supabase calls,
//     no sensitive data in the body;
//   - correct secret → the mapped snapshot with EXACTLY the whitelisted
//     fields (extra DB columns can never leak);
//   - every Supabase request uses an explicit column list (no select=*)
//     and is a GET with no body (read-only guarantee);
//   - Supabase failure → one generic 502, no raw error/credential leak;
//   - the frontend adapters no longer contain any direct sensitive-table
//     Supabase read (source-level check).
// All fetches are stubbed — no network, no real secrets.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/staff-dashboard-test";
execSync(
  `npx tsc api/_lib/staffDashboardReads.server.ts --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
// Files inside node_modules get no package scope — restore ESM.
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const { getStaffOrders, getStaffExpenses, getProofHistory } = await import(
  pathToFileURL(path.resolve(outDir, "staffDashboardReads.server.js")).href
);

/* ── Fixtures — DB rows WITH extra sensitive columns that must never leak ── */

const SECRET = "dashboard-test-secret";
process.env.STAFF_WRITE_SECRET = SECRET;
process.env.VITE_SUPABASE_URL = "https://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-not-a-real-key";

const ORDER_ROW = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  order_number: "TP-20260717-120000",
  order_type: "delivery",
  status: "new",
  table_number: null,
  customer_name: "Test Customer",
  customer_phone: "0812345678",
  customer_address: "1 Test Road, Bangkok",
  customer_note: "no chili",
  subtotal: 150,
  delivery_fee: 30,
  total: 180,
  payment_method: null,
  payment_status: "unpaid",
  created_at: "2026-07-17T12:00:00.000+00:00",
  paid_at: null,
  cancellation_reason: null,
  cancelled_at: null,
  // Must NEVER appear in a response:
  client_request_id: "should-never-appear",
  source: "should-never-appear",
  airtable_record_id: "should-never-appear",
};
const ITEM_ROW = {
  order_id: ORDER_ROW.id,
  item_code: "B01",
  item_name: "Thai Tea",
  quantity: 2,
  unit_price: 45,
  line_total: "should-never-appear", // not part of the dashboard contract
};
const PROOF_ROW = {
  id: "cccccccc-dddd-eeee-ffff-000000000000",
  order_id: ORDER_ROW.id,
  // Chat proofs store a PRIVATE path, not a url. The DASHBOARD selects neither
  // (no signing on the poll); proof-history signs the path on demand. The
  // stored proof_url below is the LEGACY n8n permanent public link — it must
  // never appear in ANY response, which is what the assertions below prove.
  proof_url: "https://public.invalid/permanent-legacy-slip.jpg",
  proof_file_path: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/secret-storage-key.jpg",
  source: "bot_instagram",
  status: "pending",
  received_at: "2026-07-17T12:05:00.000+00:00",
  created_at: "2026-07-17T12:05:00.000+00:00",
  reviewed_at: null,
  reviewed_by: null,
  rejection_reason: null,
};
// A genuinely LEGACY proof: the old n8n workflow stored a permanent public
// url and no private object. It must yield NO preview url at all.
const LEGACY_PROOF_ROW = {
  id: "dddddddd-eeee-ffff-0000-111111111111",
  order_id: ORDER_ROW.id,
  proof_url: "https://public.invalid/legacy-only-permanent.jpg",
  proof_file_path: null,
  source: "n8n_legacy",
  status: "approved",
  received_at: "2026-07-16T10:00:00.000+00:00",
  created_at: "2026-07-16T10:00:00.000+00:00",
  reviewed_at: "2026-07-16T10:30:00.000+00:00",
  reviewed_by: "Legacy",
  rejection_reason: null,
};
const EXPENSE_ROW = {
  id: "bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
  category: "Drinks",
  description: "Ice",
  amount: 120,
  payment_method: "Cash",
  staff_name: "Staff",
  note: "",
  created_at: "2026-07-17T09:00:00.000+00:00",
  expense_date: "should-never-appear", // filter column, not a response field
};

let fetchLog = [];
let behavior = "ok"; // "ok" | "http500" | "reject"

globalThis.fetch = async (url, init = {}) => {
  fetchLog.push({ url: String(url), init });
  if (behavior === "reject") throw new TypeError("fetch failed");
  if (behavior === "http500") return new Response("boom secret-ish details", { status: 500 });
  const u = String(url);
  if (u.includes("/rest/v1/orders?")) return Response.json([ORDER_ROW]);
  if (u.includes("/rest/v1/order_items?")) return Response.json([ITEM_ROW]);
  if (u.includes("/rest/v1/payment_proofs?")) {
    // The history endpoint filters by order_id; the dashboard poll does not.
    return Response.json(u.includes("order_id=eq.") ? [LEGACY_PROOF_ROW, PROOF_ROW] : [PROOF_ROW]);
  }
  if (u.includes("/rest/v1/expenses?")) return Response.json([EXPENSE_ROW]);
  // Storage signed-URL request for a customer-uploaded proof.
  if (u.includes("/storage/v1/object/sign/"))
    return Response.json({ signedURL: "/object/sign/payment-proofs/x?token=SIGNED" });
  throw new Error("unexpected fetch target in test");
};

const makeRequest = (secret) =>
  new Request("https://app.invalid/api/staff/orders", {
    method: "GET",
    headers: secret === undefined ? {} : { "x-staff-secret": secret },
  });

async function run(handler, { secret, expect, label }) {
  fetchLog = [];
  const response = await handler(makeRequest(secret));
  const json = await response.json();
  assert.equal(response.status, expect, `${label}: status`);
  if (expect === 200) {
    assert.equal(json.ok, true, `${label}: ok`);
    assert.equal(response.headers.get("cache-control"), "no-store", `${label}: no-store`);
  } else {
    assert.equal(json.ok, false, `${label}: ok=false`);
    assert.equal(typeof json.error, "string", `${label}: generic error string`);
    const text = JSON.stringify(json);
    assert.ok(!text.includes("supabase"), `${label}: no supabase leakage`);
    assert.ok(!text.includes("boom"), `${label}: no raw upstream body`);
    assert.ok(!text.includes("dummy-not-a-real-key"), `${label}: no credential leak`);
    assert.ok(!text.includes("should-never-appear"), `${label}: no row data`);
  }
  return json;
}

/* ── A/B. Missing and wrong secret: generic 401, zero Supabase calls ─────── */

for (const handler of [getStaffOrders, getStaffExpenses]) {
  for (const [secret, label] of [
    [undefined, "missing secret"],
    ["", "empty secret"],
    ["wrong-secret", "wrong secret"],
  ]) {
    await run(handler, { secret, expect: 401, label: `${handler.name} ${label}` });
    assert.equal(fetchLog.length, 0, `${handler.name} ${label}: no Supabase call`);
  }
}

/* ── C. Correct secret: exactly the whitelisted fields, nothing extra ────── */

const orders = await run(getStaffOrders, { secret: SECRET, expect: 200, label: "orders ok" });
assert.deepEqual(orders.data, {
  orders: [
    {
      id: ORDER_ROW.id,
      order_number: "TP-20260717-120000",
      order_type: "delivery",
      status: "new",
      table_number: null,
      customer_name: "Test Customer",
      customer_phone: "0812345678",
      customer_address: "1 Test Road, Bangkok",
      customer_note: "no chili",
      subtotal: 150,
      delivery_fee: 30,
      total: 180,
      payment_method: null,
      payment_status: "unpaid",
      created_at: "2026-07-17T12:00:00.000+00:00",
      paid_at: null,
      cancellation_reason: null,
      cancelled_at: null,
    },
  ],
  orderItems: [
    {
      order_id: ORDER_ROW.id,
      item_code: "B01",
      item_name: "Thai Tea",
      quantity: 2,
      unit_price: 45,
    },
  ],
  paymentProofs: [
    {
      id: PROOF_ROW.id,
      order_id: ORDER_ROW.id,
      // The DASHBOARD returns proof STATUS only — NO url field at all. A
      // legacy permanent proof_url is not selected and cannot be relayed.
      status: "pending",
      received_at: "2026-07-17T12:05:00.000+00:00",
      created_at: "2026-07-17T12:05:00.000+00:00",
      rejection_reason: null,
    },
  ],
});
assert.ok(
  !JSON.stringify(orders).includes("should-never-appear"),
  "unapproved order fields must not leak",
);
// The private storage key (proof_file_path) must NEVER leave the server.
assert.ok(
  !JSON.stringify(orders).includes("secret-storage-key.jpg"),
  "private proof_file_path must not leak to the client",
);
// The LEGACY permanent public url must never be relayed by the poll.
assert.ok(
  !JSON.stringify(orders).includes("permanent-legacy-slip"),
  "legacy permanent proof_url must not reach the dashboard client",
);
assert.ok(
  !JSON.stringify(orders).includes("proof_url"),
  "the dashboard contract carries no proof_url field at all",
);

const expenses = await run(getStaffExpenses, { secret: SECRET, expect: 200, label: "expenses ok" });
assert.deepEqual(expenses.data, {
  expenses: [
    {
      id: EXPENSE_ROW.id,
      category: "Drinks",
      description: "Ice",
      amount: 120,
      payment_method: "Cash",
      staff_name: "Staff",
      note: "",
      created_at: "2026-07-17T09:00:00.000+00:00",
    },
  ],
});
assert.ok(
  !JSON.stringify(expenses).includes("should-never-appear"),
  "unapproved expense fields must not leak",
);

/* ── D. Explicit column lists — no select=* on any sensitive table ───────── */

fetchLog = [];
await getStaffOrders(makeRequest(SECRET));
await getStaffExpenses(makeRequest(SECRET));
// The dashboard poll does NO signing — every call is a /rest/v1 GET. Signing
// moved to the on-demand proof-history endpoint (tested separately below).
const restCalls = fetchLog.filter((c) => c.url.includes("/rest/v1/"));
const signCalls = fetchLog.filter((c) => c.url.includes("/storage/v1/object/sign/"));
assert.equal(restCalls.length, 4, "orders+items+proofs+expenses = 4 Supabase REST GETs");
assert.equal(signCalls.length, 0, "the dashboard poll signs NOTHING");
assert.equal(restCalls.length, fetchLog.length, "no unexpected fetch targets");
for (const call of restCalls) {
  const select = new URL(call.url).searchParams.get("select");
  assert.ok(select && select.length > 0, `explicit select on ${call.url}`);
  assert.ok(!select.includes("*"), `no select=* on ${call.url}`);
  // Read-only guarantee for data: GET, no body.
  assert.equal(call.init.method ?? "GET", "GET", `non-GET Supabase REST call: ${call.url}`);
  assert.equal(call.init.body, undefined, "Supabase REST calls must carry no body");
}
const urlFor = (table) => fetchLog.find((c) => c.url.includes(`/rest/v1/${table}?`)).url;
assert.equal(
  new URL(urlFor("orders")).searchParams.get("select"),
  "id,order_number,order_type,status,table_number,customer_name,customer_phone," +
    "customer_address,customer_note,subtotal,delivery_fee,total,payment_method," +
    "payment_status,created_at,paid_at,cancellation_reason,cancelled_at",
  "orders column contract",
);
assert.equal(
  new URL(urlFor("order_items")).searchParams.get("select"),
  "order_id,item_code,item_name,quantity,unit_price",
  "order_items column contract",
);
assert.equal(
  new URL(urlFor("payment_proofs")).searchParams.get("select"),
  "id,order_id,status,received_at,created_at,rejection_reason",
  "dashboard payment_proofs column contract (no proof_url, no proof_file_path)",
);
assert.equal(
  new URL(urlFor("expenses")).searchParams.get("select"),
  "id,category,description,amount,payment_method,staff_name,note,created_at",
  "expenses column contract",
);
assert.match(
  new URL(urlFor("expenses")).searchParams.get("expense_date") ?? "",
  /^eq\.\d{4}-\d{2}-\d{2}$/,
  "expenses filtered to the Bangkok service day",
);

/* ── E. Supabase failure → generic 502, no raw body/credential leak ──────── */

behavior = "http500";
await run(getStaffOrders, { secret: SECRET, expect: 502, label: "orders upstream 500" });
await run(getStaffExpenses, { secret: SECRET, expect: 502, label: "expenses upstream 500" });
behavior = "reject";
await run(getStaffOrders, { secret: SECRET, expect: 502, label: "orders network failure" });
await run(getStaffExpenses, { secret: SECRET, expect: 502, label: "expenses network failure" });
behavior = "ok";

/* ── Missing server env → safe 500 before any Supabase call ──────────────── */

delete process.env.SUPABASE_SERVICE_ROLE_KEY;
fetchLog = [];
const unconfigured = await getStaffOrders(makeRequest(SECRET));
assert.equal(unconfigured.status, 500, "unconfigured: safe 500");
assert.equal(fetchLog.length, 0, "unconfigured: no Supabase call");
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-not-a-real-key";

/* ── F/G. No direct sensitive Supabase read remains in the frontend ──────── */

// The only permitted supabaseSelect caller is the PUBLIC menu read.
const sensitiveTables = ["orders", "order_items", "payment_proofs", "expenses"];
for (const file of [
  "src/lib/data/adapters/supabaseOrdersAdapter.ts",
  "src/lib/data/adapters/supabaseExpensesAdapter.ts",
]) {
  const source = readFileSync(file, "utf8");
  assert.ok(!source.includes("supabaseSelect"), `${file}: no direct Supabase read`);
}
const menuSource = readFileSync("src/lib/menuAvailability.ts", "utf8");
for (const table of sensitiveTables) {
  assert.ok(!menuSource.includes(`"${table}"`), `menuAvailability must not read ${table}`);
}
// The read client sends the secret header and never embeds one.
const readClient = readFileSync("src/lib/data/staffReadClient.ts", "utf8");
assert.ok(readClient.includes("x-staff-secret"), "staffReadClient sends x-staff-secret");
assert.ok(readClient.includes("getStaffWriteSecret"), "secret comes from localStorage helper");

// The UI must start gated (including SSR/first paint), not flash dashboard
// content while waiting for the first protected request to reject.
for (const file of ["src/routes/staff.tsx", "src/routes/owner.tsx"]) {
  const source = readFileSync(file, "utf8");
  assert.ok(
    source.includes("const [unlocked, setUnlocked] = useState(false)"),
    `${file}: starts gated`,
  );
}

// A policy declared TO PUBLIC also applies to anon. The migration must remove
// both forms so a future grant cannot silently reopen the sensitive tables.
const migration = readFileSync("docs/sql/2026-07-17-pre-pilot-security-hardening.sql", "utf8");
assert.ok(
  migration.includes("array['anon', 'public']::text[]"),
  "migration covers policies inherited through PUBLIC",
);
for (const table of sensitiveTables) {
  assert.ok(
    migration.includes(
      `revoke all privileges on table public.${table} from anon, authenticated;`,
    ),
    `migration revokes every anon/authenticated table privilege on ${table}`,
  );
}
assert.ok(
  !migration.includes("from anon, authenticated, service_role"),
  "migration never revokes service_role",
);
assert.ok(!/revoke[^;]+public\.menu_items/i.test(migration), "migration never revokes menu_items");
assert.ok(
  migration.match(/and cmd = 'SELECT'/g)?.length === 2,
  "policy removal and verification are both limited to SELECT policies",
);
const rollbackMarker = migration.indexOf("-- ── 4. ROLLBACK");
assert.ok(rollbackMarker >= 0, "migration keeps an explicit rollback section");
const rollback = migration.slice(rollbackMarker);
const rollbackGrants = [...rollback.matchAll(/-- grant ([^;]+);/gi)].map((match) => match[1]);
assert.equal(rollbackGrants.length, 4, "rollback restores one grant per sensitive table");
assert.ok(
  rollbackGrants.every((grant) => grant.toLowerCase().startsWith("select on ")),
  "rollback grants only SELECT",
);
assert.ok(
  !/grant\s+(insert|update|delete|truncate|trigger|references)/i.test(rollback),
  "rollback restores no unnecessary privilege",
);

/* ── H. Access gate UI (source-level, matching the repo's test style) ────── */

// The browser-native prompt is gone from the whole access flow.
for (const file of [
  "src/components/staff/AccessGate.tsx",
  "src/lib/staffWriteSecret.ts",
  "src/routes/staff.tsx",
  "src/routes/owner.tsx",
]) {
  assert.ok(!readFileSync(file, "utf8").includes("window.prompt"), `${file}: no window.prompt`);
}

const gateSource = readFileSync("src/components/staff/AccessGate.tsx", "utf8");
// Real password field with show/hide, submitted through a form (Enter works),
// one primary submit button, inline rejection error.
assert.ok(gateSource.includes('"password"'), "gate renders a password input");
assert.ok(gateSource.includes("<form"), "gate submits via a form");
assert.ok(gateSource.includes('type="submit"'), "gate has a submit button");
assert.ok(gateSource.includes("Hide access key"), "gate has a show/hide toggle");
assert.ok(gateSource.includes("Incorrect access key."), "inline rejected-key error");
// Copy contract: distinct staff/owner titles, minimal bilingual labels.
assert.ok(gateSource.includes("Staff Access"), "staff title");
assert.ok(gateSource.includes("员工专用"), "staff label");
assert.ok(gateSource.includes("Owner Access"), "owner title");
assert.ok(gateSource.includes("店主专用"), "owner label");
// The entered key is stored ONLY through the existing localStorage helper —
// never read/written directly, never placed in a URL.
assert.ok(gateSource.includes("setStaffWriteSecret"), "gate stores via the secret helper");
assert.ok(!gateSource.includes("localStorage."), "no direct localStorage access in the gate");

// Both dashboards keep the gate-before-content rule and use the right area.
const staffPage = readFileSync("src/routes/staff.tsx", "utf8");
const ownerPage = readFileSync("src/routes/owner.tsx", "utf8");
assert.ok(staffPage.includes("!unlocked || accessDenied"), "staff page stays gated");
assert.ok(staffPage.includes('area="staff"'), "staff page uses staff copy");
assert.ok(ownerPage.includes("!unlocked || accessDenied"), "owner page stays gated");
assert.ok(ownerPage.includes('area="owner"'), "owner page uses owner copy");

/* ── I. Proof history — signed previews ON DEMAND, storage key never leaks ── */

behavior = "ok";
const historyReq = (secret) =>
  new Request("https://app.invalid/api/staff/proof-history?order=TP-20260717-120000", {
    method: "GET",
    headers: secret === undefined ? {} : { "x-staff-secret": secret },
  });

// Missing secret → 401, zero Supabase calls.
fetchLog = [];
const histDenied = await getProofHistory(historyReq(undefined));
assert.equal(histDenied.status, 401, "proof-history requires the staff secret");
assert.equal(fetchLog.length, 0, "no Supabase call without auth");

// Authorized → the order's proofs with a SHORT-LIVED SIGNED preview url.
fetchLog = [];
const histRes = await getProofHistory(historyReq(SECRET));
const hist = await histRes.json();
assert.equal(histRes.status, 200, "proof-history ok");
assert.equal(hist.ok, true, "proof-history ok flag");
assert.deepEqual(hist.data.proofs, [
  {
    // LEGACY row: permanent public url dropped, nothing to sign, hasFile false
    // → the drawer renders "Legacy proof preview unavailable".
    id: LEGACY_PROOF_ROW.id,
    proof_url: null,
    hasFile: false,
    status: "approved",
    source: "n8n_legacy",
    received_at: "2026-07-16T10:00:00.000+00:00",
    created_at: "2026-07-16T10:00:00.000+00:00",
    reviewed_at: "2026-07-16T10:30:00.000+00:00",
    reviewed_by: "Legacy",
    rejection_reason: null,
  },
  {
    // Private object: a FRESH short-lived signed url, never the stored value.
    id: PROOF_ROW.id,
    proof_url: "https://supabase.invalid/storage/v1/object/sign/payment-proofs/x?token=SIGNED",
    hasFile: true,
    status: "pending",
    source: "bot_instagram",
    received_at: "2026-07-17T12:05:00.000+00:00",
    created_at: "2026-07-17T12:05:00.000+00:00",
    reviewed_at: null,
    reviewed_by: null,
    rejection_reason: null,
  },
]);
// The private storage key must NEVER appear in the proof-history response.
assert.ok(
  !JSON.stringify(hist).includes("secret-storage-key.jpg"),
  "proof-history never returns proof_file_path",
);
// NEITHER stored permanent url may be relayed, for either row.
assert.ok(
  !JSON.stringify(hist).includes("public.invalid"),
  "proof-history never returns a stored permanent proof_url",
);
// It signed ONCE — only the row that actually has a private object.
assert.equal(
  fetchLog.filter((c) => c.url.includes("/storage/v1/object/sign/")).length,
  1,
  "proof-history signs only the proof with a private object",
);
// proof_url is not even SELECTed from the database.
const historySelect = new URL(
  fetchLog.find((c) => c.url.includes("/rest/v1/payment_proofs?")).url,
).searchParams.get("select");
assert.ok(!historySelect.includes("proof_url"), "history never reads the legacy proof_url column");
assert.ok(historySelect.includes("proof_file_path"), "history reads the private path (to sign it)");

console.log("test-staff-dashboard: all assertions passed");
