// Standalone Phase 3A bridge check (no test framework — run with
// `npm run test:bridge`). Compiles api/_lib/orderIntake.server.ts to
// node_modules/.cache/bridge-test, then asserts:
//   1. the HS256 JWT is well-formed and independently verifiable;
//   2. intake behavior: missing env vars skip cleanly, a valid config sends
//      exactly one authenticated event, idempotent replays send none, and a
//      failing/500 webhook never fails the order.
// Supabase RPC + webhook fetches are stubbed — no network, no secrets.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/bridge-test";
execSync(
  `npx tsc api/_lib/orderIntake.server.ts --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
// Files inside node_modules get no package scope — restore ESM.
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const { buildOrderEventJwt, postCustomerOrder } = await import(
  pathToFileURL(path.resolve(outDir, "orderIntake.server.js")).href
);

/* ── 1. JWT shape + independent verification ─────────────────────────────── */

const b64uJson = (segment) => JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
const sampleEvent = {
  eventId: "11111111-2222-3333-4444-555555555555",
  eventType: "order.created",
  occurredAt: "2026-07-14T12:00:00.000Z",
  orderNumber: "TP-20260714-120000",
  channel: "customer",
};
const jwt = buildOrderEventJwt(sampleEvent, "test-secret");
const parts = jwt.split(".");
assert.equal(parts.length, 3, "JWT must have three segments");
assert.deepEqual(b64uJson(parts[0]), { alg: "HS256", typ: "JWT" });

const claims = b64uJson(parts[1]);
assert.equal(claims.iss, "atlas-order-bridge");
assert.equal(claims.aud, "n8n-order-automation");
assert.equal(claims.sub, "order.created");
assert.equal(claims.jti, sampleEvent.eventId);
assert.equal(claims.exp - claims.iat, 120, "exp must be iat + 120 s");
assert.equal(claims.iat - claims.nbf, 5, "nbf must be iat - 5 s");
for (const key of Object.keys(sampleEvent)) assert.equal(claims[key], sampleEvent[key]);

const resign = (secret) =>
  createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest("base64url");
assert.equal(parts[2], resign("test-secret"), "signature must verify independently");
assert.notEqual(parts[2], resign("wrong-secret"), "wrong secret must not verify");

/* ── 2. Intake behavior with stubbed fetch ───────────────────────────────── */

const HOOK = "https://n8n.invalid/webhook/atlas-order-events-test";
process.env.VITE_SUPABASE_URL = "https://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-not-a-real-key";

let webhookCalls = [];
let webhookBehavior = "ok"; // "ok" | "http500" | "reject"
let rpcDuplicate = false;

globalThis.fetch = async (url, init) => {
  if (String(url).includes("/rpc/create_order_with_items")) {
    return Response.json({
      order_number: "TP-TEST-000001",
      subtotal: 10,
      delivery_fee: 0,
      total: 10,
      duplicate: rpcDuplicate,
    });
  }
  if (String(url) === HOOK) {
    webhookCalls.push(init);
    if (webhookBehavior === "reject") throw new TypeError("fetch failed");
    if (webhookBehavior === "http500") return new Response("boom", { status: 500 });
    return new Response("ok");
  }
  throw new Error("unexpected fetch target in test");
};

const intakeRequest = () =>
  new Request("https://app.invalid/api/order/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "bridge-test-0001",
      orderType: "dine_in",
      tableNumber: "5",
      items: [{ itemCode: "B01", quantity: 1 }],
    }),
  });

async function placeOrder({ envSet, duplicate = false, behavior = "ok" }) {
  webhookCalls = [];
  webhookBehavior = behavior;
  rpcDuplicate = duplicate;
  if (envSet) {
    process.env.N8N_ORDER_AUTOMATION_WEBHOOK_URL = HOOK;
    process.env.N8N_AUTOMATION_SECRET = "test-secret";
  } else {
    delete process.env.N8N_ORDER_AUTOMATION_WEBHOOK_URL;
    delete process.env.N8N_AUTOMATION_SECRET;
  }
  const response = await postCustomerOrder(intakeRequest());
  // The delivery floats past the response (waitUntil no-ops off-Vercel) —
  // give it a tick to settle before asserting.
  await new Promise((resolve) => setTimeout(resolve, 25));
  const body = await response.json();
  assert.equal(response.status, 200, "order must succeed");
  assert.equal(body.ok, true);
  return webhookCalls;
}

// Missing env vars: order succeeds, no webhook attempt.
assert.equal((await placeOrder({ envSet: false })).length, 0);

// Valid config: exactly one authenticated event.
const [sent] = await placeOrder({ envSet: true });
assert.ok(sent, "one webhook call expected");
assert.equal((await placeOrder({ envSet: true })).length, 1);
assert.equal(sent.headers["x-atlas-jwt"], undefined, "x-atlas-jwt must not be sent");
assert.match(sent.headers["Authorization"], /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
const sentJwt = sent.headers["Authorization"].replace(/^Bearer\s+/i, "");
const [h, p, s] = sentJwt.split(".");
assert.equal(s, createHmac("sha256", "test-secret").update(`${h}.${p}`).digest("base64url"));
const sentClaims = b64uJson(p);
const sentBody = JSON.parse(sent.body);
assert.deepEqual(Object.keys(sentBody), [
  "eventId",
  "eventType",
  "occurredAt",
  "orderNumber",
  "channel",
]);
for (const key of Object.keys(sentBody)) assert.equal(sentClaims[key], sentBody[key]);
assert.equal(sent.headers["x-atlas-event-id"], sentBody.eventId);
assert.equal(sent.headers["x-atlas-timestamp"], sentBody.occurredAt);
assert.equal(sentClaims.jti, sentBody.eventId);
assert.equal(sentBody.orderNumber, "TP-TEST-000001");

// Idempotent replay (duplicate=true): no event.
assert.equal((await placeOrder({ envSet: true, duplicate: true })).length, 0);

// Webhook 500 / network failure: order still succeeds (asserted inside).
assert.equal((await placeOrder({ envSet: true, behavior: "http500" })).length, 1);
assert.equal((await placeOrder({ envSet: true, behavior: "reject" })).length, 1);

console.log("test-automation-bridge: all assertions passed");
