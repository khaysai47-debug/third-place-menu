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
//   - the real Messenger adapter sends exactly one correctly shaped Graph
//     request and maps every documented Graph error to the closed vocabulary;
//   - message is a strict discriminated union — "text" and "buttons" — and the
//     button template is Meta's exact shape, capped at 3 buttons, with titles,
//     postback payloads and HTTPS URLs all validated at the trust boundary;
//   - no button title, payload, URL, recipient or token reaches a log or a row.
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
    graph: null, // armed only by section F — see the fetch stub
    graphCalls: [],
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
  // The Graph API is reachable ONLY when a test explicitly arms bh.graph
  // (section F). Everywhere else a Meta call is a hard failure, which is what
  // proves the mock-provider tests never touch the network.
  if (u.startsWith("https://graph.facebook.com/")) {
    if (!bh.graph) throw new Error(`unexpected Graph API call: ${method} ${u}`);
    bh.graphCalls.push({ url: u, method, headers: init.headers, body: init.body, init });
    return bh.graph();
  }
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

/** The plain-text message variant — the default for every existing test. */
const textMessage = (text = MESSAGE) => ({ type: "text", text });

/** The one greeting this commit supports, exactly as specified. */
const GREETING = "Hi! Welcome to The Third Place 👋\nHow can we help you today?";
const ORDER_LINK = "https://atlas.invalid/m#tok_notarealtoken";
const buttonsMessage = (over = {}) => ({
  type: "buttons",
  text: GREETING,
  buttons: [
    { type: "postback", title: "Location", payload: "SHOW_LOCATION" },
    { type: "postback", title: "Opening Hours", payload: "SHOW_OPENING_HOURS" },
    { type: "web_url", title: "Place an Order", url: ORDER_LINK },
  ],
  ...over,
});

