// PAYMENT REVIEW → MESSENGER CONTRACT CERTIFICATION (no test framework — run
// with `npm run test:payment-review-messenger-contract`).
//
// Both halves already exist and each has its own suite:
//   - api/_lib/paymentReviewNotify.server.ts generates `payment.reviewed`;
//   - api/_lib/chatMessaging.server.ts validates a send and claims the eventId.
// NOTHING spanned them. This does: it takes the event the REAL dispatcher
// produced, transforms it the way a forwarder must, and feeds it to the REAL
// send-chat-message handler with a MOCK provider, asserting that
//   - the generated event is a valid send request for BOTH decisions;
//   - an approval can never be read as a rejection, nor the reverse;
//   - the ORIGINAL eventId is what claims the dispatch row;
//   - replaying that same eventId is a duplicate and sends nothing again;
//   - the eventId satisfies the sender's UUIDv4 rule and the order number its
//     TP- rule;
//   - the two known gaps (TP- prefix, Instagram) are exactly where the docs
//     say they are.
//
// SCOPE — repository-side only. It proves the two modules fit each other. It
// does NOT prove that n8n forwards the eventId unchanged; that still needs
// controlled verification against the real workflow. See
// docs/payment-proof-tuesday.md § Repository-side contract certification.
//
// No network, no real secrets, no Supabase, no n8n, no Meta, no customer
// message: every fetch target that is not one of the four stubs throws.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/payment-review-messenger-contract-test";
execSync(
  "npx tsc api/_lib/paymentReviewNotify.server.ts api/_lib/chatMessaging.server.ts" +
    ` --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const load = (file) => import(pathToFileURL(path.resolve(outDir, file)).href);
const { firePaymentReviewNotification } = await load("paymentReviewNotify.server.js");
const { handleSendChatMessage, __test } = await load("chatMessaging.server.js");
const { UUID_V4_PATTERN } = await load("botSession.server.js");

const HOOK = "https://n8n.invalid/webhook/atlas-payment-review-contract";
const N8N_SECRET = "review-contract-test-secret";
const CHAT_SECRET = "chat-messaging-contract-test-secret";
const ORDER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"; // internal Supabase id
const ORDER = "TP-MS-000042";
const CHAT_ID = "17841400000000001";

process.env.VITE_SUPABASE_URL = "https://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-not-a-real-key";
process.env.N8N_PAYMENT_REVIEW_WEBHOOK_URL = HOOK;
process.env.N8N_AUTOMATION_SECRET = N8N_SECRET;
process.env.CHAT_MESSAGING_SECRET = CHAT_SECRET;
// The provider is injected below, so the real Meta adapter is never reachable
// from this file. Unset the token anyway — belt and braces.
delete process.env.META_PAGE_ACCESS_TOKEN;

/* ── The stubbed world ───────────────────────────────────────────────────── */

/** The dispatch store, with the one property that matters: UNIQUE event_id. */
const dispatches = new Map();

/** Every `payment.reviewed` POST the dispatcher made, newest last. */
let hookPosts = [];

function eventIdFromUrl(url) {
  return decodeURIComponent(url.split("event_id=eq.")[1]?.split("&")[0] ?? "");
}

const conflict = () =>
  Response.json(
    {
      code: "23505",
      message: 'duplicate key value violates unique constraint "chat_message_dispatches_pkey"',
      details: "Key (event_id)=(...) already exists.",
    },
    { status: 409 },
  );

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method ?? "GET").toUpperCase();

  // 1. The dispatcher's SERVER-side chat resolution.
  if (u.includes("/rest/v1/orders?")) return Response.json([{ id: ORDER_ID }]);
  if (u.includes("/rest/v1/bot_sessions?")) {
    return Response.json([{ platform: "messenger", external_chat_id: CHAT_ID }]);
  }

  // 2. The n8n webhook — captured, never really called.
  if (u === HOOK) {
    hookPosts.push(init);
    return new Response("ok");
  }

  // 3. The dispatch store, with a real unique-key claim.
  if (u.includes("/rest/v1/chat_message_dispatches")) {
    if (method === "POST") {
      const row = JSON.parse(init.body);
      if (dispatches.has(row.event_id)) return conflict();
      dispatches.set(row.event_id, row);
      return new Response(null, { status: 201 });
    }
    if (method === "GET") {
      const row = dispatches.get(eventIdFromUrl(u));
      return Response.json(row ? [row] : []);
    }
    if (method === "PATCH") {
      const id = eventIdFromUrl(u);
      dispatches.set(id, { ...dispatches.get(id), ...JSON.parse(init.body) });
      return new Response(null, { status: 204 });
    }
  }

  // Anything else — Meta above all — is a hard failure. That is what proves
  // this file opens no socket and sends no customer message.
  throw new Error(`unexpected fetch target: ${method} ${u}`);
};

/** Runs fn with console captured, so the check's own output stays readable. */
async function capture(fn) {
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(" "));
  console.error = (...a) => logs.push(a.join(" "));
  try {
    return { value: await fn(), logs };
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
}

/* ── Half 1: the REAL dispatcher generates the event ─────────────────────── */

/** Fires one review and returns the `payment.reviewed` body it posted. */
async function generateEvent(review) {
  hookPosts = [];
  await capture(async () => {
    firePaymentReviewNotification(review);
    // Delivery floats past the caller (waitUntil no-ops off Vercel) — give the
    // two lookups and the POST a tick to settle.
    await new Promise((r) => setTimeout(r, 40));
  });
  assert.equal(hookPosts.length, 1, "the dispatcher posted exactly one event");
  return JSON.parse(hookPosts[0].body);
}

/* ── The transformation under certification ──────────────────────────────── */

/**
 * The reply, chosen by `decision` alone — two disjoint texts, so neither
 * decision has a branch that can reach the other's wording. The sender never
 * composes a message, so this belongs to the caller, exactly as here.
 */
function compose(event) {
  const text =
    event.decision === "approved"
      ? `Payment approved for ${event.orderNumber}. We're preparing your order.`
      : `Payment rejected for ${event.orderNumber}: ${event.rejectionReason ?? "unspecified"}.`;
  return { type: "text", text };
}

