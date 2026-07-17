// Standalone Phase 3A/3C bridge check (no test framework — run with
// `npm run test:bridge`). Compiles api/_lib/orderIntake.server.ts to
// node_modules/.cache/bridge-test, then asserts:
//   1. the HS256 JWT is well-formed and independently verifiable;
//   2. Phase 3C selective dispatch: customer and staff intake NEVER dispatch
//      (with or without env vars, incl. duplicate replays), while the
//      server-side bot channels (instagram/messenger) dispatch exactly one
//      authenticated event, and a failing/500 webhook never throws or leaks.
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

const { buildOrderEventJwt, fireOrderAutomation, postCustomerOrder, postStaffAddOrder } =
  await import(pathToFileURL(path.resolve(outDir, "orderIntake.server.js")).href);

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

/* ── 2. Intake behavior with stubbed fetch (Phase 3C: intake never dispatches) ── */

const HOOK = "https://n8n.invalid/webhook/atlas-order-events-test";
const STAFF_SECRET = "staff-test-secret";
process.env.VITE_SUPABASE_URL = "https://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-not-a-real-key";
process.env.STAFF_WRITE_SECRET = STAFF_SECRET;

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

const setAutomationEnv = (envSet) => {
  if (envSet) {
    process.env.N8N_ORDER_AUTOMATION_WEBHOOK_URL = HOOK;
    process.env.N8N_AUTOMATION_SECRET = "test-secret";
  } else {
    delete process.env.N8N_ORDER_AUTOMATION_WEBHOOK_URL;
    delete process.env.N8N_AUTOMATION_SECRET;
  }
};

const intakeRequest = (staff) =>
  new Request(`https://app.invalid/api/${staff ? "staff/add-order" : "order/submit"}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(staff ? { "x-staff-secret": STAFF_SECRET } : {}),
    },
    body: JSON.stringify({
      requestId: "bridge-test-0001",
      orderType: "dine_in",
      tableNumber: "5",
      items: [{ itemCode: "B01", quantity: 1 }],
    }),
  });

async function placeOrder({ envSet, duplicate = false, staff = false }) {
  webhookCalls = [];
  webhookBehavior = "ok";
  rpcDuplicate = duplicate;
  setAutomationEnv(envSet);
  const handler = staff ? postStaffAddOrder : postCustomerOrder;
  const response = await handler(intakeRequest(staff));
  // Any delivery floats past the response (waitUntil no-ops off-Vercel) —
  // give it a tick to settle before asserting.
  await new Promise((resolve) => setTimeout(resolve, 25));
  const body = await response.json();
  assert.equal(response.status, 200, "order must succeed");
  assert.equal(body.ok, true);
  return webhookCalls;
}

// Env vars unset: customer order succeeds, no webhook attempt.
assert.equal((await placeOrder({ envSet: false })).length, 0, "customer, env unset");

// Phase 3C: env vars SET — normal orders still dispatch NOTHING.
assert.equal((await placeOrder({ envSet: true })).length, 0, "customer order: zero dispatch");
assert.equal(
  (await placeOrder({ envSet: true, staff: true })).length,
  0,
  "staff order: zero dispatch",
);

// Idempotent replay (duplicate=true): still nothing.
assert.equal(
  (await placeOrder({ envSet: true, duplicate: true })).length,
  0,
  "duplicate replay: zero dispatch",
);

/* ── 3. Dispatch policy (fireOrderAutomation — the single enforcement point) ── */

// No intake route can produce a bot channel until Phase 3D, so the policy is
// driven directly through the exported function.
async function dispatch(channel, { envSet = true, behavior = "ok" } = {}) {
  webhookCalls = [];
  webhookBehavior = behavior;
  setAutomationEnv(envSet);
  fireOrderAutomation("TP-TEST-000001", channel);
  await new Promise((resolve) => setTimeout(resolve, 25));
  return webhookCalls;
}

// Non-bot channels are refused by the policy itself.
assert.equal((await dispatch("customer")).length, 0, "customer channel: never dispatches");
assert.equal((await dispatch("staff")).length, 0, "staff channel: never dispatches");

// Unset env stays the global emergency off switch, even for eligible channels.
assert.equal((await dispatch("instagram", { envSet: false })).length, 0, "env unset: no dispatch");

// Instagram: exactly one authenticated event, claims === body, channel signed.
const [ig] = await dispatch("instagram");
assert.ok(ig, "instagram must dispatch");
assert.equal(webhookCalls.length, 1, "instagram must dispatch exactly once");
assert.equal(ig.headers["x-atlas-jwt"], undefined, "x-atlas-jwt must not be sent");
assert.match(ig.headers["Authorization"], /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
const igJwt = ig.headers["Authorization"].replace(/^Bearer\s+/i, "");
const [h, p, s] = igJwt.split(".");
assert.equal(s, createHmac("sha256", "test-secret").update(`${h}.${p}`).digest("base64url"));
const igClaims = b64uJson(p);
const igBody = JSON.parse(ig.body);
assert.deepEqual(Object.keys(igBody), [
  "eventId",
  "eventType",
  "occurredAt",
  "orderNumber",
  "channel",
]);
for (const key of Object.keys(igBody)) assert.equal(igClaims[key], igBody[key]);
assert.equal(igBody.channel, "instagram", "signed event must carry channel=instagram");
assert.equal(igBody.orderNumber, "TP-TEST-000001");
assert.equal(igClaims.jti, igBody.eventId);
assert.equal(ig.headers["x-atlas-event-id"], igBody.eventId);
assert.equal(ig.headers["x-atlas-timestamp"], igBody.occurredAt);

// Messenger: same contract, channel signed as messenger.
const [ms] = await dispatch("messenger");
assert.ok(ms, "messenger must dispatch");
assert.equal(webhookCalls.length, 1, "messenger must dispatch exactly once");
assert.equal(JSON.parse(ms.body).channel, "messenger");

/* ── 4. Eligible-channel failure isolation + safe logging ────────────────── */

// Webhook 500 / network failure: dispatch is attempted, nothing throws, and
// the log lines carry no secret, no JWT, and no webhook host.
const logLines = [];
const originalLog = console.log;
const originalError = console.error;
console.log = (...args) => logLines.push(args.join(" "));
console.error = (...args) => logLines.push(args.join(" "));
try {
  assert.equal((await dispatch("instagram", { behavior: "http500" })).length, 1);
  assert.equal((await dispatch("instagram", { behavior: "reject" })).length, 1);
} finally {
  console.log = originalLog;
  console.error = originalError;
}
assert.ok(
  logLines.some((line) => line.includes("rejected")),
  "HTTP 500 must be logged as rejected",
);
assert.ok(
  logLines.some((line) => line.includes("failed")),
  "network failure must be logged",
);
for (const line of logLines) {
  assert.ok(!line.includes("test-secret"), "logs must not contain the secret");
  assert.ok(!line.includes("Bearer"), "logs must not contain the Authorization header");
  assert.ok(!line.includes("eyJ"), "logs must not contain a JWT");
  assert.ok(!line.includes("n8n.invalid"), "logs must not contain the webhook host");
}

console.log("test-automation-bridge: all assertions passed");
