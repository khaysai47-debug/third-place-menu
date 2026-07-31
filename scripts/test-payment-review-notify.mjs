// Wednesday Phase 0 — payment.reviewed notification dispatcher check (no test
// framework — run with `npm run test:payment-review`). Compiles
// api/_lib/paymentReviewNotify.server.ts and stubs both Supabase reads and the
// n8n webhook to assert:
//   - one signed event per successful approval / rejection, with the exact
//     validated reason and the authoritative payment status;
//   - channel + externalChatId come from the SERVER-side bot_sessions lookup;
//   - it skips safely with no bot session, no webhook URL, or no secret;
//   - non-2xx / timeout / network failure are contained and logged safely;
//   - the payload carries no storage path, proof URL, Supabase id or PII, and
//     logs carry no secret, JWT, webhook host or chat id;
//   - eventId is bound three ways: body, JWT jti, x-atlas-event-id.
// No network, no real secrets.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/payment-review-notify-test";
execSync(
  `npx tsc api/_lib/paymentReviewNotify.server.ts --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const { firePaymentReviewNotification } = await import(
  pathToFileURL(path.resolve(outDir, "paymentReviewNotify.server.js")).href
);

const HOOK = "https://n8n.invalid/webhook/atlas-payment-review-test";
const SECRET = "review-test-secret";
const ORDER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"; // internal Supabase id
const CHAT_ID = "17841400000000001";

process.env.VITE_SUPABASE_URL = "https://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-not-a-real-key";

const b64uJson = (segment) => JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));

let bh;
function reset(over = {}) {
  bh = {
    orderRows: [{ id: ORDER_ID }],
    sessionRows: [{ platform: "instagram", external_chat_id: CHAT_ID }],
    hookBehavior: "ok", // "ok" | "http403" | "reject" | "timeout"
    calls: [],
    reads: [],
    ...over,
  };
}
reset();

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes("/rest/v1/orders?")) {
    bh.reads.push(u);
    return Response.json(bh.orderRows);
  }
  if (u.includes("/rest/v1/bot_sessions?")) {
    bh.reads.push(u);
    return Response.json(bh.sessionRows);
  }
  if (u === HOOK) {
    bh.calls.push(init);
    if (bh.hookBehavior === "reject") throw new TypeError("fetch failed");
    if (bh.hookBehavior === "timeout") {
      const error = new Error("timed out");
      error.name = "TimeoutError";
      throw error;
    }
    if (bh.hookBehavior === "http403") {
      return new Response(JSON.stringify({ message: "Authorization data is wrong!" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("ok");
  }
  throw new Error(`unexpected fetch target: ${init.method ?? "GET"} ${u}`);
};

const setEnv = ({ hook = HOOK, secret = SECRET } = {}) => {
  if (hook) process.env.N8N_PAYMENT_REVIEW_WEBHOOK_URL = hook;
  else delete process.env.N8N_PAYMENT_REVIEW_WEBHOOK_URL;
  if (secret) process.env.N8N_AUTOMATION_SECRET = secret;
  else delete process.env.N8N_AUTOMATION_SECRET;
};

const APPROVED = {
  orderNumber: "TP-IG-000042",
  decision: "approve",
  rejectionReason: null,
  paymentStatus: "Paid",
};
const REJECTED = {
  orderNumber: "TP-IG-000042",
  decision: "reject",
  rejectionReason: "Wrong amount",
  paymentStatus: "unpaid",
};

/** Fires once, capturing console output, and returns { calls, logs }. */
async function fire(review, { env = {}, state = {} } = {}) {
  reset(state);
  setEnv(env);
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(" "));
  console.error = (...a) => logs.push(a.join(" "));
  try {
    firePaymentReviewNotification(review);
    // Delivery floats past the caller (waitUntil no-ops off Vercel) — give the
    // lookups + POST a tick to settle.
    await new Promise((r) => setTimeout(r, 40));
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  // Nothing anywhere may leak a credential, the webhook host, or the chat id.
  for (const line of logs) {
    assert.ok(!line.includes(SECRET), "logs must not contain the automation secret");
    assert.ok(!line.includes("Bearer"), "logs must not contain an Authorization header");
    assert.ok(!line.includes("eyJ"), "logs must not contain a JWT");
    assert.ok(!line.includes("n8n.invalid"), "logs must not contain the webhook host");
    assert.ok(!line.includes(HOOK), "logs must not contain the webhook URL");
    assert.ok(!line.includes(CHAT_ID), "logs must not contain the external chat id");
  }
  return { calls: bh.calls, logs, reads: bh.reads };
}

/* ── A. One signed event per successful APPROVAL ─────────────────────────── */

let { calls } = await fire(APPROVED);
assert.equal(calls.length, 1, "approval dispatches exactly once");
const approve = calls[0];
let body = JSON.parse(approve.body);

// The payload is EXACTLY the agreed contract — no extra key can ride along.
assert.deepEqual(
  Object.keys(body),
  [
    "eventId",
    "eventType",
    "occurredAt",
    "orderNumber",
    "channel",
    "externalChatId",
    "decision",
    "rejectionReason",
    "paymentStatus",
  ],
  "payload keys are exactly the payment.reviewed contract",
);
assert.equal(body.eventType, "payment.reviewed");
assert.match(body.eventId, /^[0-9a-f-]{36}$/, "eventId is a uuid");
assert.ok(!Number.isNaN(Date.parse(body.occurredAt)), "occurredAt is a timestamp");
assert.equal(body.orderNumber, "TP-IG-000042");
assert.equal(body.decision, "approved", "approve → decision approved");
assert.equal(body.rejectionReason, null, "an approval carries rejectionReason null");
assert.equal(body.paymentStatus, "paid", "an approval carries paymentStatus paid");

/* ── B. Headers + three-way eventId binding ──────────────────────────────── */

assert.equal(approve.method, "POST");
assert.equal(approve.headers["Content-Type"], "application/json");
assert.match(approve.headers["Authorization"], /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
assert.equal(approve.headers["x-atlas-event-id"], body.eventId, "header eventId matches the body");
assert.ok(approve.signal, "the POST carries an abort signal (timeout)");

const [h, p, s] = approve.headers["Authorization"].replace(/^Bearer\s+/i, "").split(".");
assert.equal(
  s,
  createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url"),
  "the JWT is signed with N8N_AUTOMATION_SECRET",
);
const claims = b64uJson(p);
assert.equal(claims.sub, "payment.reviewed", "the JWT subject is payment.reviewed");
assert.equal(claims.jti, body.eventId, "JWT jti matches the body eventId");
assert.equal(claims.iss, "atlas-order-bridge");
assert.equal(claims.aud, "n8n-order-automation");
for (const key of Object.keys(body)) assert.equal(claims[key], body[key], `${key} is signed`);

/* ── C. One signed event per successful REJECTION ────────────────────────── */

({ calls } = await fire(REJECTED));
assert.equal(calls.length, 1, "rejection dispatches exactly once");
body = JSON.parse(calls[0].body);
assert.equal(body.decision, "rejected", "reject → decision rejected");
assert.equal(body.rejectionReason, "Wrong amount", "the EXACT validated reason is sent");
assert.equal(body.paymentStatus, "unpaid", "a rejection leaves the order unpaid");

// A free-text "Other" reason travels verbatim, not normalised or truncated.
({ calls } = await fire({ ...REJECTED, rejectionReason: "Slip is from another shop" }));
assert.equal(
  JSON.parse(calls[0].body).rejectionReason,
  "Slip is from another shop",
  "a custom reason is sent verbatim",
);

// A stray reason on an APPROVAL is dropped — approvals always carry null.
({ calls } = await fire({ ...APPROVED, rejectionReason: "leftover" }));
assert.equal(
  JSON.parse(calls[0].body).rejectionReason,
  null,
  "an approval never carries a rejection reason",
);

// paymentStatus follows the RPC's authoritative order state, not the decision.
({ calls } = await fire({ ...APPROVED, paymentStatus: null }));
assert.equal(
  JSON.parse(calls[0].body).paymentStatus,
  "unpaid",
  "an unknown payment status is reported unpaid, never assumed paid",
);

/* ── D. channel + externalChatId come from the SERVER-side lookup ─────────── */

// Nothing in the review result names a chat: both values can only come from
// bot_sessions. Change the stored row and the event follows it.
({ calls } = await fire(APPROVED, {
  state: { sessionRows: [{ platform: "messenger", external_chat_id: "99887766554433221" }] },
}));
body = JSON.parse(calls[0].body);
assert.equal(body.channel, "messenger", "channel comes from bot_sessions.platform");
assert.equal(
  body.externalChatId,
  "99887766554433221",
  "externalChatId comes from bot_sessions.external_chat_id",
);

// The session is found via the reviewed order's INTERNAL id, and only a
// completed session counts.
const { reads } = await fire(APPROVED);
assert.equal(reads.length, 2, "exactly two server-side reads");
assert.ok(reads[0].includes("orders?order_number=eq.TP-IG-000042"), "order looked up by number");
assert.ok(reads[1].includes(`bot_sessions?order_id=eq.${ORDER_ID}`), "session found by order id");
assert.ok(reads[1].includes("status=eq.completed"), "only a completed session is used");

// A platform outside the chat vocabulary is refused rather than forwarded.
for (const platform of ["customer", "staff", "sms", "", null]) {
  const r = await fire(APPROVED, { state: { sessionRows: [{ platform, external_chat_id: CHAT_ID }] } });
  assert.equal(r.calls.length, 0, `platform ${JSON.stringify(platform)} never dispatches`);
}
// A chat id failing the Meta PSID/IGSID charset is refused too.
for (const chatId of ["has space", "bad/slash", "", null]) {
  const r = await fire(APPROVED, {
    state: { sessionRows: [{ platform: "instagram", external_chat_id: chatId }] },
  });
  assert.equal(r.calls.length, 0, `chat id ${JSON.stringify(chatId)} never dispatches`);
}

/* ── E. Safe skips ───────────────────────────────────────────────────────── */

let r = await fire(APPROVED, { state: { sessionRows: [] } });
assert.equal(r.calls.length, 0, "no bot session → nothing is sent");
assert.ok(
  r.logs.some((l) => l.includes("skipped=no_bot_session")),
  "the skip is visible in the log",
);

r = await fire(APPROVED, { state: { orderRows: [] } });
assert.equal(r.calls.length, 0, "unknown order → nothing is sent");

r = await fire(APPROVED, { env: { hook: null } });
assert.equal(r.calls.length, 0, "no webhook URL → nothing is sent");
assert.equal(r.reads.length, 0, "no webhook URL → not even a Supabase read");

r = await fire(APPROVED, { env: { secret: null } });
assert.equal(r.calls.length, 0, "no automation secret → nothing is sent");
assert.equal(r.reads.length, 0, "no automation secret → not even a Supabase read");

r = await fire(APPROVED, { env: { hook: null, secret: null } });
assert.equal(r.calls.length, 0, "neither configured → nothing is sent");

/* ── F. Delivery failures are contained (the review response never moves) ─── */

// firePaymentReviewNotification returns void and is called AFTER the review
// response is built — the contract is simply that none of these throw.
for (const behavior of ["http403", "reject", "timeout"]) {
  r = await fire(APPROVED, { state: { hookBehavior: behavior } });
  assert.equal(r.calls.length, 1, `${behavior}: the attempt was made`);
  assert.ok(r.logs.length > 0, `${behavior}: the outcome is logged`);
}

// A non-2xx logs a short SANITIZED reason, never the raw remote body.
r = await fire(APPROVED, { state: { hookBehavior: "http403" } });
const rejectedLine = r.logs.find((l) => l.includes("PAYMENT_REVIEW_NOTIFY")) ?? "";
assert.match(rejectedLine, /status=403 rejected reason="Authorization data is wrong!"$/);
assert.ok(!rejectedLine.includes('{"'), "the raw JSON body is never logged");

// A network failure / timeout logs the error NAME only.
r = await fire(APPROVED, { state: { hookBehavior: "reject" } });
assert.ok(
  r.logs.some((l) => /failed: TypeError$/.test(l)),
  "a network failure logs the error name only",
);
r = await fire(APPROVED, { state: { hookBehavior: "timeout" } });
assert.ok(
  r.logs.some((l) => /failed: TimeoutError$/.test(l)),
  "a timeout logs the error name only",
);

// A Supabase read failure is contained too.
const savedFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("/rest/v1/")) throw new TypeError("supabase down");
  return savedFetch(url, init);
};
r = await fire(APPROVED);
assert.equal(r.calls.length, 0, "an unreachable Supabase sends nothing and throws nothing");
globalThis.fetch = savedFetch;

/* ── G. No storage path, proof URL, Supabase id or PII in the payload ─────── */

({ calls } = await fire(APPROVED));
const raw = calls[0].body;
for (const forbidden of [
  "proof_file_path",
  "proof_url",
  "proofUrl",
  "payment-proofs",
  "storage",
  "/object/sign/",
  "http",
  "supabase",
  "Bearer",
  SECRET,
  ORDER_ID, // the internal order id resolves the chat but is never sent
]) {
  assert.ok(!raw.includes(forbidden), `the payload never contains ${forbidden}`);
}
for (const pii of ["customerName", "customerPhone", "phone", "address", "total", "subtotal"]) {
  assert.ok(!raw.includes(pii), `the payload never contains ${pii}`);
}

console.log("test-payment-review-notify: all assertions passed");