/**
 * event → send request. This is what the forwarder (n8n today) must do, and it
 * is the whole point of the certification: every identifier is carried
 * VERBATIM, and only the wording is composed.
 */
const toSendRequest = (event) => ({
  eventId: event.eventId,
  orderNumber: event.orderNumber,
  channel: event.channel,
  externalChatId: event.externalChatId,
  message: compose(event),
});

/* ── Half 2: the REAL send handler, with a MOCK provider ─────────────────── */

function mockProvider() {
  const calls = [];
  return {
    calls,
    isConfigured: () => true,
    send: async (input) => {
      calls.push(input);
      const messageRef = `mock-${input.eventId}`;
      return { ok: true, provider: "meta", messageRef, errorClass: null, status: "sent" };
    },
  };
}

const req = (payload) =>
  new Request("https://app.invalid/api/automation/send-chat-message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-chat-messaging-secret": CHAT_SECRET,
    },
    body: JSON.stringify(payload),
  });

/** One request through the real handler. */
async function send(payload, provider) {
  const { value } = await capture(() => handleSendChatMessage(req(payload), provider));
  return { status: value.status, json: await value.json().catch(() => null) };
}

/* ══════════════════════════════════════════════════════════════════════════
   A. The APPROVED decision spans both halves
   ══════════════════════════════════════════════════════════════════════════ */

const approved = await generateEvent({
  orderNumber: ORDER,
  decision: "approve",
  rejectionReason: null,
  paymentStatus: "Paid",
});