const body = (over = {}) => ({
  eventId: EVENT_ID,
  orderNumber: ORDER,
  channel: "instagram",
  externalChatId: CHAT_ID,
  message: textMessage(),
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

for (const bad of [
  // The tag is REQUIRED — an untagged bare string is no longer a message.
  MESSAGE,
  "",
  "   ",
  null,
  7,
  { text: "hi" }, // no type
  { type: "text" }, // no text
  { type: "text", text: "" },
  { type: "text", text: "   " },
  { type: "text", text: "x".repeat(1001) },
  { type: "text", text: 7 },
  { type: "text", text: MESSAGE, extra: "nope" }, // strict
  { type: "html", text: MESSAGE }, // unknown variant
  { type: "text", text: MESSAGE, buttons: [] }, // buttons on a text message
  [{ type: "text", text: MESSAGE }],
]) {
  p = spy();
  out = await send(body({ message: bad }), p.ok);
  assert.equal(out.status, 400, `8. message ${JSON.stringify(bad)?.slice(0, 30)} is rejected`);
  assert.equal(p.calls.length, 0, "8. no provider call on a bad message");
  assert.equal(out.inserts.length, 0, "8. a bad message never claims an eventId");
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
   F. THE REAL META ADAPTER — Messenger only, one call, never retried
   ══════════════════════════════════════════════════════════════════════════ */

const TOKEN = "EAAtest-page-access-token-not-a-real-one";
const MID = "mid.$cAAJsjkOoSExhbCdefGhIjKlMnOp";

/** Runs fn with console captured; returns its value and every logged line. */
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

const token = (value) => {
  if (value === null) delete process.env.META_PAGE_ACCESS_TOKEN;
  else process.env.META_PAGE_ACCESS_TOKEN = value;
};

const input = (over = {}) => ({
  eventId: EVENT_ID,
  orderNumber: ORDER,
  channel: "messenger",
  externalChatId: CHAT_ID,
  message: textMessage(),
  ...over,
});

/** One direct adapter call against an armed Graph response. */
async function graphSend(respond, over = {}) {
  reset({ graph: respond });
  return capture(() => metaProvider.send(input(over)));
}

const graphJson = (status, payload) => () => Response.json(payload, { status });

/* ── F1. Configuration gating (tests 20–21) ──────────────────────────────── */

token(null);
assert.equal(
  metaProvider.isConfigured("messenger"),
  "auth",
  "20. Messenger is unconfigured without a Page token, and says why",
);
token(TOKEN);
assert.equal(
  metaProvider.isConfigured("messenger"),
  true,
  "20. Messenger is configured once the Page token exists",
);

// 21. Instagram is NEVER configured — token or no token. It must not look
//     serviceable, and its class is "other" (unimplemented), not "auth".
for (const value of [TOKEN, null]) {
  token(value);
  assert.equal(
    metaProvider.isConfigured("instagram"),
    "other",
    "21. Instagram never appears configured",
  );
}

/* ── F2. Instagram never reaches the network (test 22) ───────────────────── */

token(TOKEN);
// Armed Graph stub + a direct send: if the adapter called out, bh.graphCalls
// would record it. It must not, even on this bypass path.
let f = await graphSend(graphJson(200, { message_id: MID }), { channel: "instagram" });
assert.deepEqual(
  f.value,
  { ok: false, provider: "meta", messageRef: null, errorClass: "other", status: "needs_review" },
  "22. a direct Instagram send answers needs_review/other",
);
assert.equal(bh.graphCalls.length, 0, "22. Instagram makes no Graph API call");

// Through the endpoint with the REAL provider: refused before the claim, so no
// eventId is consumed and it stays replayable when Instagram lands.
reset({ graph: graphJson(200, { message_id: MID }) });
let r = await capture(() => handleSendChatMessage(req(body({ channel: "instagram" })), metaProvider));
assert.equal(r.value.status, 503, "22. the endpoint refuses Instagram");
assert.deepEqual(await r.value.json(), {
  ok: false,
  provider: "meta",
  messageRef: null,
  errorClass: "other",
  status: "needs_review",
});
assert.equal(bh.graphCalls.length, 0, "22. no Graph call for Instagram");
assert.equal(bh.inserts.length, 0, "22. Instagram consumes no eventId");
assert.equal(bh.patches.length, 0, "22. Instagram writes nothing");

// Same for Messenger with no token: refused before the claim, class "auth".
token(null);
reset({ graph: graphJson(200, { message_id: MID }) });
r = await capture(() => handleSendChatMessage(req(body({ channel: "messenger" })), metaProvider));
assert.equal(r.value.status, 503, "22. an unset Page token refuses the send");
assert.equal((await r.value.json()).errorClass, "auth", "22. and reports it as auth");
assert.equal(bh.graphCalls.length, 0, "22. no Graph call without a token");
assert.equal(bh.inserts.length, 0, "22. no token consumes no eventId");

/* ── F3. The exact Graph request (test 23) ───────────────────────────────── */

token(TOKEN);
f = await graphSend(graphJson(200, { recipient_id: CHAT_ID, message_id: MID }));
assert.equal(bh.graphCalls.length, 1, "23. exactly one Graph request");
const call = bh.graphCalls[0];

assert.equal(call.method, "POST", "23. the Send API is a POST");
assert.match(__test.GRAPH_API_VERSION, /^v\d+\.\d+$/, "23. the API version is pinned and dated");
assert.equal(
  call.url,
  `https://graph.facebook.com/${__test.GRAPH_API_VERSION}/me/messages`,
  "23. the URL is the pinned-version /me/messages endpoint",
);
assert.equal(call.url, __test.GRAPH_SEND_URL, "23. and it is the module's one constant");
assert.deepEqual(
  Object.keys(call.headers).sort(),
  ["Authorization", "Content-Type"],
  "23. exactly two headers — no token in a query parameter, no extras",
);
assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`, "23. bearer auth");
assert.equal(call.headers["Content-Type"], "application/json", "23. JSON content type");
assert.ok(!call.url.includes(TOKEN), "23. the token is never in the URL");
assert.deepEqual(
  JSON.parse(call.body),
  {
    recipient: { id: CHAT_ID },
    messaging_type: "RESPONSE",
    message: { text: MESSAGE },
  },
  "23. the body is exactly the agreed Send API shape",
);
assert.ok(call.init.signal, "23. the request carries an abort signal");
assert.equal(__test.SEND_TIMEOUT_MS, 10_000, "23. the send timeout is 10000 ms");

/* ── F4. Success requires a real message id (tests 24–25) ────────────────── */

assert.deepEqual(
  f.value,
  { ok: true, provider: "meta", messageRef: MID, errorClass: null, status: "sent" },
  "24. a 2xx with a message id is a send, and carries the mid as messageRef",
);

// 25. AMBIGUOUS 2xx — no id, empty id, wrong type, or a body that is not JSON.
//     Meta may or may not have delivered it, so it is needs_review, never a
//     success and never a resend.
for (const [respond, why] of [
  [graphJson(200, {}), "no message_id"],
  [graphJson(200, { message_id: "" }), "an empty message_id"],
  [graphJson(200, { message_id: 12345 }), "a non-string message_id"],
  [graphJson(200, { message_id: null }), "a null message_id"],
  [graphJson(200, { recipient_id: CHAT_ID }), "only a recipient_id"],
  [() => new Response("<html>not json</html>", { status: 200 }), "a non-JSON 2xx body"],
  [() => new Response(null, { status: 204 }), "an empty 2xx body"],
]) {
  f = await graphSend(respond);
  assert.deepEqual(
    f.value,
    { ok: false, provider: "meta", messageRef: null, errorClass: "other", status: "needs_review" },
    `25. ${why} is ambiguous → needs_review/other`,
  );
  assert.equal(bh.graphCalls.length, 1, `25. ${why} is not retried`);
}

/* ── F5. Every normalized error mapping (test 26) ────────────────────────── */

const MAPPINGS = [
  [429, {}, "rate_limited", "HTTP 429"],
  [403, { error: { code: 4 } }, "rate_limited", "code 4 — app request limit"],
  [403, { error: { code: 32 } }, "rate_limited", "code 32 — page request limit"],
  [400, { error: { code: 613 } }, "rate_limited", "code 613 — API rate limit"],
  [400, { error: { code: 10, error_subcode: 2018278 } }, "outside_window", "24-hour window closed"],
  [400, { error: { code: 100, error_subcode: 2018001 } }, "invalid_recipient", "no matching user"],
  [400, { error: { code: 551 } }, "invalid_recipient", "code 551 — person unavailable"],
  [400, { error: { code: 230 } }, "invalid_recipient", "code 230 — cannot message user"],
  [401, {}, "auth", "HTTP 401"],
  [400, { error: { code: 190 } }, "auth", "code 190 — invalid/expired token"],
  [400, { error: { code: 102 } }, "auth", "code 102 — session expired"],
  [403, { error: { code: 200 } }, "auth", "code 200 — permission error"],
  [403, { error: { code: 10 } }, "auth", "code 10 — no permission for this action"],
  [400, { error: { code: 10, error_subcode: 2018065 } }, "auth", "dev mode — testers only"],
  [500, {}, "other", "HTTP 500 with no code"],
  [503, {}, "other", "HTTP 503 with no code"],
  [400, { error: { code: 999_999 } }, "other", "an unknown code is never guessed"],
  [400, { error: { code: 100 } }, "other", "a bare code 100 is not assumed to be a recipient error"],
  [400, {}, "other", "a 4xx with no error object at all"],
];

for (const [status, payload, expected, why] of MAPPINGS) {
  f = await graphSend(graphJson(status, payload));
  assert.deepEqual(
    f.value,
    {
      ok: false,
      provider: "meta",
      messageRef: null,
      errorClass: expected,
      status: "needs_review",
    },
    `26. ${why} → ${expected}`,
  );
  assert.equal(bh.graphCalls.length, 1, `26. ${why} is attempted exactly once — no retry`);
}

// The classifier is also exercised directly, so the ordering rules that only
// matter for overlapping codes are pinned independently of any HTTP status.
assert.equal(
  __test.classifyGraphError(400, 10, 2018278),
  "outside_window",
  "26. the window subcode wins over the generic code-10 permission mapping",
);
assert.equal(__test.classifyGraphError(403, 4, null), "rate_limited", "26. throttling wins over 403");
assert.equal(__test.classifyGraphError(200, null, null), "other", "26. nothing recognised → other");

// A non-JSON ERROR body still maps by HTTP status alone, never by guessing.
f = await graphSend(() => new Response("Bad Gateway", { status: 502 }));
assert.equal(f.value.errorClass, "other", "26. a malformed error body maps to other");
f = await graphSend(() => new Response("Unauthorized", { status: 401 }));
assert.equal(f.value.errorClass, "auth", "26. an unparseable 401 is still auth");

/* ── F6. Timeout and transport failure (test 27) ─────────────────────────── */

for (const [thrown, why] of [
  [Object.assign(new Error("timed out"), { name: "TimeoutError" }), "a 10 s timeout"],
  [Object.assign(new Error("aborted"), { name: "AbortError" }), "an abort"],
  [new TypeError(`fetch failed to ${CHAT_ID}`), "a transport failure"],
]) {
  f = await graphSend(() => {
    throw thrown;
  });
  assert.deepEqual(
    f.value,
    { ok: false, provider: "meta", messageRef: null, errorClass: "other", status: "needs_review" },
    `27. ${why} → needs_review/other`,
  );
  assert.equal(bh.graphCalls.length, 1, `27. ${why} is NEVER retried`);
  for (const line of f.logs) {
    assert.ok(!line.includes("timed out"), "27. a thrown error message is not logged");
    assert.ok(!line.includes(CHAT_ID), "27. a thrown error's chat id is not logged");
  }
}

/* ── F7. A claimed-elsewhere event never reaches Meta (test 28) ──────────── */

token(TOKEN);
for (const existing of [
  { state: "sent", message_ref: MID },
  { state: "processing" },
  { state: "needs_review", error_class: "rate_limited" },
]) {
  reset({ claim: "conflict", existing, graph: graphJson(200, { message_id: MID }) });
  r = await capture(() => handleSendChatMessage(req(body({ channel: "messenger" })), metaProvider));
  assert.equal(r.value.status, 200, `28. a ${existing.state} duplicate answers from the row`);
  assert.equal(
    bh.graphCalls.length,
    0,
    `28. a ${existing.state} duplicate makes NO Graph API call — the claim is gone`,
  );
  assert.equal(bh.patches.length, 0, `28. a ${existing.state} duplicate writes nothing`);
}

// An unavailable claim store also never sends: nothing was claimed, so nothing
// may go out, and the eventId stays free.
reset({ claim: "error", graph: graphJson(200, { message_id: MID }) });
r = await capture(() => handleSendChatMessage(req(body({ channel: "messenger" })), metaProvider));
assert.equal(r.value.status, 503, "28. an unavailable claim store answers 503");
assert.equal(bh.graphCalls.length, 0, "28. and never calls Meta");

/* ── F8. Ambiguous completion stays safe (test 29) ───────────────────────── */

// The send SUCCEEDED but the completion write failed. The customer has the
// message, so the row must stay `processing` (every later duplicate reads
// in_progress and nothing is ever resent) and the caller must be told
// needs_review rather than "sent".
reset({ complete: "error", graph: graphJson(200, { message_id: MID }) });
r = await capture(() => handleSendChatMessage(req(body({ channel: "messenger" })), metaProvider));
assert.equal(bh.graphCalls.length, 1, "29. the send happened exactly once");
assert.deepEqual(await r.value.json(), {
  ok: false,
  provider: "meta",
  messageRef: null,
  errorClass: "other",
  status: "needs_review",
});
assert.equal(bh.patches.length, 1, "29. one completion attempt, not retried");

/* ── F9. Nothing sensitive is logged or persisted (test 30) ──────────────── */

token(TOKEN);
const adapterLogs = [];
let persisted = [];
for (const [respond, state] of [
  [graphJson(200, { message_id: MID }), {}],
  [graphJson(200, {}), {}],
  [graphJson(401, { error: { code: 190, message: `Invalid OAuth token ${TOKEN}` } }), {}],
  [
    graphJson(400, {
      error: {
        code: 10,
        error_subcode: 2018278,
        message: `This message is sent outside of allowed window to ${CHAT_ID}: "${MESSAGE}"`,
        fbtrace_id: "AbCdEfGhIjK",
      },
    }),
    {},
  ],
  [graphJson(429, { error: { code: 4, message: MESSAGE } }), {}],
  [
    () => {
      throw new TypeError(`connect ECONNREFUSED graph.facebook.com ${TOKEN}`);
    },
    {},
  ],
  [() => new Response(`<html>${MESSAGE}</html>`, { status: 500 }), {}],
]) {
  const direct = await graphSend(respond);
  adapterLogs.push(...direct.logs);
  // …and again through the whole endpoint, so handler logs and the persisted
  // row are covered by the same assertions.
  reset({ ...state, graph: respond });
  const viaEndpoint = await capture(() =>
    handleSendChatMessage(req(body({ channel: "messenger" })), metaProvider),
  );
  adapterLogs.push(...viaEndpoint.logs);
  persisted = persisted.concat(bh.inserts, bh.patches);
}

assert.ok(adapterLogs.length > 0, "30. the adapter does log something");
for (const line of adapterLogs) {
  assert.ok(!line.includes(TOKEN), "30. NO log line may contain the Page access token");
  assert.ok(!line.includes("Bearer"), "30. NO log line may contain the Authorization header");
  assert.ok(!line.includes(CHAT_ID), "30. NO log line may contain the raw recipient id");
  assert.ok(!line.includes(MESSAGE), "30. NO log line may contain the message text");
  assert.ok(!line.includes("fbtrace"), "30. NO log line may contain the Graph error body");
  assert.ok(!line.includes("Invalid OAuth"), "30. NO log line may contain a Graph error message");
  assert.ok(!line.includes("ECONNREFUSED"), "30. NO log line may contain a transport error message");
  assert.ok(!line.includes("<html>"), "30. NO log line may contain a raw response body");
}

const adapterRows = JSON.stringify(persisted);
assert.ok(persisted.length > 0, "30. rows were written on these paths");
assert.ok(!adapterRows.includes(TOKEN), "30. the Page token is never persisted");
assert.ok(!adapterRows.includes(CHAT_ID), "30. the raw chat id is never persisted — only chat_ref");
assert.ok(!adapterRows.includes(MESSAGE), "30. the message text is never persisted");
assert.ok(
  adapterRows.includes(__test.chatRef("messenger", CHAT_ID, SECRET)),
  "30. the keyed chat_ref is what correlates the row instead",
);

/* ── F10. The bound route uses the real adapter, and no real network ─────── */

token(null);
reset();
r = await capture(() => postSendChatMessage(req(body({ channel: "messenger" }))));
assert.equal(r.value.status, 503, "31. the bound route refuses without a Page token");
assert.equal((await r.value.json()).errorClass, "auth", "31. and reports auth");
assert.equal(bh.inserts.length, 0, "31. consuming no eventId");

// Every Graph call in this file went through the stub above: it is the only
// implementation of globalThis.fetch, it records each call, and it throws on
// any target that is not an ARMED Graph URL or the Supabase table. Proven, not
// asserted by comment — with nothing armed, a Graph call is impossible, so no
// socket was ever opened and no message was ever sent.
reset();
await assert.rejects(
  () => globalThis.fetch(`${__test.GRAPH_SEND_URL}`, { method: "POST" }),
  /unexpected Graph API call/,
  "32. an unarmed Graph API call cannot reach the network",
);
await assert.rejects(
  () => globalThis.fetch("https://graph.facebook.com/v1.0/me/messages", { method: "POST" }),
  /unexpected Graph API call/,
  "32. no Graph version can slip past the stub",
);
token(null);

/* ══════════════════════════════════════════════════════════════════════════
   G. THE BUTTON TEMPLATE — the one greeting, transported and nothing more
   ══════════════════════════════════════════════════════════════════════════ */

/* ── G1. The exact Graph body (test 33) ─────────────────────────────────── */

token(TOKEN);
f = await graphSend(graphJson(200, { message_id: MID }), { message: buttonsMessage() });
assert.equal(bh.graphCalls.length, 1, "33. exactly one Graph request for a button template");
assert.deepEqual(
  JSON.parse(bh.graphCalls[0].body),
  {
    recipient: { id: CHAT_ID },
    messaging_type: "RESPONSE",
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: GREETING,
          buttons: [
            { type: "postback", title: "Location", payload: "SHOW_LOCATION" },
            { type: "postback", title: "Opening Hours", payload: "SHOW_OPENING_HOURS" },
            { type: "web_url", title: "Place an Order", url: ORDER_LINK },
          ],
        },
      },
    },
  },
  "33. the button template is Meta's exact shape, buttons in caller order",
);
assert.deepEqual(
  f.value,
  { ok: true, provider: "meta", messageRef: MID, errorClass: null, status: "sent" },
  "33. a button send resolves through the same normalized contract",
);

// The text variant is untouched by any of this — same builder, same envelope.
assert.deepEqual(
  __test.graphMessage({ type: "text", text: MESSAGE }),
  { text: MESSAGE },
  "33. a text message is still a plain { text } message",
);

/* ── G2. The endpoint accepts the greeting end to end (test 34) ──────────── */

reset({ graph: graphJson(200, { message_id: MID }) });
r = await capture(() =>
  handleSendChatMessage(
    req(body({ channel: "messenger", message: buttonsMessage() })),
    metaProvider,
  ),
);
assert.equal(r.value.status, 200, "34. the greeting is accepted end to end");
assert.deepEqual(await r.value.json(), {
  ok: true,
  provider: "meta",
  messageRef: MID,
  errorClass: null,
  status: "sent",
});
assert.equal(bh.inserts.length, 1, "34. one atomic claim, exactly as for text");
assert.equal(bh.patches.length, 1, "34. one terminal write");
assert.equal(bh.graphCalls.length, 1, "34. one Graph call — no retry");

/* ── G3. The button-array bounds (test 35) ──────────────────────────────── */

const oneButton = { type: "postback", title: "Location", payload: "SHOW_LOCATION" };

for (const count of [1, 2, 3]) {
  reset({ graph: graphJson(200, { message_id: MID }) });
  out = await send(
    body({ channel: "messenger", message: buttonsMessage({ buttons: Array(count).fill(oneButton) }) }),
    { isConfigured: () => true, send: async () => ({ ok: true, provider: "meta", messageRef: MID, errorClass: null, status: "sent" }) },
  );
  assert.equal(out.status, 200, `35. ${count} button(s) is accepted`);
}

for (const buttons of [[], Array(4).fill(oneButton), Array(10).fill(oneButton)]) {
  p = spy();
  out = await send(body({ channel: "messenger", message: buttonsMessage({ buttons }) }), p.ok);
  assert.equal(out.status, 400, `35. ${buttons.length} buttons is rejected`);
  assert.equal(p.calls.length, 0, `35. ${buttons.length} buttons never reaches the provider`);
  assert.equal(out.inserts.length, 0, `35. ${buttons.length} buttons never claims an eventId`);
}
assert.equal(__test.MAX_BUTTONS, 3, "35. the cap is Meta's own limit of 3");

/* ── G4. Title, payload and URL validation (test 36) ─────────────────────── */

const rejects = async (buttons, why) => {
  p = spy();
  out = await send(
    body({ channel: "messenger", message: buttonsMessage({ buttons: [buttons] }) }),
    p.ok,
  );
  assert.equal(out.status, 400, `36. ${why} is rejected`);
  assert.equal(p.calls.length, 0, `36. ${why} never reaches the provider`);
  assert.equal(out.inserts.length, 0, `36. ${why} never claims an eventId`);
};

// Titles — 1..20, non-blank, string.
await rejects({ type: "postback", title: "", payload: "OK" }, "an empty title");
await rejects({ type: "postback", title: "   ", payload: "OK" }, "a blank title");
await rejects({ type: "postback", title: "x".repeat(21), payload: "OK" }, "a 21-character title");
await rejects({ type: "postback", title: 7, payload: "OK" }, "a numeric title");
await rejects({ type: "postback", payload: "OK" }, "a missing title");

// Postback payloads — the closed uppercase vocabulary.
for (const payload of [
  "",
  "lowercase",
  "Mixed_Case",
  "HAS SPACE",
  "HAS-DASH",
  "HAS.DOT",
  "HTTPS://EVIL.INVALID",
  "A".repeat(101),
  7,
  null,
]) {
  await rejects(
    { type: "postback", title: "Location", payload },
    `payload ${JSON.stringify(payload)}`,
  );
}

// URLs — HTTPS only, bounded, and a real URL.
for (const url of [
  "http://insecure.invalid/order",
  "HTTPS://Upper.invalid/order",
  "javascript:alert(1)",
  "data:text/html,<script>",
  "ftp://files.invalid/x",
  "//protocol-relative.invalid",
  "not a url",
  "",
  `https://atlas.invalid/${"x".repeat(2001)}`,
  7,
  null,
]) {
  await rejects({ type: "web_url", title: "Place an Order", url }, `url ${JSON.stringify(url)}`);
}

// The two button shapes do not bleed into each other, and neither takes extras.
await rejects({ type: "postback", title: "Location", url: ORDER_LINK }, "a postback with a url");
await rejects({ type: "web_url", title: "Order", payload: "SHOW_MENU" }, "a web_url with a payload");
await rejects(
  { type: "postback", title: "Location", payload: "SHOW_LOCATION", extra: "nope" },
  "a postback with an extra key",
);
await rejects(
  { type: "web_url", title: "Order", url: ORDER_LINK, extra: "nope" },
  "a web_url with an extra key",
);
await rejects({ type: "phone_number", title: "Call", payload: "+1" }, "an unsupported button type");
await rejects({ title: "Location", payload: "SHOW_LOCATION" }, "a button with no type");
await rejects("SHOW_LOCATION", "a bare string button");

// The buttons message itself is strict too.
for (const message of [
  { type: "buttons", buttons: [oneButton] }, // no text
  { type: "buttons", text: "", buttons: [oneButton] },
  { type: "buttons", text: "   ", buttons: [oneButton] },
  { type: "buttons", text: "x".repeat(641), buttons: [oneButton] },
  { type: "buttons", text: GREETING }, // no buttons
  { type: "buttons", text: GREETING, buttons: oneButton }, // not an array
  { type: "buttons", text: GREETING, buttons: [oneButton], extra: "nope" },
]) {
  p = spy();
  out = await send(body({ channel: "messenger", message }), p.ok);
  assert.equal(out.status, 400, `36. ${JSON.stringify(message).slice(0, 40)} is rejected`);
  assert.equal(p.calls.length, 0, "36. a malformed buttons message never reaches the provider");
}
assert.equal(__test.MAX_BUTTON_TEXT_CHARS, 640, "36. the text cap is Meta's template limit");
assert.equal(__test.MAX_BUTTON_TITLE_CHARS, 20, "36. the title cap is Meta's limit");
assert.equal(__test.POSTBACK_PAYLOAD_PATTERN.test("SHOW_LOCATION"), true);
assert.equal(__test.POSTBACK_PAYLOAD_PATTERN.test("SHOW_OPENING_HOURS"), true);

/* ── G5. Buttons are Messenger-only, and Instagram never sends (test 37) ─── */

p = spy();
out = await send(body({ channel: "instagram", message: buttonsMessage() }), p.ok);
assert.equal(out.status, 400, "37. a buttons message on Instagram is a contract error");
assert.equal(p.calls.length, 0, "37. it never reaches the provider");
assert.equal(out.inserts.length, 0, "37. and never claims an eventId");

// …and with the REAL provider it cannot reach Meta either, by two independent
// gates: the schema above, and isConfigured refusing Instagram before the claim.
token(TOKEN);
reset({ graph: graphJson(200, { message_id: MID }) });
r = await capture(() =>
  handleSendChatMessage(req(body({ channel: "instagram", message: buttonsMessage() })), metaProvider),
);
assert.equal(bh.graphCalls.length, 0, "37. Instagram makes no Graph call with buttons either");
assert.equal(bh.inserts.length, 0, "37. and consumes no eventId");
assert.equal(metaProvider.isConfigured("instagram"), "other", "37. Instagram is still unconfigured");

/* ── G6. A claimed-elsewhere button send never reaches Meta (test 38) ────── */

for (const existing of [{ state: "sent", message_ref: MID }, { state: "processing" }]) {
  reset({ claim: "conflict", existing, graph: graphJson(200, { message_id: MID }) });
  r = await capture(() =>
    handleSendChatMessage(
      req(body({ channel: "messenger", message: buttonsMessage() })),
      metaProvider,
    ),
  );
  assert.equal(r.value.status, 200, `38. a ${existing.state} duplicate answers from the row`);
  assert.equal(bh.graphCalls.length, 0, `38. a ${existing.state} duplicate makes NO Graph call`);
  assert.equal(bh.patches.length, 0, `38. a ${existing.state} duplicate writes nothing`);
}

/* ── G7. Nothing from a button leaks to a log or a row (test 39) ─────────── */

const BUTTON_SECRETS = [
  GREETING,
  "Hi! Welcome to The Third Place",
  ORDER_LINK,
  "tok_notarealtoken",
  "SHOW_LOCATION",
  "SHOW_OPENING_HOURS",
  "Place an Order",
  "Opening Hours",
  CHAT_ID,
  TOKEN,
];

const buttonLogs = [];
let buttonRows = [];
for (const respond of [
  graphJson(200, { message_id: MID }),
  graphJson(200, {}),
  graphJson(400, {
    error: {
      code: 10,
      error_subcode: 2018278,
      message: `Outside window sending "${GREETING}" with ${ORDER_LINK} to ${CHAT_ID}`,
    },
  }),
  graphJson(429, { error: { code: 4, message: `SHOW_LOCATION ${ORDER_LINK}` } }),
  () => {
    throw new TypeError(`connect ECONNREFUSED ${ORDER_LINK} ${TOKEN}`);
  },
  () => new Response(`<html>${GREETING}</html>`, { status: 500 }),
]) {
  buttonLogs.push(...(await graphSend(respond, { message: buttonsMessage() })).logs);
  reset({ graph: respond });
  buttonLogs.push(
    ...(
      await capture(() =>
        handleSendChatMessage(
          req(body({ channel: "messenger", message: buttonsMessage() })),
          metaProvider,
        ),
      )
    ).logs,
  );
  buttonRows = buttonRows.concat(bh.inserts, bh.patches);
}

assert.ok(buttonLogs.length > 0, "39. the button paths do log something");
for (const line of buttonLogs) {
  for (const secretish of BUTTON_SECRETS) {
    assert.ok(!line.includes(secretish), `39. a log line must not contain "${secretish}": ${line}`);
  }
  assert.ok(!line.includes("template"), "39. no template body fragment is logged");
  assert.ok(!line.includes("<html>"), "39. no raw response body is logged");
  assert.ok(!line.includes("ECONNREFUSED"), "39. no transport error message is logged");
}

const buttonWritten = JSON.stringify(buttonRows);
assert.ok(buttonRows.length > 0, "39. rows were written on these paths");
for (const secretish of BUTTON_SECRETS) {
  assert.ok(!buttonWritten.includes(secretish), `39. "${secretish}" is never persisted`);
}
assert.ok(
  buttonWritten.includes(__test.chatRef("messenger", CHAT_ID, SECRET)),
  "39. the keyed chat_ref is still what correlates the row",
);

// Nothing in this module interprets a payload — it only transports it.
assert.ok(
  !readFileSync("api/_lib/chatMessaging.server.ts", "utf8").includes("SHOW_LOCATION"),
  "39. no button payload is hard-coded in the module — the caller composes them",
);

token(null);
reset();

console.log("test-chat-messaging: all assertions passed");
