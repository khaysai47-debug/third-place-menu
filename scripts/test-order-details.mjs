// Standalone Phase 3B check (no test framework — run with
// `npm run test:order-details`). Compiles api/_lib/orderDetails.server.ts
// (which pulls in orderEventJwt.server.ts + staffOrderWrites.server.ts) to
// node_modules/.cache/order-details-test, then asserts the full endpoint
// contract: JWT verification (structure, alg, signature, claims, times),
// token↔body binding, body validation, Supabase read mapping, not-found and
// failure handling — and that EVERY outgoing Supabase call is a GET.
// All fetches are stubbed — no network, no real secrets.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/order-details-test";
execSync(
  `npx tsc api/_lib/orderDetails.server.ts --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
// Files inside node_modules get no package scope — restore ESM.
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const { postOrderDetails } = await import(
  pathToFileURL(path.resolve(outDir, "orderDetails.server.js")).href
);

/* ── Test fixtures ───────────────────────────────────────────────────────── */

const SECRET = "order-details-test-secret";
const EVENT_ID = "11111111-2222-3333-4444-555555555555";
const ORDER_NUMBER = "TP-20260715-120000";

process.env.N8N_AUTOMATION_SECRET = SECRET;
process.env.VITE_SUPABASE_URL = "https://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-not-a-real-key";

const b64u = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

/** Builds a JWT like Phase 3A does, with per-test overrides. */
function makeJwt({ header, claims = {}, secret = SECRET, signature } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64u(header ?? { alg: "HS256", typ: "JWT" });
  const p = b64u({
    iss: "atlas-order-bridge",
    aud: "n8n-order-automation",
    sub: "order.created",
    jti: EVENT_ID,
    iat: now,
    nbf: now - 5,
    exp: now + 120,
    eventId: EVENT_ID,
    eventType: "order.created",
    occurredAt: "2026-07-15T12:00:00.000Z",
    orderNumber: ORDER_NUMBER,
    channel: "customer",
    ...claims, // an override of undefined DELETES the claim (JSON.stringify drops it)
  });
  const s = signature ?? createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

// Stubbed Supabase rows — numeric-string subtotal on purpose (Postgres
// numeric can serialize that way; the mapper must coerce it).
const ORDER_ROW = {
  id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  order_number: ORDER_NUMBER,
  order_type: "delivery",
  status: "new",
  source: "customer_menu",
  table_number: null,
  customer_name: "Test Customer",
  customer_phone: "0812345678",
  customer_address: "1 Test Road, Bangkok",
  customer_note: "no chili",
  subtotal: "150.00",
  delivery_fee: 30,
  total: 180,
  payment_method: null,
  payment_status: "unpaid",
  created_at: "2026-07-15T12:00:00.000+00:00",
  // Fields that must NOT leak into the response:
  client_request_id: "should-never-appear",
  airtable_record_id: "should-never-appear",
};
const ITEM_ROWS = [
  { item_code: "B01", item_name: "Thai Tea", quantity: 2, unit_price: 45, line_total: 90 },
  { item_code: "A02", item_name: "Fried Rice", quantity: 1, unit_price: 60, line_total: 60 },
];

let fetchLog = [];
let ordersBehavior = "ok"; // "ok" | "empty" | "http500" | "reject"
let itemsBehavior = "ok";
let orderRowOverride = null; // spread over ORDER_ROW per test (malformed-row cases)
let itemRowsOverride = null; // replaces ITEM_ROWS per test

globalThis.fetch = async (url, init = {}) => {
  fetchLog.push({ url: String(url), init });
  const u = String(url);
  if (u.includes("/rest/v1/orders?")) {
    if (ordersBehavior === "reject") throw new TypeError("fetch failed");
    if (ordersBehavior === "http500") return new Response("boom", { status: 500 });
    return Response.json(ordersBehavior === "empty" ? [] : [{ ...ORDER_ROW, ...orderRowOverride }]);
  }
  if (u.includes("/rest/v1/order_items?")) {
    if (itemsBehavior === "http500") return new Response("boom", { status: 500 });
    return Response.json(itemRowsOverride ?? ITEM_ROWS);
  }
  throw new Error("unexpected fetch target in test");
};

const goodBody = () => JSON.stringify({ eventId: EVENT_ID, orderNumber: ORDER_NUMBER });

const makeRequest = ({ auth, body = goodBody(), contentType = "application/json" } = {}) =>
  new Request("https://app.invalid/api/automation/order-details", {
    method: "POST",
    headers: {
      ...(contentType === null ? {} : { "content-type": contentType }),
      ...(auth === undefined ? {} : { authorization: auth }),
    },
    body,
  });

async function expectStatus(expected, options, label) {
  fetchLog = [];
  const response = await postOrderDetails(makeRequest(options));
  const json = await response.json();
  assert.equal(response.status, expected, `${label}: status`);
  if (expected === 200) {
    assert.equal(json.ok, true, `${label}: ok`);
  } else {
    assert.equal(json.ok, false, `${label}: ok=false`);
    assert.equal(typeof json.error, "string", `${label}: generic error string`);
    assert.ok(!JSON.stringify(json).includes("supabase"), `${label}: no supabase leakage`);
  }
  return json;
}

const allCalls = [];
const trackCalls = () => allCalls.push(...fetchLog);

/* ── 1. Happy path: full response contract, field by field ───────────────── */

const ok = await expectStatus(200, { auth: `Bearer ${makeJwt()}` }, "valid request");
trackCalls();
assert.deepEqual(ok, {
  ok: true,
  data: {
    eventId: EVENT_ID,
    order: {
      orderNumber: ORDER_NUMBER,
      channel: "customer",
      orderType: "delivery",
      status: "new",
      paymentStatus: "unpaid",
      paymentMethod: null,
      customerName: "Test Customer",
      customerPhone: "0812345678",
      deliveryAddress: "1 Test Road, Bangkok",
      tableNumber: null,
      customerNote: "no chili",
      subtotal: 150, // coerced from the "150.00" numeric string
      deliveryFee: 30,
      total: 180,
      createdAt: "2026-07-15T12:00:00.000+00:00",
    },
    items: [
      { itemCode: "B01", itemName: "Thai Tea", quantity: 2, unitPrice: 45, lineTotal: 90 },
      { itemCode: "A02", itemName: "Fried Rice", quantity: 1, unitPrice: 60, lineTotal: 60 },
    ],
  },
});
assert.ok(!JSON.stringify(ok).includes("should-never-appear"), "unapproved fields must not leak");

/* ── 2–3. Authorization header problems (all generic 401) ────────────────── */

const jwt = makeJwt();
for (const [auth, label] of [
  [undefined, "missing Authorization"],
  ["", "empty Authorization"],
  [jwt, "missing Bearer scheme"],
  [`bearer ${jwt}`, "lowercase scheme"],
  [`Token ${jwt}`, "wrong scheme"],
  ["Bearer ", "empty token"],
  [`Bearer ${jwt} ${jwt}`, "two tokens"],
  [`Bearer ${jwt}, Bearer ${jwt}`, "comma-joined repeated header"],
]) {
  await expectStatus(401, { auth }, label);
  assert.equal(fetchLog.length, 0, `${label}: no Supabase call`);
}

/* ── 4. Malformed JWTs ───────────────────────────────────────────────────── */

for (const [token, label] of [
  ["abc", "one segment"],
  ["abc.def", "two segments"],
  ["a.b.c.d", "four segments"],
  ["..", "empty segments"],
  ["!!!.@@@.###", "invalid base64url characters"],
  [`${Buffer.from("not json").toString("base64url")}.${jwt.split(".")[1]}.x`, "non-JSON header"],
  [
    `${b64u({ alg: "HS256" })}.${Buffer.from("not json").toString("base64url")}.x`,
    "non-JSON payload",
  ],
  ["x".repeat(5000) + ".a.b", "oversized token"],
]) {
  await expectStatus(401, { auth: `Bearer ${token}` }, label);
  assert.equal(fetchLog.length, 0, `${label}: no Supabase call`);
}

/* ── 5–8. Time and algorithm claims ──────────────────────────────────────── */

const now = Math.floor(Date.now() / 1000);
await expectStatus(401, { auth: `Bearer ${makeJwt({ claims: { exp: now - 300 } })}` }, "expired");
await expectStatus(
  401,
  { auth: `Bearer ${makeJwt({ claims: { nbf: now + 300 } })}` },
  "nbf too far in the future",
);
await expectStatus(
  401,
  { auth: `Bearer ${makeJwt({ claims: { iat: now + 300 } })}` },
  "iat in the future",
);
await expectStatus(401, { auth: `Bearer ${makeJwt({ claims: { exp: undefined } })}` }, "no exp");
await expectStatus(401, { auth: `Bearer ${makeJwt({ claims: { nbf: undefined } })}` }, "no nbf");
await expectStatus(
  401,
  { auth: `Bearer ${makeJwt({ secret: "wrong-secret" })}` },
  "wrong signature",
);
await expectStatus(
  401,
  { auth: `Bearer ${makeJwt({ signature: "" })}` },
  "empty signature segment",
);
await expectStatus(401, { auth: `Bearer ${makeJwt({ header: { alg: "none" } })}` }, "alg none");
await expectStatus(
  401,
  { auth: `Bearer ${makeJwt({ header: { alg: "HS512", typ: "JWT" } })}` },
  "unexpected algorithm",
);
await expectStatus(401, { auth: `Bearer ${makeJwt({ header: { typ: "JWT" } })}` }, "missing alg");

/* ── 9–12. Registered claim mismatches ───────────────────────────────────── */

await expectStatus(401, { auth: `Bearer ${makeJwt({ claims: { iss: "evil" } })}` }, "wrong iss");
await expectStatus(401, { auth: `Bearer ${makeJwt({ claims: { aud: "evil" } })}` }, "wrong aud");
await expectStatus(
  401,
  { auth: `Bearer ${makeJwt({ claims: { sub: "order.updated" } })}` },
  "wrong sub",
);
await expectStatus(
  401,
  { auth: `Bearer ${makeJwt({ claims: { jti: "some-other-id" } })}` },
  "jti != eventId",
);
// Channel vocabulary (Phase 3C: customer/staff/instagram/messenger) — the
// verifier still rejects anything outside it, wrong casing, empty, missing.
await expectStatus(
  401,
  { auth: `Bearer ${makeJwt({ claims: { channel: "line" } })}` },
  "unknown channel claim",
);
await expectStatus(
  401,
  { auth: `Bearer ${makeJwt({ claims: { channel: "Instagram" } })}` },
  "wrong-cased channel claim",
);
await expectStatus(
  401,
  { auth: `Bearer ${makeJwt({ claims: { channel: "" } })}` },
  "empty channel claim",
);
await expectStatus(
  401,
  { auth: `Bearer ${makeJwt({ claims: { channel: 7 } })}` },
  "non-string channel claim",
);
await expectStatus(
  401,
  { auth: `Bearer ${makeJwt({ claims: { channel: undefined } })}` },
  "missing channel claim",
);

/* ── Phase 3C: bot channels are valid vocabulary; source → channel mapping ── */

// instagram/messenger tokens verify (future trusted callers). The response
// channel still comes from orders.source — never from the token.
const igToken = await expectStatus(
  200,
  { auth: `Bearer ${makeJwt({ claims: { channel: "instagram" } })}` },
  "instagram channel accepted",
);
trackCalls();
assert.equal(igToken.data.order.channel, "customer", "response channel comes from orders.source");
await expectStatus(
  200,
  { auth: `Bearer ${makeJwt({ claims: { channel: "messenger" } })}` },
  "messenger channel accepted",
);
trackCalls();

// SOURCE_TO_CHANNEL forward mappings (no current writer produces these
// source values — Phase 3D bot sessions will, server-side).
for (const [source, expected] of [
  ["instagram", "instagram"],
  ["messenger", "messenger"],
  ["tiktok", null], // unknown sources still map to null, never leak raw
]) {
  orderRowOverride = { source };
  const mapped = await expectStatus(200, { auth: `Bearer ${makeJwt()}` }, `source ${source}`);
  trackCalls();
  assert.equal(mapped.data.order.channel, expected, `source ${source} → channel ${expected}`);
}
orderRowOverride = null;

/* ── 13–14. Token↔body binding ───────────────────────────────────────────── */

const otherId = "99999999-8888-7777-6666-555555555555";
await expectStatus(
  401,
  {
    auth: `Bearer ${makeJwt({ claims: { jti: otherId, eventId: otherId } })}`,
    body: goodBody(),
  },
  "JWT eventId != body eventId",
);
await expectStatus(
  401,
  { auth: `Bearer ${makeJwt({ claims: { orderNumber: "TP-OTHER-1" } })}` },
  "JWT orderNumber != body orderNumber",
);

/* ── 15–17. Body validation ──────────────────────────────────────────────── */

const authed = { auth: `Bearer ${makeJwt()}` };
await expectStatus(
  400,
  { ...authed, body: JSON.stringify({ orderNumber: ORDER_NUMBER }) },
  "missing eventId",
);
await expectStatus(
  400,
  { ...authed, body: JSON.stringify({ eventId: EVENT_ID }) },
  "missing orderNumber",
);
await expectStatus(400, { ...authed, body: "null" }, "null body");
await expectStatus(400, { ...authed, body: "[]" }, "array body");
await expectStatus(400, { ...authed, body: '"a-string"' }, "string body");
await expectStatus(400, { ...authed, body: "{not json" }, "non-JSON body");
await expectStatus(
  400,
  {
    ...authed,
    body: JSON.stringify({ eventId: EVENT_ID, orderNumber: ORDER_NUMBER, select: "*" }),
  },
  "unknown field rejected",
);
await expectStatus(
  400,
  { ...authed, body: JSON.stringify({ eventId: EVENT_ID, orderNumber: ` ${ORDER_NUMBER} ` }) },
  "whitespace-padded orderNumber rejected",
);
await expectStatus(
  400,
  { ...authed, body: JSON.stringify({ eventId: "x".repeat(200), orderNumber: ORDER_NUMBER }) },
  "oversized eventId string",
);
await expectStatus(
  413,
  {
    ...authed,
    body: JSON.stringify({ eventId: EVENT_ID, orderNumber: ORDER_NUMBER, pad: "x".repeat(2000) }),
  },
  "oversized body",
);

// UTF-8 BYTE limit, not JS characters: "€" is 1 char but 3 bytes — this body
// is well under 1024 characters yet over 1024 bytes, and must still be 413.
const multibyteBody = JSON.stringify({
  eventId: EVENT_ID,
  orderNumber: ORDER_NUMBER,
  pad: "€".repeat(400),
});
assert.ok(multibyteBody.length < 1024, "fixture: char count stays under the limit");
assert.ok(Buffer.byteLength(multibyteBody, "utf8") > 1024, "fixture: byte count exceeds the limit");
await expectStatus(413, { ...authed, body: multibyteBody }, "multibyte body over byte limit");

/* ── Content-Type: exact media type, parameters allowed ──────────────────── */

await expectStatus(415, { ...authed, contentType: "text/plain" }, "wrong content type");
await expectStatus(
  415,
  { ...authed, contentType: "text/application/json" },
  "media type with json substring",
);
await expectStatus(415, { ...authed, contentType: "application/jsonp" }, "application/jsonp");
await expectStatus(
  200,
  { auth: `Bearer ${makeJwt()}`, contentType: "application/json; charset=utf-8" },
  "json with charset parameter",
);
trackCalls();
await expectStatus(
  200,
  { auth: `Bearer ${makeJwt()}`, contentType: "Application/JSON" },
  "case-insensitive media type",
);
trackCalls();

/* ── 18–19. Supabase not-found and failures ──────────────────────────────── */

ordersBehavior = "empty";
await expectStatus(404, { auth: `Bearer ${makeJwt()}` }, "order not found");
trackCalls();

ordersBehavior = "http500";
await expectStatus(502, { auth: `Bearer ${makeJwt()}` }, "orders read 500");
trackCalls();

ordersBehavior = "reject";
await expectStatus(502, { auth: `Bearer ${makeJwt()}` }, "orders read network failure");
trackCalls();

ordersBehavior = "ok";
itemsBehavior = "http500";
await expectStatus(502, { auth: `Bearer ${makeJwt()}` }, "order_items read 500");
trackCalls();
itemsBehavior = "ok";

/* ── Fail closed on malformed authoritative rows (all generic 502) ───────── */

// A coerced value here would eventually reach a customer message — malformed
// critical fields must fail the request, never become 0 / "".
for (const [override, label] of [
  [{ id: null }, "missing order id"],
  [{ order_number: "TP-SOMETHING-ELSE" }, "returned order_number mismatch"],
  [{ subtotal: "abc" }, "malformed subtotal"],
  [{ subtotal: null }, "missing subtotal"],
  [{ total: -5 }, "negative total"],
  [{ total: "1,180.00" }, "formatted junk total"],
]) {
  orderRowOverride = override;
  await expectStatus(502, { auth: `Bearer ${makeJwt()}` }, label);
  trackCalls();
}
orderRowOverride = null;

for (const [rows, label] of [
  [[], "empty item list"],
  [[{ ...ITEM_ROWS[0], item_name: "" }], "empty item name"],
  [[{ ...ITEM_ROWS[0], item_name: null }], "missing item name"],
  [[{ ...ITEM_ROWS[0], quantity: 1.5 }], "non-integer quantity"],
  [[{ ...ITEM_ROWS[0], quantity: 0 }], "zero quantity"],
  [[{ ...ITEM_ROWS[0], quantity: "2" }], "string quantity"],
  [[{ ...ITEM_ROWS[0], unit_price: "junk" }], "malformed unit_price"],
  [[{ ...ITEM_ROWS[0], line_total: -90 }], "negative line_total"],
  [[ITEM_ROWS[0], { ...ITEM_ROWS[1], line_total: null }], "one bad line fails the whole order"],
]) {
  itemRowsOverride = rows;
  await expectStatus(502, { auth: `Bearer ${makeJwt()}` }, label);
  trackCalls();
}
itemRowsOverride = null;

// NULL delivery_fee is the one documented nullable money column (legacy rows;
// means "no fee") — maps to 0, everything else about the order intact.
orderRowOverride = { delivery_fee: null };
const nullFee = await expectStatus(200, { auth: `Bearer ${makeJwt()}` }, "null delivery_fee → 0");
trackCalls();
assert.equal(nullFee.data.order.deliveryFee, 0, "null delivery_fee maps to 0");
assert.equal(nullFee.data.order.total, 180, "rest of the order unaffected");
orderRowOverride = null;

/* ── Missing server secret → safe 500 before anything else ───────────────── */

delete process.env.N8N_AUTOMATION_SECRET;
await expectStatus(500, { auth: `Bearer ${makeJwt()}` }, "secret not configured");
assert.equal(fetchLog.length, 0, "unconfigured: no Supabase call");
process.env.N8N_AUTOMATION_SECRET = SECRET;

/* ── 21. Read-only guarantee: every Supabase call in the whole run is GET ── */

trackCalls();
assert.ok(allCalls.length >= 2, "expected Supabase calls to have happened");
for (const call of allCalls) {
  assert.equal(call.init.method ?? "GET", "GET", `non-GET Supabase call: ${call.url}`);
  assert.equal(call.init.body, undefined, "Supabase calls must carry no body");
  assert.ok(
    /\/rest\/v1\/(orders|order_items)\?/.test(call.url),
    `unexpected Supabase target: ${call.url}`,
  );
}

console.log("test-order-details: all assertions passed");