assert.equal(approved.eventType, "payment.reviewed", "1. the dispatcher emitted the event");
assert.equal(approved.decision, "approved", "1. an approval is `approved`");
assert.equal(approved.rejectionReason, null, "1. an approval carries no reason");
assert.equal(approved.paymentStatus, "paid", "1. it reports the paid order state");
assert.equal(approved.channel, "messenger", "1. the channel came from bot_sessions");
assert.equal(approved.externalChatId, CHAT_ID, "1. and so did the chat id");

// The SENDER's own rules, applied to the DISPATCHER's own output.
assert.match(approved.eventId, UUID_V4_PATTERN, "2. the eventId is a sender-valid UUIDv4");
assert.match(approved.orderNumber, __test.ORDER_NUMBER_PATTERN, "2. the order number is TP-");

let provider = mockProvider();
const approvedRequest = toSendRequest(approved);
let out = await send(approvedRequest, provider);

assert.equal(out.status, 200, "3. the approved event is a valid send request");
assert.equal(out.json.status, "sent", "3. and it dispatches");
assert.equal(out.json.ok, true, "3. as a success");
assert.equal(provider.calls.length, 1, "3. the provider ran exactly once");

// The eventId is preserved END TO END: request, provider input, claim row.
assert.equal(approvedRequest.eventId, approved.eventId, "4. the request reuses the eventId");
assert.equal(provider.calls[0].eventId, approved.eventId, "4. so does the provider input");
assert.ok(dispatches.has(approved.eventId), "4. and the claim row is keyed by it");
const claim = dispatches.get(approved.eventId);
assert.equal(claim.order_number, approved.orderNumber, "4. the row carries the order number");
assert.equal(claim.state, "sent", "4. and the claim completed as sent");

// An approval cannot be interpreted as a rejection.
const approvedText = provider.calls[0].message.text;
assert.ok(approvedText.includes("approved"), "5. the approved reply says approved");
assert.ok(!approvedText.includes("rejected"), "5. and never says rejected");

/* ══════════════════════════════════════════════════════════════════════════
   B. The REJECTED decision spans both halves
   ══════════════════════════════════════════════════════════════════════════ */

const rejected = await generateEvent({
  orderNumber: ORDER,
  decision: "reject",
  rejectionReason: "Wrong amount",
  paymentStatus: "unpaid",
});

assert.equal(rejected.decision, "rejected", "6. a rejection is `rejected`");
assert.equal(rejected.rejectionReason, "Wrong amount", "6. with the exact staff reason");
assert.equal(rejected.paymentStatus, "unpaid", "6. and an unpaid order state");
assert.notEqual(rejected.eventId, approved.eventId, "6. each review has its own eventId");
assert.match(rejected.eventId, UUID_V4_PATTERN, "6. also a sender-valid UUIDv4");

provider = mockProvider();
const rejectedRequest = toSendRequest(rejected);
out = await send(rejectedRequest, provider);

assert.equal(out.status, 200, "7. the rejected event is a valid send request");
assert.equal(out.json.status, "sent", "7. and it dispatches");
assert.equal(provider.calls.length, 1, "7. the provider ran exactly once");
assert.equal(provider.calls[0].eventId, rejected.eventId, "7. under the original eventId");
assert.ok(dispatches.has(rejected.eventId), "7. which claims its own row");

// A rejection cannot be interpreted as an approval.
const rejectedText = provider.calls[0].message.text;
assert.ok(rejectedText.includes("rejected"), "8. the rejected reply says rejected");
assert.ok(!rejectedText.includes("approved"), "8. and never says approved");
assert.ok(rejectedText.includes("Wrong amount"), "8. it carries the staff reason");
assert.notEqual(rejectedText, approvedText, "8. the decisions never compose the same text");

// The decision is the ONLY thing that picks the wording: same order, same
// chat, flip the decision and the other text comes out — both ways.
const asApproval = { ...rejected, decision: "approved", rejectionReason: null };
assert.equal(compose(asApproval).text, approvedText, "8. decision alone picks the text");
const asRejection = { ...approved, decision: "rejected", rejectionReason: "Wrong amount" };
assert.equal(compose(asRejection).text, rejectedText, "8. and it flips cleanly both ways");

