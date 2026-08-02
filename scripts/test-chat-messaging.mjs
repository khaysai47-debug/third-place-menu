// App-owned chat messaging endpoint check (no test framework — run with
// `npm run test:chat-messaging`). Compiles api/_lib/chatMessaging.server.ts and
// stubs BOTH the Supabase dispatch store and the provider adapter to assert:
//   - the trusted secret is required and compared, not merely present;
//   - the body contract is exact (9 rules, unknown keys refused);
//   - the DATABASE decides ownership: only the caller whose insert wins may
//     send, and every duplicate answers from the stored row instead;
//   - a failed, throwing, or unwritten-completion send ends as needs_review and
//     is NEVER automatically resent;
//   - the raw chat id, the message text, the secret, and provider response
//     bodies reach neither the dispatch row nor the logs;
//   - the shipped Meta adapter is disabled and cannot send.
// No network, no real secrets, no Supabase, no Meta.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/chat-messaging-test";
execSync(
  `npx tsc api/_lib/chatMessaging.server.ts --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const { handleSendChatMessage, postSendChatMessage, metaProvider, __test } = await import(
  pathToFileURL(path.resolve(outDir, "chatMessaging.server.js")).href
);

const SECRET = "chat-messaging-test-secret";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";
const CHAT_ID = "17841400000000001";
const ORDER = "TP-IG-000042";
const MESSAGE = "Payment confirmed for TP-IG-000042. We're preparing your order.";

process.env.CHAT_MESSAGING_SECRET = SECRET;
process.env.VITE_SUPABASE_URL = "https://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-not-a-real-key";

/* ── Stubbed dispatch store ──────────────────────────────────────────────── */

let bh;
function reset(over = {}) {
  bh = {
    claim: "ok", // "ok" | "conflict" | "error" | "throw"
    existing: null, // the row a conflicting claim reads back
    read: "ok", // "ok" | "error"
    complete: "ok", // "ok" | "error"
    inserts: [],
    reads: [],
    patches: [],
    ...over,
  };
}
reset();

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
  if (!u.includes("/rest/v1/chat_message_dispatches")) {
    throw new Error(`unexpected fetch target: ${method} ${u}`);
  }
  if (method === "POST") {
    bh.inserts.push(JSON.parse(init.body));
    if (bh.claim === "throw") throw new TypeError("supabase down");
    if (bh.claim === "conflict") return conflict();
    if (bh.claim === "error") return Response.json({ code: "42501" }, { status: 403 });
    return new Response(null, { status: 201 });
  }
  if (method === "GET") {
    bh.reads.push(u);
    if (bh.read === "error") return new Response("nope", { status: 500 });
    return Response.json(bh.existing ? [bh.existing] : []);
  }
  if (method === "PATCH") {
    bh.patches.push(JSON.parse(init.body));
    if (bh.complete === "error") return new Response("nope", { status: 500 });
    return new Response(null, { status: 204 });
  }
  throw new Error(`unexpected method: ${method} ${u}`);
};

/* ── Providers (injected — no request field can select or influence one) ─── */

const spy = () => {
  const calls = [];
  return {
    calls,
    ok: {
      isConfigured: () => true,
      send: async (input) => {
        calls.push(input);
        return {
          ok: true,
          provider: "meta",
          messageRef: `mock-${input.eventId}`,
          errorClass: null,
          status: "sent",
        };
      },
    },
    failing: {
      isConfigured: () => true,
      send: async (input) => {
        calls.push(input);
        return {
          ok: false,
          provider: "meta",
          messageRef: null,
          errorClass: "rate_limited",
          status: "needs_review",
        };
      },
    },
    throwing: {
      isConfigured: () => true,
      send: async (input) => {
        calls.push(input);
        throw new Error("provider exploded with 17841400000000001 in the message");
      },
    },
  };
};

const body = (over = {}) => ({
  eventId: EVENT_ID,
  orderNumber: ORDER,
  channel: "instagram",
  externalChatId: CHAT_ID,
  message: MESSAGE,
  ...over,
});

const req = (payload, secret = SECRET) =>
  new Request("https://app.invalid/api/automation/send-chat-message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(secret === null ? {} : { "x-chat-messaging-secret": secret }),
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });

/** Runs one request with captured logs. */
async function send(payload, provider, { secret = SECRET, state = {} } = {}) {
  reset(state);
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(" "));
  console.error = (...a) => logs.push(a.join(" "));
  let response;
  try {
    response = await handleSendChatMessage(req(payload, secret), provider);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  const json = await response.json().catch(() => null);
  return { status: response.status, json, logs, inserts: bh.inserts, patches: bh.patches };
}

/* ══════════════════════════════════════════════════════════════════════════
   A. Authentication (tests 1–2)
   ══════════════════════════════════════════════════════════════════════════ */

let p = spy();
let out = await send(body(), p.ok, { secret: null });
assert.equal(out.status, 401, "1. a missing secret header is rejected");
assert.equal(p.calls.length, 0, "1. no provider call without auth");
assert.equal(out.inserts.length, 0, "1. no claim without auth");

p = spy();
out = await send(body(), p.ok, { secret: "wrong-secret-of-the-same-length!!" });
assert.equal(out.status, 401, "2. a wrong secret is rejected");
assert.equal(p.calls.length, 0, "2. no provider call on a wrong secret");
assert.equal(out.inserts.length, 0, "2. no claim on a wrong secret");

/* ══════════════════════════════════════════════════════════════════════════
   B. The request contract (tests 3–8)
   ══════════════════════════════════════════════════════════════════════════ */

p = spy();
out = await send(body(), p.ok);
assert.equal(out.status, 200, "3. a valid request reaches the handler");
assert.equal(out.json.ok, true);
assert.equal(out.json.status, "sent");
assert.equal(out.json.provider, "meta");
assert.equal(out.json.errorClass, null);
assert.equal(out.json.messageRef, `mock-${EVENT_ID}`);
assert.deepEqual(
  Object.keys(out.json).sort(),
  ["errorClass", "messageRef", "ok", "provider", "status"],
  "3. the response is exactly the normalized contract",
);

p = spy();
out = await send(body({ extra: "nope" }), p.ok);
assert.equal(out.status, 400, "4. an extra body key is rejected");
assert.equal(p.calls.length, 0, "4. no provider call on an extra key");
assert.equal(out.inserts.length, 0, "4. no claim on an extra key");

for (const bad of ["not-a-uuid", "22222222-2222-3222-8222-222222222222", "", 42, null]) {
  p = spy();
  out = await send(body({ eventId: bad }), p.ok);
  assert.equal(out.status, 400, `5. eventId ${JSON.stringify(bad)} is rejected`);
  assert.equal(p.calls.length, 0, "5. no provider call on a bad eventId");
}

for (const bad of ["sms", "customer", "staff", "", null, { channel: "instagram" }]) {
  p = spy();
  out = await send(body({ channel: bad }), p.ok);
  assert.equal(out.status, 400, `6. channel ${JSON.stringify(bad)} is rejected`);
  assert.equal(p.calls.length, 0, "6. no provider call on a bad channel");
}

for (const bad of ["has space", "bad/slash", "", "a".repeat(129), null, ["1784140"]]) {
  p = spy();
  out = await send(body({ externalChatId: bad }), p.ok);
  assert.equal(out.status, 400, `7. externalChatId ${JSON.stringify(bad)} is rejected`);
  assert.equal(p.calls.length, 0, "7. no provider call on a bad chat id");
}

for (const bad of ["", "   ", "x".repeat(1001), null, 7, { text: "hi" }]) {
  p = spy();
  out = await send(body({ message: bad }), p.ok);
  assert.equal(out.status, 400, `8. message ${JSON.stringify(bad)?.slice(0, 20)} is rejected`);
  assert.equal(p.calls.length, 0, "8. no provider call on a bad message");
}

// 8b. The order number must be a real Atlas order number — the TP- prefix is
//     REQUIRED, not merely allowed by the charset. 32 characters total: the
//     3-character prefix plus 1..29.
const MAX_ORDER = `TP-${"A".repeat(29)}`; // exactly 32 characters
assert.equal(MAX_ORDER.length, 32, "8b. the boundary case is the real maximum");

for (const good of ["TP-IG-STG0001", "TP-IG-000042", "TP-S-1", "TP-MS-000001", "TP-1", MAX_ORDER]) {
  p = spy();
  out = await send(body({ orderNumber: good }), p.ok);
  assert.equal(out.status, 200, `8b. orderNumber ${good} is accepted`);
  assert.equal(p.calls.length, 1, `8b. ${good} reaches the provider`);
  assert.equal(out.inserts[0].order_number, good, "8b. the order number is stored verbatim");
}

for (const bad of [
  "ABC", // no prefix, letters only
  "123", // no prefix, digits only
  "IG-000042", // an Atlas-shaped number with the prefix stripped
  "tp-IG-000042", // lower-case prefix — the pattern is case-sensitive
  "XTP-IG-1", // prefix not at the start
  "TP-", // prefix with nothing after it
  "TP IG 1", // space
  `TP-${"A".repeat(30)}`, // 33 characters — one over the maximum
  "",
]) {
  p = spy();
  out = await send(body({ orderNumber: bad }), p.ok);
  assert.equal(out.status, 400, `8b. orderNumber ${JSON.stringify(bad)} is rejected`);
  assert.equal(p.calls.length, 0, `8b. ${JSON.stringify(bad)} never reaches the provider`);
  assert.equal(out.inserts.length, 0, `8b. ${JSON.stringify(bad)} never claims an eventId`);
}

// 8c. The app pattern and the migration's CHECK must stay byte-identical: if
//     they drift, the app accepts a value the database then rejects, and the
//     claim insert fails on a constraint the endpoint reads as "unavailable".
const migration = readFileSync("docs/sql/2026-08-02-chat-message-dispatches.sql", "utf8");
assert.ok(
  migration.includes("check (order_number ~ '^TP-[A-Za-z0-9-]{1,29}$')"),
  "8c. the migration CHECK matches the app's ORDER_NUMBER_PATTERN exactly",
);
assert.equal(
  __test.ORDER_NUMBER_PATTERN.source,
  "^TP-[A-Za-z0-9-]{1,29}$",
  "8c. the app pattern is the TP-prefixed one",
);

/* ══════════════════════════════════════════════════════════════════════════
   C. The claim decides who may send (tests 9–13, 19)
   ══════════════════════════════════════════════════════════════════════════ */

p = spy();
out = await send(body(), p.ok);
assert.equal(p.calls.length, 1, "9. the winning claim invokes the provider exactly once");
assert.equal(out.inserts.length, 1, "9. exactly one claim insert");
assert.equal(out.inserts[0].event_id, EVENT_ID, "9. the claim is keyed by eventId");
assert.equal(out.inserts[0].state, "processing", "9. the claim row starts processing");
assert.equal(out.patches.length, 1, "9. the terminal state is written once");
assert.equal(out.patches[0].state, "sent");
assert.equal(out.patches[0].message_ref, `mock-${EVENT_ID}`);
assert.ok(out.patches[0].completed_at, "9. a terminal row carries completed_at");

// 10 + 11. A replay of an already-SENT event: the claim conflicts, the stored
// row answers, and the provider is never invoked again.
p = spy();
out = await send(body(), p.ok, {
  state: {
    claim: "conflict",
    existing: { state: "sent", provider: "meta", message_ref: "mock-earlier", error_class: null },
  },
});
assert.equal(p.calls.length, 0, "10. a replay never invokes the provider again");
assert.equal(out.status, 200);
assert.equal(out.json.status, "duplicate", "11. a sent row replays as duplicate");
assert.equal(out.json.ok, true);
assert.equal(out.json.messageRef, "mock-earlier", "11. the STORED reference is returned");
assert.equal(out.patches.length, 0, "11. a duplicate writes nothing");

// 12. A claim held by an in-flight request.
p = spy();
out = await send(body(), p.ok, {
  state: { claim: "conflict", existing: { state: "processing", message_ref: null } },
});
assert.equal(out.json.status, "in_progress", "12. a processing row replays as in_progress");
assert.equal(out.json.ok, true);
assert.equal(out.json.messageRef, null);
assert.equal(p.calls.length, 0, "12. in_progress never sends");

// 13. A row already parked for a human.
p = spy();
out = await send(body(), p.ok, {
  state: {
    claim: "conflict",
    existing: { state: "needs_review", error_class: "outside_window", message_ref: null },
  },
});
assert.equal(out.json.status, "needs_review", "13. a needs_review row replays as needs_review");
assert.equal(out.json.ok, false);
assert.equal(out.json.errorClass, "outside_window", "13. the STORED errorClass is returned");
assert.equal(p.calls.length, 0, "13. needs_review never sends");

// 19. Ownership is the ONLY thing that authorises a send. Every non-owning
//     outcome — conflict, unreadable row, unknown state, store failure — must
//     leave the provider untouched.
for (const state of [
  { claim: "conflict", existing: null },
  { claim: "conflict", existing: { state: "who-knows" }, read: "ok" },
  { claim: "conflict", existing: { state: "sent", message_ref: "x" }, read: "error" },
  { claim: "error" },
  { claim: "throw" },
]) {
  p = spy();
  out = await send(body(), p.ok, { state });
  assert.equal(p.calls.length, 0, `19. no send without ownership (${JSON.stringify(state)})`);
  assert.equal(out.patches.length, 0, "19. a non-owner writes no terminal state");
  assert.equal(out.json.ok !== undefined, true, "19. the answer is still normalized");
}

// A store that cannot be reached fails CLOSED, and says so.
p = spy();
out = await send(body(), p.ok, { state: { claim: "throw" } });
assert.equal(out.status, 503, "19b. an unreachable dispatch store fails closed");
assert.equal(out.json.status, "needs_review");
assert.equal(out.json.errorClass, "other");

/* ══════════════════════════════════════════════════════════════════════════
   D. Failure and ambiguity never resend (tests 14, 20)
   ══════════════════════════════════════════════════════════════════════════ */

p = spy();
out = await send(body(), p.failing);
assert.equal(p.calls.length, 1, "14. the owner attempted the send");
assert.equal(out.json.ok, false);
assert.equal(out.json.status, "needs_review", "14. a provider failure ends as needs_review");
assert.equal(out.json.errorClass, "rate_limited", "14. the normalized errorClass is returned");
assert.equal(out.patches.length, 1, "14. the failure is persisted once");
assert.equal(out.patches[0].state, "needs_review");
assert.equal(out.patches[0].error_class, "rate_limited", "14. the row stores the normalized class");

// A THROWING adapter is an unknown outcome — recorded, never retried.
p = spy();
out = await send(body(), p.throwing);
assert.equal(out.json.status, "needs_review", "14b. a throwing provider ends as needs_review");
assert.equal(out.json.errorClass, "other");
assert.equal(out.patches[0].state, "needs_review");

// 20a. After a failure, the replay reads the stored row — no second send.
p = spy();
out = await send(body(), p.ok, {
  state: {
    claim: "conflict",
    existing: { state: "needs_review", error_class: "rate_limited", message_ref: null },
  },
});
assert.equal(p.calls.length, 0, "20a. a failed event is never automatically resent");
assert.equal(out.json.status, "needs_review");

// 20b. The send succeeded but the completion write did not. The answer is
//      needs_review and the row stays `processing`, so every later duplicate
//      reads in_progress — the message can never go out twice.
p = spy();
out = await send(body(), p.ok, { state: { complete: "error" } });
assert.equal(p.calls.length, 1, "20b. the send happened");
assert.equal(out.json.ok, false, "20b. an unwritten completion is not reported as success");
assert.equal(out.json.status, "needs_review");
assert.equal(out.json.errorClass, "other");
assert.ok(
  out.logs.some((l) => l.includes("completion=unwritten")),
  "20b. the completion drift is visible in the log",
);

p = spy();
out = await send(body(), p.ok, {
  state: { claim: "conflict", existing: { state: "processing", message_ref: null } },
});
assert.equal(p.calls.length, 0, "20c. the stuck-processing row suppresses every resend");
assert.equal(out.json.status, "in_progress");

/* ══════════════════════════════════════════════════════════════════════════
   E. Privacy — the row and the logs (tests 15–18)
   ══════════════════════════════════════════════════════════════════════════ */

p = spy();
out = await send(body(), p.ok);
const written = JSON.stringify([...out.inserts, ...out.patches]);

// 15. The raw chat id never reaches the database.
assert.ok(!written.includes(CHAT_ID), "15. the raw externalChatId is never stored");
assert.ok(!written.includes("externalChatId"), "15. not even the field name is stored");
assert.match(out.inserts[0].chat_ref, /^[0-9a-f]{16}$/, "15. chat_ref is a 16-hex reference");
assert.notEqual(out.inserts[0].chat_ref, CHAT_ID);

// The reference is deterministic per chat and differs across chats/channels.
const refFor = async (over) => {
  const r = await send(body(over), spy().ok);
  return r.inserts[0].chat_ref;
};
assert.equal(await refFor({}), out.inserts[0].chat_ref, "15b. chat_ref is stable for one chat");
assert.notEqual(
  await refFor({ externalChatId: "17841400000000002" }),
  out.inserts[0].chat_ref,
  "15c. a different chat gets a different reference",
);
assert.notEqual(
  await refFor({ channel: "messenger" }),
  out.inserts[0].chat_ref,
  "15d. the same id on another channel is a different reference",
);

// 16. The customer-facing text is never stored.
assert.ok(!written.includes(MESSAGE), "16. the message body is never stored");
assert.ok(!written.includes("preparing your order"), "16. no fragment of it either");
// No column CARRIES the text. message_ref is a provider identifier, not a body,
// so the check is on the exact key rather than the substring "message".
for (const row of [...out.inserts, ...out.patches]) {
  assert.ok(!("message" in row), "16. no message column is written at all");
}

// 18. Only a normalized reference and class are persisted — never a body.
assert.deepEqual(
  Object.keys(out.inserts[0]).sort(),
  ["channel", "chat_ref", "claimed_at", "event_id", "order_number", "state"],
  "18. the claim row holds identifiers and state only",
);
assert.deepEqual(
  Object.keys(out.patches[0]).sort(),
  ["completed_at", "message_ref", "provider", "state", "updated_at"],
  "18. the terminal write holds the normalized result only",
);

// A provider that returns an over-long reference is clamped, never stored raw.
const chatty = {
  isConfigured: () => true,
  send: async () => ({
    ok: true,
    provider: "meta",
    messageRef: "m".repeat(500),
    errorClass: null,
    status: "sent",
  }),
};
out = await send(body(), chatty);
assert.equal(out.patches[0].message_ref.length, 200, "18b. a provider reference is length-bounded");

// 17. Nothing anywhere leaks a credential, the chat id, or the message.
const everyLog = [];
for (const [payload, provider, state] of [
  [body(), p.ok, {}],
  [body(), p.failing, {}],
  [body(), p.throwing, {}],
  [body(), p.ok, { claim: "conflict", existing: { state: "sent", message_ref: "m" } }],
  [body(), p.ok, { claim: "throw" }],
  [body(), p.ok, { complete: "error" }],
]) {
  const r = await send(payload, provider, { state });
  everyLog.push(...r.logs);
}
for (const line of everyLog) {
  assert.ok(!line.includes(SECRET), "17. logs must not contain the shared secret");
  assert.ok(!line.includes(CHAT_ID), "17. logs must not contain the raw chat id");
  assert.ok(!line.includes(MESSAGE), "17. logs must not contain the message body");
  assert.ok(!line.includes("dummy-not-a-real-key"), "17. logs must not contain the Supabase key");
  assert.ok(!line.includes("supabase.invalid"), "17. logs must not contain the Supabase host");
  assert.ok(!line.includes("exploded with"), "17. logs must not contain a provider error body");
}

/* ══════════════════════════════════════════════════════════════════════════
   F. The shipped adapter is disabled — it cannot send from this commit
   ══════════════════════════════════════════════════════════════════════════ */

assert.equal(metaProvider.isConfigured(), false, "the Meta adapter ships disabled");
assert.deepEqual(
  await metaProvider.send({
    eventId: EVENT_ID,
    orderNumber: ORDER,
    channel: "instagram",
    externalChatId: CHAT_ID,
    message: MESSAGE,
  }),
  { ok: false, provider: "meta", messageRef: null, errorClass: "auth", status: "needs_review" },
  "the disabled adapter answers needs_review and reaches no network",
);

reset();
const origErr = console.error;
console.error = () => {};
const bound = await postSendChatMessage(req(body()));
console.error = origErr;
assert.equal(bound.status, 503, "the bound route answers 503 while the provider is disabled");
assert.deepEqual(await bound.json(), {
  ok: false,
  provider: "meta",
  messageRef: null,
  errorClass: "auth",
  status: "needs_review",
});
assert.equal(bh.inserts.length, 0, "a disabled provider never consumes the eventId");
assert.equal(bh.patches.length, 0, "a disabled provider writes nothing");

console.log("test-chat-messaging: all assertions passed");
