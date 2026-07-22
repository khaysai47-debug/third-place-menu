// Standalone Phase 3D secure-bot-session check (no test framework — run with
// `npm run test:bot-session`). Compiles the SINGLE production Vercel entry
// point, api/[...route].ts (which pulls in every api/_lib/*.server.ts module),
// to node_modules/.cache/bot-session-test, then asserts the full contract:
//
//   1. token derivation — determinism, independent re-derivation, injectivity
//   2. trusted creation  — auth, UUIDv4, idempotent retry, fail-closed rotation
//   3. resolve           — all five states, no chat-id leak, no invented platform
//   4. session checkout  — forged channel fields ignored, selective dispatch
//   5. cross-cutting     — no token in any URL, no token in any log, no-store
//   6. the catch-all router — path routing, method dispatch, 404s, 405s+Allow
//
// Every fetch is stubbed — no network, no real secrets, no database.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/bot-session-test";
// Compiling the PRODUCTION entry point — the single catch-all Vercel function
// (api/[...route].ts) — means the real deployed surface is what gets
// exercised: path routing, method dispatch, 404s and 405s included. The quotes
// keep the shell from touching the bracketed filename.
execSync(
  `npx tsc "api/[...route].ts"` +
    ` --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
// Files inside node_modules get no package scope — restore ESM.
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const load = (rel) => import(pathToFileURL(path.resolve(outDir, rel)).href);
const lib = await load("_lib/botSession.server.js");
const intake = await load("_lib/orderIntake.server.js");
// One module now serves every endpoint; each request is routed by its URL.
const api = await load("[...route].js");
const createRoute = api;
const resolveRoute = api;
const orderRoute = api;

/* ── Fixtures + environment ──────────────────────────────────────────────── */

const BOT_SECRET = "bot-inbound-test-secret";
const TOKEN_SECRET = "bot-token-derivation-test-secret";
const SITE = "https://menu.invalid";
const HOOK = "https://n8n.invalid/webhook/atlas-order-events-test";
const STAFF_SECRET = "staff-test-secret";
const CHAT_ID = "17841400000000001";
const REQUEST_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORDER_UUID = "12345678-1234-4234-8234-123456789abc";

process.env.BOT_SESSION_SECRET = BOT_SECRET;
process.env.BOT_SESSION_TOKEN_SECRET = TOKEN_SECRET;
process.env.PUBLIC_SITE_URL = SITE;
process.env.VITE_SUPABASE_URL = "https://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-not-a-real-key";
process.env.STAFF_WRITE_SECRET = STAFF_SECRET;
process.env.MESSENGER_PAGE_HANDLE = "thethirdplace";
process.env.INSTAGRAM_HANDLE = "thethirdplace.bkk";

/* ── Stubbed transport ───────────────────────────────────────────────────── */

let fetchCalls = []; // every outgoing call — used for the no-token-in-URL check
let webhookCalls = [];
let rpcArgs = {}; // last args per RPC name
let createSessionResult = {
  session_id: "s-1",
  status: "active",
  expires_at: "2026-07-23T12:00:00Z",
  duplicate: false,
};
let createSessionError = null;
let sessionOrderResult = null;
let sessionOrderError = null;
let sessionRows = [];
let orderRows = [];

const rpcFail = (message, details = "") =>
  new Response(JSON.stringify({ message, details }), {
    status: 400,
    headers: { "content-type": "application/json" },
  });

globalThis.fetch = async (url, init) => {
  const u = String(url);
  fetchCalls.push({ url: u, init });

  if (u.includes("/rpc/create_bot_session")) {
    rpcArgs.create_bot_session = JSON.parse(init.body);
    return createSessionError ? rpcFail(createSessionError) : Response.json(createSessionResult);
  }
  if (u.includes("/rpc/create_order_from_bot_session")) {
    rpcArgs.create_order_from_bot_session = JSON.parse(init.body);
    if (sessionOrderError) return rpcFail(sessionOrderError.message, sessionOrderError.details);
    return Response.json(sessionOrderResult);
  }
  if (u.includes("/rpc/create_order_with_items")) {
    rpcArgs.create_order_with_items = JSON.parse(init.body);
    return Response.json({
      order_id: ORDER_UUID,
      order_number: "TP-TEST-000001",
      subtotal: 10,
      delivery_fee: 0,
      total: 10,
      duplicate: false,
    });
  }
  if (u.includes("/rest/v1/bot_sessions")) return Response.json(sessionRows);
  if (u.includes("/rest/v1/orders")) return Response.json(orderRows);
  if (u === HOOK) {
    webhookCalls.push(init);
    return new Response("ok");
  }
  throw new Error(`unexpected fetch target in test: ${u}`);
};

const reset = () => {
  fetchCalls = [];
  webhookCalls = [];
  rpcArgs = {};
  createSessionError = null;
  sessionOrderError = null;
};

const setAutomationEnv = (on) => {
  if (on) {
    process.env.N8N_ORDER_AUTOMATION_WEBHOOK_URL = HOOK;
    process.env.N8N_AUTOMATION_SECRET = "test-secret";
  } else {
    delete process.env.N8N_ORDER_AUTOMATION_WEBHOOK_URL;
    delete process.env.N8N_AUTOMATION_SECRET;
  }
};

const jsonRequest = (url, body, headers = {}) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const createRequest = (body, headers = { "x-bot-secret": BOT_SECRET }) =>
  jsonRequest("https://app.invalid/api/automation/bot-session", body, headers);

// Every log line emitted anywhere in this run, for the leak assertions.
const logLines = [];
const originalLog = console.log;
const originalError = console.error;
console.log = (...a) => logLines.push(a.join(" "));
console.error = (...a) => logLines.push(a.join(" "));

/* ── 1. Token derivation ─────────────────────────────────────────────────── */

const token = lib.deriveSessionToken(TOKEN_SECRET, "instagram", CHAT_ID, REQUEST_ID);

assert.match(token, /^[A-Za-z0-9_-]{43}$/, "token must be 43 URL-safe base64 chars");
assert.match(token, lib.TOKEN_PATTERN, "token must satisfy the exported pattern");

// Determinism: the whole point — a lost HTTP response must reproduce the link.
assert.equal(
  token,
  lib.deriveSessionToken(TOKEN_SECRET, "instagram", CHAT_ID, REQUEST_ID),
  "derivation must be deterministic",
);

// Independent re-derivation pins the canonical wire format, so a future edit
// to canonicalTokenInput that silently changes every live link fails here.
const expectedCanonical = [
  "atlas.botsession.v1",
  `9:instagram`,
  `${Buffer.byteLength(CHAT_ID, "utf8")}:${CHAT_ID}`,
  `36:${REQUEST_ID}`,
].join("\x1f");
assert.equal(
  lib.canonicalTokenInput("instagram", CHAT_ID, REQUEST_ID),
  expectedCanonical,
  "canonical input format must not drift",
);
assert.equal(
  token,
  createHmac("sha256", TOKEN_SECRET).update(expectedCanonical, "utf8").digest("base64url"),
  "token must verify against an independent HMAC",
);

// A different secret must not reproduce the token.
assert.notEqual(
  token,
  lib.deriveSessionToken("other-secret", "instagram", CHAT_ID, REQUEST_ID),
  "rotation must change the derived token",
);

// INJECTIVITY: length-prefixing is what stops these colliding. Plain
// concatenation would derive ONE token for TWO different chats.
assert.notEqual(
  lib.canonicalTokenInput("instagram", "12", "3456"),
  lib.canonicalTokenInput("instagram", "123", "456"),
  "canonical encoding must be injective across the chat/request boundary",
);
assert.notEqual(
  lib.deriveSessionToken(TOKEN_SECRET, "instagram", "12", "3456"),
  lib.deriveSessionToken(TOKEN_SECRET, "instagram", "123", "456"),
  "injectivity must hold at the token level",
);
assert.notEqual(
  lib.canonicalTokenInput("instagram", "a", "b"),
  lib.canonicalTokenInput("instagra", "ma", "b"),
  "canonical encoding must be injective across the platform/chat boundary",
);

// The hash is what Supabase stores; the plaintext must never equal it.
const tokenHash = lib.hashSessionToken(token);
assert.match(tokenHash, /^[0-9a-f]{64}$/, "hash must be lowercase hex sha256");
assert.notEqual(tokenHash, token);

/* ── 2. Trusted session creation ─────────────────────────────────────────── */

// -- 2a. Auth: every failure is the same generic 401, and NOTHING is called.
for (const headers of [
  {},
  { "x-bot-secret": "" },
  { "x-bot-secret": "wrong-secret" },
  { "x-bot-secret": `${BOT_SECRET}x` },
  { "x-staff-secret": STAFF_SECRET }, // the staff secret must NOT work here
]) {
  reset();
  const response = await createRoute.POST(
    createRequest(
      { requestId: REQUEST_ID, platform: "instagram", externalChatId: CHAT_ID },
      headers,
    ),
  );
  assert.equal(response.status, 401, `bot secret rejected: ${JSON.stringify(headers)}`);
  assert.equal(fetchCalls.length, 0, "rejected auth must not reach Supabase");
}

// -- 2b. Happy path.
reset();
let response = await createRoute.POST(
  createRequest({ requestId: REQUEST_ID, platform: "instagram", externalChatId: CHAT_ID }),
);
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "no-store", "create must be no-store");
let body = await response.json();
assert.equal(body.ok, true);
assert.equal(body.token, token, "returned token must be the derived one");
assert.equal(body.url, `${SITE}/m#${token}`, "link must be the FRAGMENT form");
assert.equal(body.duplicate, false);
assert.ok(!body.url.includes("?"), "no query string in the link");
assert.ok(body.url.includes("/m#"), "token must sit after the # — never in the path");
// The database receives only the hash.
assert.equal(rpcArgs.create_bot_session.p_token_hash, tokenHash);
assert.equal(rpcArgs.create_bot_session.p_request_id, REQUEST_ID);
assert.equal(rpcArgs.create_bot_session.p_ttl_hours, 24);
assert.ok(
  !JSON.stringify(rpcArgs.create_bot_session).includes(token),
  "the plaintext token must NEVER be sent to the database",
);

// -- 2c. UUIDv4 enforcement (same rule as the table CHECK and the function).
for (const badId of [
  "not-a-uuid",
  "aaaaaaaa-bbbb-1ccc-8ddd-eeeeeeeeeeee", // v1, not v4
  "aaaaaaaa-bbbb-4ccc-7ddd-eeeeeeeeeeee", // bad variant nibble
  "aaaaaaaabbbb4ccc8dddeeeeeeeeeeee", // unhyphenated
  "short",
  "",
]) {
  reset();
  response = await createRoute.POST(
    createRequest({ requestId: badId, platform: "instagram", externalChatId: CHAT_ID }),
  );
  assert.equal(response.status, 400, `requestId must be a UUIDv4: ${badId}`);
  assert.equal(fetchCalls.length, 0, "invalid requestId must not reach Supabase");
}
// A well-formed v4 (uppercase permitted) is accepted.
reset();
response = await createRoute.POST(
  createRequest({
    requestId: "AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE",
    platform: "instagram",
    externalChatId: CHAT_ID,
  }),
);
assert.equal(response.status, 200, "uppercase UUIDv4 must be accepted");

// -- 2d. Rejected platform / chat id / unknown fields.
for (const bad of [
  { requestId: REQUEST_ID, platform: "whatsapp", externalChatId: CHAT_ID },
  { requestId: REQUEST_ID, platform: "customer", externalChatId: CHAT_ID },
  { requestId: REQUEST_ID, platform: "instagram", externalChatId: "has space" },
  { requestId: REQUEST_ID, platform: "instagram", externalChatId: "" },
  { requestId: REQUEST_ID, platform: "instagram", externalChatId: "a".repeat(129) },
  { requestId: REQUEST_ID, platform: "instagram", externalChatId: CHAT_ID, extra: "nope" },
]) {
  reset();
  response = await createRoute.POST(createRequest(bad));
  assert.equal(response.status, 400, `rejected body: ${JSON.stringify(bad)}`);
  assert.equal(fetchCalls.length, 0);
}

// -- 2e. THE LOST-RESPONSE CASE: an idempotent retry returns the SAME link.
reset();
createSessionResult = {
  session_id: "s-1",
  status: "active",
  expires_at: "2026-07-23T12:00:00Z",
  duplicate: true,
};
response = await createRoute.POST(
  createRequest({ requestId: REQUEST_ID, platform: "instagram", externalChatId: CHAT_ID }),
);
assert.equal(response.status, 200);
body = await response.json();
assert.equal(body.duplicate, true, "retry must be reported as a duplicate");
assert.equal(body.token, token, "retry must return the IDENTICAL token");
assert.equal(body.url, `${SITE}/m#${token}`, "retry must return the IDENTICAL url");
createSessionResult = {
  session_id: "s-1",
  status: "active",
  expires_at: "2026-07-23T12:00:00Z",
  duplicate: false,
};

// -- 2f. Retry after a token-secret rotation FAILS CLOSED (no dead link).
reset();
createSessionError = "SESSION_TOKEN_UNRECOVERABLE";
response = await createRoute.POST(
  createRequest({ requestId: REQUEST_ID, platform: "instagram", externalChatId: CHAT_ID }),
);
assert.equal(response.status, 409, "unrecoverable token must be 409");
body = await response.json();
assert.equal(body.ok, false);
assert.equal(body.url, undefined, "a failed re-issue must NEVER return a url");
assert.equal(body.token, undefined, "a failed re-issue must NEVER return a token");

// -- 2g. Idempotency key reused across conversations → specific conflict.
reset();
createSessionError = "SESSION_REQUEST_ID_CONFLICT";
response = await createRoute.POST(
  createRequest({ requestId: REQUEST_ID, platform: "messenger", externalChatId: "different-chat" }),
);
assert.equal(response.status, 409, "cross-chat idempotency reuse must be 409");
body = await response.json();
assert.equal(body.url, undefined);
createSessionError = null;

/* ── 3. Resolve ──────────────────────────────────────────────────────────── */

const resolveRequest = (t) =>
  jsonRequest("https://app.invalid/api/menu-session/resolve", { token: t });

const future = new Date(Date.now() + 3_600_000).toISOString();
const past = new Date(Date.now() - 3_600_000).toISOString();

async function resolveWith(rows, orders = []) {
  reset();
  sessionRows = rows;
  orderRows = orders;
  const res = await resolveRoute.POST(resolveRequest(token));
  return { res, body: await res.json() };
}

// active
let out = await resolveWith([
  { status: "active", platform: "instagram", expires_at: future, order_id: null },
]);
assert.equal(out.res.status, 200);
assert.equal(out.res.headers.get("cache-control"), "no-store", "resolve must be no-store");
assert.equal(out.body.state, "active");
assert.equal(out.body.returnToChat.platform, "instagram");
assert.equal(out.body.returnToChat.url, "https://ig.me/m/thethirdplace.bkk");
// The lookup must go through the token HASH, never the token.
assert.ok(
  fetchCalls.some((c) => c.url.includes(`token_hash=eq.${tokenHash}`)),
  "resolve must look up by hash",
);
// The SELECT must not even ask for the chat id.
assert.ok(
  fetchCalls.some((c) => c.url.includes("select=status,platform,expires_at,order_id")),
  "resolve must use the explicit column list",
);

// expired (derived from expires_at — there is no stored 'expired' status)
out = await resolveWith([
  { status: "active", platform: "messenger", expires_at: past, order_id: null },
]);
assert.equal(out.body.state, "expired");
assert.equal(out.body.returnToChat.platform, "messenger");
assert.equal(out.body.returnToChat.url, "https://m.me/thethirdplace");

// completed — carries the order number
out = await resolveWith(
  [{ status: "completed", platform: "instagram", expires_at: future, order_id: ORDER_UUID }],
  [{ order_number: "TP-IG-20260722-183000" }],
);
assert.equal(out.body.state, "completed");
assert.equal(out.body.orderNumber, "TP-IG-20260722-183000");

// a completed session that ALSO passed its expiry still reads completed
out = await resolveWith(
  [{ status: "completed", platform: "instagram", expires_at: past, order_id: ORDER_UUID }],
  [{ order_number: "TP-IG-20260722-183000" }],
);
assert.equal(out.body.state, "completed", "completed must win over expiry");

// revoked
out = await resolveWith([
  { status: "revoked", platform: "instagram", expires_at: future, order_id: null },
]);
assert.equal(out.body.state, "revoked");

// unknown status fails closed
out = await resolveWith([
  { status: "something-new", platform: "instagram", expires_at: future, order_id: null },
]);
assert.equal(out.body.state, "invalid", "an unknown status must fail closed");

// invalid — no row. The originating platform is UNKNOWABLE and must be null.
out = await resolveWith([]);
assert.equal(out.body.state, "invalid");
assert.equal(out.body.returnToChat.platform, null, "invalid must not invent a platform");
assert.equal(out.body.returnToChat.url, null, "invalid must not offer a chat link");
assert.equal(out.body.orderNumber, undefined);

// malformed tokens resolve as invalid, never 4xx/5xx and never a distinct code
for (const bad of ["", "short", `${token}x`, "has space!!", "a".repeat(43) + "="]) {
  reset();
  sessionRows = [];
  const res = await resolveRoute.POST(resolveRequest(bad));
  assert.equal(res.status, 200, `malformed token stays 200: ${bad.slice(0, 12)}`);
  assert.equal((await res.json()).state, "invalid");
  assert.equal(fetchCalls.length, 0, "a malformed token must not reach Supabase");
}

// THE CHAT ID MUST NEVER APPEAR IN A RESPONSE, in any state.
for (const rows of [
  [
    {
      status: "active",
      platform: "instagram",
      expires_at: future,
      order_id: null,
      external_chat_id: CHAT_ID,
    },
  ],
  [
    {
      status: "revoked",
      platform: "messenger",
      expires_at: past,
      order_id: null,
      external_chat_id: CHAT_ID,
    },
  ],
]) {
  const probe = await resolveWith(rows);
  const raw = JSON.stringify(probe.body);
  assert.ok(!raw.includes(CHAT_ID), "external chat id must never be returned");
  assert.ok(!raw.includes("externalChatId") && !raw.includes("external_chat_id"));
}

/* ── 4. Deep links — validation and open-redirect resistance ─────────────── */

assert.equal(lib.chatDeepLink("messenger"), "https://m.me/thethirdplace");
assert.equal(lib.chatDeepLink("instagram"), "https://ig.me/m/thethirdplace.bkk");
assert.equal(lib.chatDeepLink(null), null);
assert.equal(lib.chatDeepLink("customer"), null, "non-bot channels have no chat link");

// A malformed or hostile handle yields NULL, never a partial or foreign URL.
for (const hostile of [
  "https://evil.example.com",
  "../../evil",
  "good/../../evil",
  "handle?next=https://evil.example.com",
  "handle#frag",
  "han dle",
  "@handle",
  "a".repeat(61),
  "",
]) {
  process.env.MESSENGER_PAGE_HANDLE = hostile;
  const link = lib.chatDeepLink("messenger");
  assert.equal(link, null, `hostile handle must yield null: ${hostile}`);
}
// Unset → null (generic return-to-chat state, never a broken button).
delete process.env.MESSENGER_PAGE_HANDLE;
assert.equal(lib.chatDeepLink("messenger"), null);
process.env.MESSENGER_PAGE_HANDLE = "thethirdplace";
// Whatever happens, the origin is fixed.
assert.ok(lib.chatDeepLink("messenger").startsWith("https://m.me/"));
assert.ok(lib.chatDeepLink("instagram").startsWith("https://ig.me/m/"));

/* ── 5. Session checkout ─────────────────────────────────────────────────── */

const sessionOrderRequest = (extra = {}) =>
  jsonRequest("https://app.invalid/api/order/submit-session", {
    token,
    requestId: "bot-order-0001",
    orderType: "pickup",
    customerName: "Somchai",
    customerPhone: "0812345678",
    items: [{ itemCode: "B01", quantity: 2 }],
    ...extra,
  });

const okOrder = (duplicate, platform = "instagram") => ({
  order_id: ORDER_UUID,
  order_number: "TP-IG-20260722-183000",
  subtotal: 200,
  delivery_fee: 0,
  total: 200,
  platform,
  duplicate,
});

// -- 5a. Happy path: exactly ONE automation event, channel from the session.
reset();
setAutomationEnv(true);
sessionOrderResult = okOrder(false);
response = await orderRoute.POST(sessionOrderRequest());
await new Promise((r) => setTimeout(r, 25)); // waitUntil settles off-Vercel
assert.equal(response.status, 200);
assert.equal(response.headers.get("cache-control"), "no-store");
body = await response.json();
assert.equal(body.ok, true);
assert.equal(body.orderNumber, "TP-IG-20260722-183000");
assert.equal(body.duplicate, false);
assert.equal(webhookCalls.length, 1, "bot-session order must dispatch exactly once");
assert.equal(JSON.parse(webhookCalls[0].body).channel, "instagram", "channel from the session row");
// The database gets the hash and the normalised order — never the token.
assert.equal(rpcArgs.create_order_from_bot_session.p_token_hash, tokenHash);
assert.ok(!JSON.stringify(rpcArgs.create_order_from_bot_session).includes(token));

// -- 5b. FORGED CHANNEL FIELDS ARE IGNORED (the core rule of this phase).
reset();
sessionOrderResult = okOrder(false, "instagram");
response = await orderRoute.POST(
  sessionOrderRequest({
    platform: "messenger",
    channel: "instagram",
    source: "instagram",
    p_channel: "staff",
    orderChannel: "instagram",
  }),
);
await new Promise((r) => setTimeout(r, 25));
assert.equal(response.status, 200);
const forwarded = rpcArgs.create_order_from_bot_session;
for (const forged of ["platform", "channel", "source", "p_channel", "orderChannel"]) {
  assert.ok(!(forged in forwarded), `forged field "${forged}" must be stripped before the RPC`);
}
assert.deepEqual(
  Object.keys(forwarded).sort(),
  [
    "p_client_request_id",
    "p_customer_address",
    "p_customer_name",
    "p_customer_note",
    "p_customer_phone",
    "p_items",
    "p_order_type",
    "p_table_number",
    "p_token_hash",
  ],
  "the RPC argument set is fixed — no client key can widen it",
);

// -- 5c. Duplicate replay dispatches NOTHING new.
reset();
sessionOrderResult = okOrder(true);
response = await orderRoute.POST(sessionOrderRequest());
await new Promise((r) => setTimeout(r, 25));
assert.equal(response.status, 200);
assert.equal((await response.json()).duplicate, true);
assert.equal(webhookCalls.length, 0, "idempotent replay must not re-dispatch");

// -- 5d. Session failures map to the right customer-facing status codes.
const SESSION_FAILURES = [
  ["SESSION_INVALID", 404],
  ["SESSION_EXPIRED", 410],
  ["SESSION_REVOKED", 410],
  ["SESSION_REQUEST_ID_REUSED", 409],
];
for (const [code, status] of SESSION_FAILURES) {
  reset();
  setAutomationEnv(true);
  sessionOrderError = { message: code, details: "" };
  response = await orderRoute.POST(sessionOrderRequest());
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(response.status, status, `${code} → ${status}`);
  assert.equal((await response.json()).ok, false);
  assert.equal(webhookCalls.length, 0, `${code} must not dispatch`);
}

// A consumed link is a 409 that names the existing order (safe — the customer
// already has it) and creates nothing.
reset();
sessionOrderError = { message: "SESSION_COMPLETED", details: "TP-IG-20260722-183000" };
response = await orderRoute.POST(sessionOrderRequest());
await new Promise((r) => setTimeout(r, 25));
assert.equal(response.status, 409);
body = await response.json();
assert.ok(body.error.includes("TP-IG-20260722-183000"));
assert.equal(webhookCalls.length, 0, "a completed link must never dispatch");
sessionOrderError = null;

// -- 5e. Item errors still use the shared customer-path messages.
reset();
sessionOrderError = { message: "ORDER_ITEM_UNAVAILABLE", details: "B01" };
response = await orderRoute.POST(sessionOrderRequest());
assert.equal(response.status, 409);
assert.ok((await response.json()).error.includes("just sold out"));
sessionOrderError = null;

// -- 5f. Shared intake validation is genuinely shared (not re-implemented).
reset();
response = await orderRoute.POST(
  jsonRequest("https://app.invalid/api/order/submit-session", {
    token,
    requestId: "bot-order-0002",
    orderType: "delivery",
    customerName: "A",
    customerPhone: "081",
    items: [{ itemCode: "B01", quantity: 1 }],
  }),
);
assert.equal(response.status, 400, "delivery still requires an address");
assert.ok((await response.json()).error.includes("Delivery address"));

reset();
response = await orderRoute.POST(
  jsonRequest("https://app.invalid/api/order/submit-session", {
    token,
    requestId: "bot-order-0003",
    orderType: "dine_in",
    items: [{ itemCode: "B01", quantity: 1 }],
  }),
);
assert.equal(response.status, 400, "dine-in still requires a table number");

// A missing/short token is rejected before anything else happens.
for (const badToken of [undefined, "", "short"]) {
  reset();
  response = await orderRoute.POST(
    jsonRequest("https://app.invalid/api/order/submit-session", {
      ...(badToken === undefined ? {} : { token: badToken }),
      requestId: "bot-order-0004",
      orderType: "pickup",
      customerName: "A",
      customerPhone: "081",
      items: [{ itemCode: "B01", quantity: 1 }],
    }),
  );
  assert.equal(response.status, 400, "a malformed session token is a 400");
  assert.equal(fetchCalls.length, 0);
}

/* ── 6. Normal orders are untouched (Phase 3C regression) ────────────────── */

const normalRequest = (staff) =>
  jsonRequest(
    `https://app.invalid/api/${staff ? "staff/add-order" : "order/submit"}`,
    {
      requestId: "normal-order-0001",
      orderType: "dine_in",
      tableNumber: "5",
      items: [{ itemCode: "B01", quantity: 1 }],
      // Forged channel fields on the PUBLIC route too.
      platform: "instagram",
      channel: "instagram",
      source: "instagram",
    },
    staff ? { "x-staff-secret": STAFF_SECRET } : {},
  );

reset();
setAutomationEnv(true);
response = await intake.postCustomerOrder(normalRequest(false));
await new Promise((r) => setTimeout(r, 25));
assert.equal(response.status, 200);
assert.equal(
  rpcArgs.create_order_with_items.p_channel,
  "customer",
  "a browser can never make a normal order into a bot order",
);
assert.equal(webhookCalls.length, 0, "normal customer orders dispatch zero n8n events");

reset();
response = await intake.postStaffAddOrder(normalRequest(true));
await new Promise((r) => setTimeout(r, 25));
assert.equal(response.status, 200);
assert.equal(rpcArgs.create_order_with_items.p_channel, "staff");
assert.equal(webhookCalls.length, 0, "staff orders dispatch zero n8n events");

/* ── 7. The catch-all router: paths, methods, 404s and 405s ──────────────── */

const bare = (url, method) => new Request(url, { method });
const U = (p) => `https://app.invalid/api/${p}`;

// Every POST-only endpoint refuses other verbs with 405 + a correct Allow.
const POST_ONLY = [
  "automation/bot-session",
  "automation/order-details",
  "menu-session/resolve",
  "order/submit",
  "order/submit-session",
  "staff/add-expense",
  "staff/add-order",
  "staff/cancel-order",
  "staff/mark-paid",
  "staff/update-menu-availability",
  "staff/update-status",
];
for (const p of POST_ONLY) {
  for (const verb of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    const res = await api[verb](bare(U(p), verb));
    assert.equal(res.status, 405, `${p} ${verb} must be 405`);
    assert.equal(res.headers.get("allow"), "POST", `${p} must advertise Allow: POST`);
    if (verb !== "HEAD") {
      assert.equal((await res.json()).error, "Method not allowed.");
    }
  }
}

// Every GET-only endpoint refuses other verbs, and advertises HEAD alongside GET.
const GET_ONLY = ["staff/expenses", "staff/orders"];
for (const p of GET_ONLY) {
  for (const verb of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const res = await api[verb](bare(U(p), verb));
    assert.equal(res.status, 405, `${p} ${verb} must be 405`);
    assert.equal(res.headers.get("allow"), "GET, HEAD", `${p} must advertise Allow: GET, HEAD`);
  }
}

// Unknown paths are 404 — for EVERY verb, so a wrong method on a route that
// does not exist never masquerades as 405.
for (const p of [
  "",
  "nope",
  "staff",
  "staff/nope",
  "order",
  "automation/nope",
  "staff/orders/extra",
]) {
  for (const verb of ["GET", "POST", "PUT", "DELETE"]) {
    const res = await api[verb](bare(U(p), verb));
    assert.equal(res.status, 404, `/api/${p} ${verb} must be 404`);
    assert.equal((await res.json()).error, "Not found.");
  }
}

// Routing is tolerant of a trailing slash and of a stripped /api prefix, so a
// platform path-normalisation difference cannot silently 404 the whole API.
{
  reset();
  sessionRows = [];
  const withSlash = await api.POST(
    jsonRequest("https://app.invalid/api/menu-session/resolve/", { token }),
  );
  assert.equal(withSlash.status, 200, "a trailing slash must still route");
  const noPrefix = await api.POST(
    jsonRequest("https://app.invalid/menu-session/resolve", { token }),
  );
  assert.equal(noPrefix.status, 200, "a stripped /api prefix must still route");
}

// A query string must not defeat path matching.
{
  reset();
  sessionRows = [];
  const res = await api.POST(
    jsonRequest("https://app.invalid/api/menu-session/resolve?utm_source=ig", { token }),
  );
  assert.equal(res.status, 200, "a query string must not break routing");
}

// The router itself must never emit CORS headers.
{
  reset();
  sessionRows = [];
  const res = await api.POST(resolveRequest(token));
  for (const h of [
    "access-control-allow-origin",
    "access-control-allow-methods",
    "access-control-allow-headers",
    "access-control-allow-credentials",
  ]) {
    assert.equal(res.headers.get(h), null, `router must not emit ${h}`);
  }
}

// Staff endpoints still enforce their own auth THROUGH the router.
{
  reset();
  const denied = await api.GET(bare(U("staff/orders"), "GET"));
  assert.equal(denied.status, 401, "staff reads still require x-staff-secret");
  assert.equal(fetchCalls.length, 0, "an unauthorised staff read must not reach Supabase");
}

/* ── 8. Cross-cutting leak checks ────────────────────────────────────────── */

console.log = originalLog;
console.error = originalError;

// The plaintext token must never appear in ANY outgoing request URL — that is
// the whole reason it travels in a fragment and then in POST bodies.
for (const call of fetchCalls) {
  assert.ok(!call.url.includes(token), "the token must never appear in a request URL");
}

// ...nor in any log line, along with every other sensitive value.
for (const line of logLines) {
  assert.ok(!line.includes(token), "logs must not contain the token");
  assert.ok(!line.includes(tokenHash), "logs must not contain the token hash");
  assert.ok(!line.includes(CHAT_ID), "logs must not contain the external chat id");
  assert.ok(!line.includes(BOT_SECRET), "logs must not contain the inbound secret");
  assert.ok(!line.includes(TOKEN_SECRET), "logs must not contain the derivation secret");
  assert.ok(!line.includes(STAFF_SECRET), "logs must not contain the staff secret");
  assert.ok(!line.includes("n8n.invalid"), "logs must not contain the webhook host");
  assert.ok(!line.includes("supabase.invalid"), "logs must not contain the Supabase host");
  assert.ok(!line.includes("Bearer"), "logs must not contain an Authorization header");
}
// The suite must actually have produced logs, or the checks above are vacuous.
assert.ok(logLines.length > 0, "expected some log output to inspect");
assert.ok(
  logLines.some((l) => l.startsWith("BOT_SESSION created")),
  "creation must be logged (without identifiers)",
);
assert.ok(
  logLines.some((l) => l.startsWith("MENU_SESSION_RESOLVE state=")),
  "resolve must log the state only",
);

console.log("test-bot-session: all assertions passed");