/* ══════════════════════════════════════════════════════════════════════════
   C. A replay of the SAME eventId never sends twice
   ══════════════════════════════════════════════════════════════════════════ */

// The same logical event, forwarded again — an external retry, a manual
// replay. The store's UNIQUE event_id decides: the second insert conflicts and
// the stored row answers.
provider = mockProvider();
out = await send(approvedRequest, provider);
assert.equal(out.status, 200, "9. a replay is still a well-formed request");
assert.equal(out.json.status, "duplicate", "9. classified as a duplicate");
assert.equal(out.json.ok, true, "9. answered as a success, not an error");
assert.equal(out.json.messageRef, `mock-${approved.eventId}`, "9. from the stored row");
assert.equal(provider.calls.length, 0, "9. the provider is NOT invoked again");

// Recomposing the request changes nothing — the identity is the eventId, not
// the message.
provider = mockProvider();
out = await send(toSendRequest(approved), provider);
assert.equal(out.json.status, "duplicate", "10. a recomposed replay is still a duplicate");
assert.equal(provider.calls.length, 0, "10. and still no second send");
assert.equal(dispatches.size, 2, "10. two reviews, two rows — a replay adds none");

/* ══════════════════════════════════════════════════════════════════════════
   D. The known gaps, pinned rather than papered over
   ══════════════════════════════════════════════════════════════════════════ */

// D1. THE TP- PREFIX GAP — open, and deliberately NOT changed here. The sender
//     requires the TP- prefix; intake and the dashboard reads accept the
//     broader charset (`^[A-Za-z0-9-]{1,32}$` in paymentIntake.server.ts and
//     staffDashboardReads.server.ts). An order number legal there is refused
//     by the sender at the trust boundary, before any claim.
const BROADER_ORDER_NUMBER_PATTERN = /^[A-Za-z0-9-]{1,32}$/;
const UNPREFIXED = "IG-000042";
assert.match(UNPREFIXED, BROADER_ORDER_NUMBER_PATTERN, "11. the broader repo rule accepts it");
assert.doesNotMatch(UNPREFIXED, __test.ORDER_NUMBER_PATTERN, "11. the sender's rule does not");

provider = mockProvider();
out = await send({ ...approvedRequest, orderNumber: UNPREFIXED }, provider);
assert.equal(out.status, 400, "11. so the sender refuses it");
assert.equal(provider.calls.length, 0, "11. nothing is sent");
assert.equal(dispatches.size, 2, "11. and no eventId is consumed");

// D2. INSTAGRAM IS NOT CERTIFIED. The dispatcher can emit channel "instagram";
//     the sender refuses it BEFORE the claim, so the event stays replayable
//     under the same eventId once Instagram sending lands.
provider = mockProvider();
const messengerOnly = { ...provider, isConfigured: (c) => (c === "messenger" ? true : "other") };
out = await send({ ...rejectedRequest, channel: "instagram" }, messengerOnly);
assert.equal(out.status, 503, "12. an instagram event is refused before the claim");
assert.equal(out.json.errorClass, "other", "12. with the unimplemented-channel class");
assert.equal(provider.calls.length, 0, "12. nothing is sent");
assert.equal(dispatches.size, 2, "12. and no eventId is burned");

/* ══════════════════════════════════════════════════════════════════════════
   E. Nothing here could have reached a customer
   ══════════════════════════════════════════════════════════════════════════ */

for (const target of ["https://graph.facebook.com/v23.0/me/messages", "https://x.invalid/"]) {
  await assert.rejects(
    () => globalThis.fetch(target, { method: "POST" }),
    /unexpected fetch target/,
    "13. nothing outside the four stubs can reach the network",
  );
}

console.log("test-payment-review-messenger-contract: all assertions passed");
