// App-owned Meta Messenger callback check (no test framework — run with
// `npm run test:meta-messenger-webhook`). Compiles
// api/_lib/metaMessengerWebhook.server.ts and stubs the network to assert:
//   - ONE URL answers both Meta verbs: GET echoes hub.challenge as raw plain
//     text, POST accepts signed page events;
//   - every GET refusal (wrong token, wrong mode, unset token) is the same 403;
//   - the body signature is REQUIRED and verified over the raw bytes — missing,
//     malformed, invalid, and an unset META_APP_SECRET all fail closed;
//   - invalid JSON and any object other than "page" are refused;
//   - the four event categories are counted across multiple entries;
//   - the forward carries ONLY the approved sanitized keys: structure, plus
//     the sender PSID as externalChatId (the one identifier a reply needs,
//     validated against EXTERNAL_CHAT_ID_PATTERN and null when it fails), the
//     first valid image attachment as { type, url } on a message event, and an
//     ALLOWLISTED Atlas action as `action` — never message text, a Page ID, a
//     non-image attachment, an unlisted payload, a mid, or any raw array;
//   - a postback payload and a quick-reply payload resolve through the SAME
//     closed allowlist, and an event's action and attachment are disjoint, so
//     a payment slip can never take the same branch as the welcome;
//   - forwarding is skipped with no external request when the URL is unset, and
//     a forward that fails, 500s, or times out still leaves Meta its 200;
//   - no request ever reaches the Graph API and no customer message is sent;
//   - no log line anywhere carries a secret, an identifier, or message content.
// No network, no real secrets, no Meta, no Supabase.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/meta-messenger-webhook-test";
execSync(
  `npx tsc api/_lib/metaMessengerWebhook.server.ts --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const { getMetaMessengerWebhook, postMetaMessengerWebhook, __test } = await import(
  pathToFileURL(path.resolve(outDir, "metaMessengerWebhook.server.js")).href
);

const URL_BASE = "https://app.invalid/api/automation/meta-messenger-webhook";
const VERIFY_TOKEN = "atlas-verify-token-not-a-real-one";
const APP_SECRET = "atlas-app-secret-not-a-real-one";
const HOOK = "https://n8n.invalid/webhook/atlas-messenger-events-test";
const CHALLENGE = "1158201444";

// The customer data that must NEVER appear in a log line or a forwarded body.
const PSID = "24681357911131517";
const PAGE_ID = "987654321098765";
const TEXT = "Hi, here is my payment slip for TP-MS-000042";
const MID = "m_AaBbCcDdEeFf0011223344";
const ATTACHMENT_URL = "https://cdn.invalid/slip-with-account-number.jpg";
const SENSITIVE = [PSID, PAGE_ID, TEXT, MID, ATTACHMENT_URL, VERIFY_TOKEN, APP_SECRET, HOOK];

/* ── Stubbed network — the ONLY legal target is the configured n8n hook ──── */

let bh;
function reset(over = {}) {
  bh = { hookBehavior: "ok", calls: [], ...over };
}
reset();

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  // Proves the negative directly: nothing in this module may reach Meta.
  assert.ok(
    !/facebook\.com|graph\.|instagram\.com|m\.me|ig\.me/i.test(u),
    `no Graph API / messaging call is permitted, got ${u}`,
  );
  assert.equal(u, HOOK, `the only legal fetch target is the n8n hook, got ${u}`);
  bh.calls.push({ url: u, method: init.method, headers: init.headers, body: init.body });
  if (bh.hookBehavior === "reject") throw new TypeError(`connect ECONNREFUSED ${HOOK}`);
  if (bh.hookBehavior === "timeout") {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    throw error;
  }
  if (bh.hookBehavior === "http500") return new Response("boom", { status: 500 });
  return new Response(null, { status: 200 });
};

/* ── Environment (set per test, never read at module scope) ──────────────── */

function env({ verify = VERIFY_TOKEN, secret = APP_SECRET, hook = null } = {}) {
  for (const [key, value] of [
    ["META_MESSENGER_VERIFY_TOKEN", verify],
    ["META_APP_SECRET", secret],
    ["N8N_MESSENGER_EVENTS_WEBHOOK_URL", hook],
  ]) {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
}
env();

/* ── Request helpers ─────────────────────────────────────────────────────── */

const sign = (raw, secret = APP_SECRET) =>
  `sha256=${createHmac("sha256", secret).update(Buffer.from(raw, "utf8")).digest("hex")}`;

/** Runs one handler with captured logs; settles any detached waitUntil work. */
async function run(handler, request) {
  const logs = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a) => logs.push(a.join(" "));
  console.error = (...a) => logs.push(a.join(" "));
  let response;
  try {
    response = await handler(request);
    // waitUntil no-ops off Vercel — give the detached forward a tick to settle.
    await new Promise((r) => setTimeout(r, 40));
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  const text = await response.text();
  return {
    status: response.status,
    text,
    contentType: response.headers.get("Content-Type"),
    logs,
    calls: bh.calls,
  };
}

const verify = (query) =>
  run(getMetaMessengerWebhook, new Request(`${URL_BASE}?${new URLSearchParams(query)}`));

async function deliver(raw, { signature = "auto", state = {} } = {}) {
  reset(state);
  const body = typeof raw === "string" ? raw : JSON.stringify(raw);
  const headers = { "Content-Type": "application/json" };
  const value = signature === "auto" ? sign(body) : signature;
  if (value !== null) headers["x-hub-signature-256"] = value;
  return run(postMetaMessengerWebhook, new Request(URL_BASE, { method: "POST", headers, body }));
}

/* ── Payload builders ────────────────────────────────────────────────────── */

const wrap = (...messaging) => ({
  object: "page",
  entry: [{ id: PAGE_ID, time: 1_754_300_000_000, messaging }],
});

const envelope = (extra, timestamp = 1_754_300_000_001) => ({
  sender: { id: PSID },
  recipient: { id: PAGE_ID },
  timestamp,
  ...extra,
});

const messageEvent = envelope({
  message: {
    mid: MID,
    text: TEXT,
    attachments: [{ type: "image", payload: { url: ATTACHMENT_URL } }],
  },
});
const postbackEvent = envelope({ postback: { mid: MID, title: TEXT, payload: "ORDER_START" } });
const deliveryEvent = envelope({ delivery: { mids: [MID], watermark: 1_754_299_999_000 } });
const readEvent = envelope({ read: { watermark: 1_754_299_999_500 } });

/* ══════════════════════════════════════════════════════════════════════════
   A. GET — the verification handshake (tests 1–6)
   ══════════════════════════════════════════════════════════════════════════ */

env();
let out = await verify({
  "hub.mode": "subscribe",
  "hub.verify_token": VERIFY_TOKEN,
  "hub.challenge": CHALLENGE,
});
assert.equal(out.status, 200, "1. a valid verification is accepted");
assert.equal(out.text, CHALLENGE, "1. the raw challenge is echoed verbatim");
assert.equal(out.calls.length, 0, "1. verification makes no external request");

// 2. Plain text, NOT JSON — Meta compares the echoed body byte for byte, so a
// quoted "1158201444" would fail the handshake.
assert.match(out.contentType, /^text\/plain/, "2. the challenge is served as plain text");
assert.doesNotMatch(out.contentType, /json/, "2. the challenge is not JSON");
assert.notEqual(out.text, JSON.stringify(CHALLENGE), "2. the challenge is not JSON-quoted");
assert.notEqual(out.text, JSON.stringify({ challenge: CHALLENGE }), "2. nor JSON-wrapped");
assert.equal(out.text.length, CHALLENGE.length, "2. the body is the challenge and nothing else");

out = await verify({
  "hub.mode": "subscribe",
  "hub.verify_token": "atlas-verify-token-not-the-real-onx", // same length, wrong bytes
  "hub.challenge": CHALLENGE,
});
assert.equal(out.status, 403, "3. a wrong verify token is refused");
assert.ok(!out.text.includes(CHALLENGE), "3. a refusal never echoes the challenge");

out = await verify({
  "hub.mode": "unsubscribe",
  "hub.verify_token": VERIFY_TOKEN,
  "hub.challenge": CHALLENGE,
});
assert.equal(out.status, 403, "4. a wrong hub.mode is refused even with the right token");

env({ verify: null });
out = await verify({
  "hub.mode": "subscribe",
  "hub.verify_token": VERIFY_TOKEN,
  "hub.challenge": CHALLENGE,
});
assert.equal(out.status, 403, "5. an unset verify token fails closed");
assert.ok(!out.text.includes(CHALLENGE), "5. nothing is echoed when unconfigured");

env();
out = await verify({ "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN });
assert.equal(out.status, 403, "6. a verification with no challenge is refused");

// Every refusal is the SAME generic body — it never says which check failed.
const refusals = [
  await verify({ "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": CHALLENGE }),
  await verify({ "hub.mode": "unsubscribe", "hub.verify_token": VERIFY_TOKEN }),
];
assert.equal(new Set(refusals.map((r) => r.text)).size, 1, "6. one generic refusal body");

/* ══════════════════════════════════════════════════════════════════════════
   B. POST — signature verification (tests 7–11)
   ══════════════════════════════════════════════════════════════════════════ */

env({ hook: HOOK });
out = await deliver(wrap(messageEvent));
assert.equal(out.status, 200, "7. a valid signed page event is accepted");

out = await deliver(wrap(messageEvent), { signature: null });
assert.equal(out.status, 403, "8. a missing signature is rejected");
assert.equal(out.calls.length, 0, "8. an unsigned body is never forwarded");

for (const malformed of [
  "not-a-signature",
  "sha1=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "sha256=tooshort",
  "sha256=NOTHEXNOTHEXNOTHEXNOTHEXNOTHEXNOTHEXNOTHEXNOTHEXNOTHEXNOTHEXNOTH",
  "sha256=",
  "",
]) {
  out = await deliver(wrap(messageEvent), { signature: malformed });
  assert.equal(out.status, 403, `9. a malformed signature is rejected: ${malformed || "(empty)"}`);
  assert.equal(out.calls.length, 0, "9. a malformed signature never forwards");
}

// Correct shape, wrong key — and the same body signed over a MUTATED payload,
// which is the attack the signature actually exists to stop.
out = await deliver(wrap(messageEvent), {
  signature: sign(JSON.stringify(wrap(messageEvent)), "wrong-key"),
});
assert.equal(out.status, 403, "10. a signature from the wrong key is rejected");
assert.equal(out.calls.length, 0, "10. an invalid signature never forwards");

const tampered = JSON.stringify(wrap(messageEvent, postbackEvent));
out = await run(
  postMetaMessengerWebhook,
  new Request(URL_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Signed over a DIFFERENT body than the one sent.
      "x-hub-signature-256": sign(JSON.stringify(wrap(messageEvent))),
    },
    body: tampered,
  }),
);
assert.equal(out.status, 403, "10b. a body that does not match its signature is rejected");

env({ secret: null, hook: HOOK });
out = await deliver(wrap(messageEvent), { signature: sign(JSON.stringify(wrap(messageEvent))) });
assert.notEqual(out.status, 200, "11. an unset META_APP_SECRET fails closed");
assert.equal(out.status, 500, "11. an unset app secret is a server misconfiguration");
assert.equal(out.calls.length, 0, "11. nothing is forwarded without an app secret");

/* ══════════════════════════════════════════════════════════════════════════
   C. POST — body contract (tests 12–13)
   ══════════════════════════════════════════════════════════════════════════ */

env({ hook: HOOK });
out = await deliver(`{"object":"page","entry":[`);
assert.equal(out.status, 400, "12. an invalid JSON body is rejected");
assert.equal(out.calls.length, 0, "12. invalid JSON never forwards");

for (const unsupported of [
  { object: "instagram", entry: [] },
  { object: "user", entry: [] },
  { object: "whatsapp_business_account", entry: [] },
  { entry: [] },
  { object: "page ", entry: [] },
  [],
  "page",
  null,
  42,
]) {
  out = await deliver(unsupported);
  assert.equal(
    out.status,
    400,
    `13. an unsupported object is rejected: ${JSON.stringify(unsupported)}`,
  );
  assert.equal(out.calls.length, 0, "13. an unsupported object never forwards");
}

/* ══════════════════════════════════════════════════════════════════════════
   D. Sanitization — categories, counts, and what may leave (tests 14–19)
   ══════════════════════════════════════════════════════════════════════════ */

/** The forwarded body, parsed. */
const forwarded = (result) => {
  assert.equal(result.calls.length, 1, "exactly one forward per accepted event");
  return JSON.parse(result.calls[0].body);
};

const APPROVED_KEYS = [
  "entryCount",
  "eventId",
  "events",
  "messagingEventCount",
  "object",
  "receivedAt",
];

for (const [event, category, attachment, action] of [
  [messageEvent, "message", { type: "image", url: ATTACHMENT_URL }, null],
  [postbackEvent, "postback", null, "ORDER_START"],
  [deliveryEvent, "delivery", null, null],
  [readEvent, "read", null, null],
  [envelope({ optin: { ref: "x" } }), "other", null, null],
]) {
  out = await deliver(wrap(event));
  assert.equal(out.status, 200, `14. a ${category} event is accepted`);
  const sent = forwarded(out);
  assert.equal(sent.messagingEventCount, 1, `14. one ${category} event counted`);
  assert.deepEqual(
    sent.events,
    [{ category, timestamp: event.timestamp, externalChatId: PSID, attachment, action }],
    `14. a ${category} event carries its timestamp, sender, image and action`,
  );
}

// 15. A timestamp is carried ONLY when it is a real finite number.
out = await deliver(
  wrap(
    { message: { text: TEXT }, timestamp: "1754300000001" },
    { message: {} },
    {
      message: {},
      timestamp: Number.NaN, // serializes to null
    },
  ),
);
let sent = forwarded(out);
assert.deepEqual(
  sent.events.map((e) => e.timestamp),
  [null, null, null],
  "15. a non-numeric, absent, or non-finite timestamp becomes null",
);
assert.deepEqual(
  sent.events.map((e) => e.externalChatId),
  [null, null, null],
  "15. an event with no sender carries a null externalChatId, never a guess",
);
assert.deepEqual(
  sent.events.map((e) => e.attachment),
  [null, null, null],
  "15. a message with no attachments carries a null attachment",
);
assert.deepEqual(
  sent.events.map((e) => e.action),
  [null, null, null],
  "15. a message that is not a tap carries a null action",
);

// 16. Multiple entries and multiple events per entry are counted correctly.
out = await deliver({
  object: "page",
  entry: [
    { id: PAGE_ID, time: 1, messaging: [messageEvent, postbackEvent] },
    { id: PAGE_ID, time: 2, messaging: [deliveryEvent] },
    { id: PAGE_ID, time: 3, messaging: [readEvent, messageEvent, readEvent] },
    { id: PAGE_ID, time: 4, standby: [messageEvent] }, // no messaging array
    { id: PAGE_ID, time: 5 },
  ],
});
sent = forwarded(out);
assert.equal(sent.entryCount, 5, "16. every entry is counted");
assert.equal(sent.messagingEventCount, 6, "16. every messaging event is counted");
assert.equal(sent.events.length, 6, "16. one categorized record per messaging event");
assert.deepEqual(
  sent.events.map((e) => e.category),
  ["message", "postback", "delivery", "read", "message", "read"],
  "16. categories keep entry and event order",
);

// 17. THE forwarding contract: only the approved keys. Two values travel. The
// sender PSID names the conversation to answer, so without it n8n has an event
// it cannot act on; the first image URL IS the payment proof, so without it
// there is nothing to review. Everything else that could identify a Page or
// carry content stays stripped.
out = await deliver(wrap(messageEvent, postbackEvent));
sent = forwarded(out);
assert.deepEqual(Object.keys(sent).sort(), APPROVED_KEYS, "17. only approved top-level keys");
for (const event of sent.events) {
  assert.deepEqual(
    Object.keys(event).sort(),
    ["action", "attachment", "category", "externalChatId", "timestamp"],
    "17. only approved per-event keys",
  );
  if (event.attachment !== null) {
    assert.deepEqual(
      Object.keys(event.attachment).sort(),
      ["type", "url"],
      "17. an attachment carries type and url and nothing else",
    );
    assert.equal(event.attachment.type, "image", "17. only images are forwarded");
  }
}
assert.equal(sent.object, "page", "17. the object type is carried");
assert.equal(typeof sent.eventId, "string");
assert.match(sent.eventId, /^[0-9a-f]{32}$/, "17. eventId is an opaque hex reference");
assert.ok(!Number.isNaN(Date.parse(sent.receivedAt)), "17. receivedAt is a timestamp");

const wire = out.calls[0].body;
assert.ok(wire.includes(PSID), "17. the sender PSID IS forwarded — a reply needs it");
assert.ok(wire.includes(ATTACHMENT_URL), "17. the image URL IS forwarded — the proof needs it");
// Everything else sensitive is still absent. The PSID and the image URL are
// excluded from this list ON PURPOSE and are the only such exceptions.
for (const secretish of SENSITIVE.filter((s) => s !== HOOK && s !== PSID && s !== ATTACHMENT_URL)) {
  assert.ok(!wire.includes(secretish), `17. the forwarded body must not contain "${secretish}"`);
}
assert.ok(!wire.includes(PAGE_ID), "17. the recipient Page ID is never forwarded");
assert.ok(!wire.includes(TEXT), "17. message text is never forwarded");
// The ALLOWLISTED action IS forwarded — it is the receiver's routing key, and
// it is Atlas vocabulary this app put on the button, not customer content. An
// unlisted payload is still stripped (19d).
assert.ok(wire.includes('"action":"ORDER_START"'), "17. an allowlisted action is forwarded");
for (const key of ["sender", "recipient", "mid", "attachments", "text", "psid", "payload"]) {
  assert.ok(!wire.includes(key), `17. the forwarded body must not contain the key "${key}"`);
}
// Nothing raw survives: the forward is the sanitized object, not a passthrough.
assert.ok(!wire.includes('"entry"'), "17. no raw entry array is forwarded");
assert.ok(!wire.includes('"messaging"'), "17. no raw messaging array is forwarded");
assert.equal(
  wire.length < JSON.stringify(wrap(messageEvent, postbackEvent)).length,
  true,
  "17. the forward is a reduction of the payload, never a copy of it",
);
assert.equal(out.calls[0].method, "POST", "17. the forward is a POST");
assert.equal(
  out.calls[0].headers["x-atlas-event-id"],
  sent.eventId,
  "17. the event id is bound to the header too",
);

// 18. eventId is DERIVED from the body: Meta retries the identical body, so
// n8n can deduplicate. A different body gives a different id.
const first = forwarded(await deliver(wrap(messageEvent))).eventId;
const again = forwarded(await deliver(wrap(messageEvent))).eventId;
const other = forwarded(await deliver(wrap(postbackEvent))).eventId;
assert.equal(first, again, "18. an identical body yields an identical eventId");
assert.notEqual(first, other, "18. a different body yields a different eventId");
// It is domain-separated from the signature Meta sent, never equal to it.
assert.ok(
  !sign(JSON.stringify(wrap(messageEvent))).includes(first),
  "18. eventId is not the request signature",
);

// 18b. The PSID is NOT part of the eventId derivation — that stays an HMAC
// over the raw body digest, so the id remains opaque hex and can carry no
// identifier of its own.
assert.ok(!first.includes(PSID), "18b. eventId cannot contain the sender PSID");
assert.match(first, /^[0-9a-f]{32}$/, "18b. eventId is still opaque hex");

// 19. The sanitizer itself refuses anything that is not a page object.
assert.equal(__test.sanitize({ object: "instagram" }, "id"), null);
assert.equal(__test.sanitize("page", "id"), null);
assert.equal(__test.categorize({ message: {} }), "message");
assert.equal(__test.categorize({ delivery: {} }), "delivery");
assert.equal(__test.categorize({}), "other");

// 19b. The sender id is validated with the repository's EXTERNAL_CHAT_ID_PATTERN
//      — the SAME rule the bot-session route applies — so a chat id refused
//      everywhere else in the app cannot enter through the webhook. Anything
//      that fails becomes null; nothing is ever guessed or coerced.
for (const good of [PSID, "1", "a".repeat(128), "a.b_c-d", "17841400000000001"]) {
  assert.equal(
    __test.senderChatId({ sender: { id: good } }),
    good,
    `19b. a valid sender id is kept: ${good.slice(0, 12)}`,
  );
}

for (const [event, why] of [
  [{}, "no sender at all"],
  [{ sender: null }, "a null sender"],
  [{ sender: "24681357911131517" }, "a string sender"],
  [{ sender: [{ id: PSID }] }, "an array sender"],
  [{ sender: {} }, "a sender with no id"],
  [{ sender: { id: 24_681_357_911_131_517 } }, "a numeric id — never coerced"],
  [{ sender: { id: null } }, "a null id"],
  [{ sender: { id: "" } }, "an empty id"],
  [{ sender: { id: "has space" } }, "an id with a space"],
  [{ sender: { id: "bad/slash" } }, "an id with a slash"],
  [{ sender: { id: "a".repeat(129) } }, "an id one character over the maximum"],
  [{ sender: { id: { toString: () => PSID } } }, "an object pretending to be an id"],
]) {
  assert.equal(__test.senderChatId(event), null, `19b. ${why} yields null`);
}

// It reads sender.id ONLY — never the recipient Page id as a fallback.
assert.equal(
  __test.senderChatId({ recipient: { id: PAGE_ID } }),
  null,
  "19b. the recipient Page ID is never used as a sender fallback",
);
assert.equal(
  __test.senderChatId({ sender: { id: "bad/slash" }, recipient: { id: PAGE_ID } }),
  null,
  "19b. an invalid sender does not fall back to the Page ID either",
);

// End to end: an invalid sender forwards null rather than dropping the event
// or omitting the key, so the event shape stays fixed for n8n.
out = await deliver(
  wrap(
    envelope({ message: { text: TEXT } }),
    { sender: { id: "bad/slash" }, recipient: { id: PAGE_ID }, message: {}, timestamp: 5 },
    { recipient: { id: PAGE_ID }, read: {}, timestamp: 6 },
  ),
);
sent = forwarded(out);
assert.deepEqual(
  sent.events.map((e) => e.externalChatId),
  [PSID, null, null],
  "19b. an invalid or missing sender forwards null, beside a valid one",
);
assert.equal(sent.messagingEventCount, 3, "19b. no event is dropped for a bad sender");
for (const event of sent.events) {
  assert.ok("externalChatId" in event, "19b. the key is always present, even when null");
}
assert.ok(!out.calls[0].body.includes(PAGE_ID), "19b. still no Page ID on the wire");
assert.ok(!out.calls[0].body.includes("bad/slash"), "19b. a rejected id is not forwarded either");

/* ── 19c. The image attachment — the ONLY other value that travels ───────── */

const SECOND_URL = "https://cdn.invalid/second-slip.jpg";
const image = (...attachments) => ({ message: { text: TEXT, attachments } });
const imageAt = (url) => ({ type: "image", payload: { url } });

assert.deepEqual(
  __test.imageAttachment(image(imageAt(ATTACHMENT_URL))),
  { type: "image", url: ATTACHMENT_URL },
  "19c. a valid image attachment is reduced to type and url",
);
assert.deepEqual(
  __test.imageAttachment(image(imageAt(ATTACHMENT_URL), imageAt(SECOND_URL))),
  { type: "image", url: ATTACHMENT_URL },
  "19c. only the FIRST valid image travels, never a list",
);
assert.deepEqual(
  __test.imageAttachment(
    image({ type: "file", payload: { url: SECOND_URL } }, imageAt(ATTACHMENT_URL)),
  ),
  { type: "image", url: ATTACHMENT_URL },
  "19c. a non-image before a valid image is skipped, not forwarded",
);
assert.deepEqual(
  __test.imageAttachment(image(imageAt("http://cdn.invalid/x.jpg"), imageAt(ATTACHMENT_URL))),
  { type: "image", url: ATTACHMENT_URL },
  "19c. an invalid URL before a valid image is skipped",
);

// Everything that is not an image with a non-empty HTTPS URL yields null.
for (const [event, why] of [
  [{}, "no message at all"],
  [{ message: null }, "a null message"],
  [{ message: "hi" }, "a string message"],
  [{ message: { text: TEXT } }, "a message with no attachments"],
  [{ message: { attachments: null } }, "a null attachments field"],
  [{ message: { attachments: {} } }, "an attachments object rather than an array"],
  [image(), "an empty attachments array"],
  [image(null), "a null attachment"],
  [image("image"), "a string attachment"],
  [image({ type: "file", payload: { url: ATTACHMENT_URL } }), "a file attachment"],
  [image({ type: "video", payload: { url: ATTACHMENT_URL } }), "a video attachment"],
  [image({ type: "audio", payload: { url: ATTACHMENT_URL } }), "an audio attachment"],
  [image({ type: "location", payload: { coordinates: { lat: 1, long: 2 } } }), "a location"],
  [image({ type: "fallback", payload: { url: ATTACHMENT_URL } }), "a fallback attachment"],
  [image({ type: "Image", payload: { url: ATTACHMENT_URL } }), "a differently cased type"],
  [image({ payload: { url: ATTACHMENT_URL } }), "an attachment with no type"],
  [image({ type: "image" }), "an image with no payload"],
  [image({ type: "image", payload: null }), "an image with a null payload"],
  [image({ type: "image", payload: [{ url: ATTACHMENT_URL }] }), "an array payload"],
  [image(imageAt(undefined)), "an image with no url"],
  [image(imageAt(null)), "a null url"],
  [image(imageAt("")), "an empty url"],
  [image(imageAt("http://cdn.invalid/x.jpg")), "a plain http url"],
  [image(imageAt("//cdn.invalid/x.jpg")), "a protocol-relative url"],
  [image(imageAt("data:image/jpeg;base64,AAAA")), "a data url"],
  [image(imageAt("https://")), "a scheme with no host"],
  [image(imageAt("https://?token=x")), "a hostless URL with a query"],
  [image(imageAt("https://user@example.invalid/x.jpg")), "a URL with a username"],
  [image(imageAt("https://user:password@example.invalid/x.jpg")), "a URL with credentials"],
  [image(imageAt("https:// cdn.invalid/x.jpg")), "a url with a space"],
  [image(imageAt({ toString: () => ATTACHMENT_URL })), "an object pretending to be a url"],
  [{ postback: { attachments: [imageAt(ATTACHMENT_URL)] } }, "an image on a postback"],
  [{ delivery: { attachments: [imageAt(ATTACHMENT_URL)] } }, "an image on a delivery"],
]) {
  assert.equal(__test.imageAttachment(event), null, `19c. ${why} yields null`);
}

// End to end: the image URL travels, the text and mid beside it do not, and a
// second image on the same message is not forwarded.
out = await deliver(
  wrap(
    envelope({
      message: {
        mid: MID,
        text: TEXT,
        attachments: [imageAt(ATTACHMENT_URL), imageAt(SECOND_URL)],
      },
    }),
    postbackEvent,
  ),
);
sent = forwarded(out);
assert.deepEqual(
  sent.events.map((e) => e.attachment),
  [{ type: "image", url: ATTACHMENT_URL }, null],
  "19c. the first image is forwarded on the message event only",
);
assert.ok(!out.calls[0].body.includes(SECOND_URL), "19c. a second image is never forwarded");
assert.ok(!out.calls[0].body.includes(TEXT), "19c. the text beside the image is still stripped");
assert.ok(!out.calls[0].body.includes(MID), "19c. the mid beside the image is still stripped");

// A non-image attachment forwards null, never a partial or coerced record.
out = await deliver(wrap(envelope(image({ type: "file", payload: { url: SECOND_URL } }))));
sent = forwarded(out);
assert.equal(sent.events[0].attachment, null, "19c. a file attachment forwards null");
assert.ok(!out.calls[0].body.includes(SECOND_URL), "19c. a non-image URL never reaches the wire");

/* ── 19d. The action allowlist — the third and last value that travels ───── */

const quickReplyEvent = (payload) =>
  envelope({ message: { mid: MID, text: TEXT, quick_reply: { payload } } });

// Both controls resolve through ONE allowlist: a button template's postback and
// a quick reply's tap are the same question wearing two Meta shapes.
for (const action of __test.MESSENGER_ACTIONS) {
  assert.equal(
    __test.messengerAction({ postback: { payload: action } }),
    action,
    `19d. an allowlisted postback payload travels: ${action}`,
  );
  assert.equal(
    __test.messengerAction({ message: { quick_reply: { payload: action } } }),
    action,
    `19d. an allowlisted quick-reply payload travels: ${action}`,
  );
}

// The four welcome options ARE the closed vocabulary — no more, no fewer.
assert.deepEqual(
  [...__test.MESSENGER_ACTIONS],
  ["ORDER_START", "SHOW_MENU", "SHOW_LOCATION", "SHOW_OPENING_HOURS"],
  "19d. Place an Order, Menu, Location and Opening Time, and nothing else",
);

// Anything NOT on the list is customer-controlled input and is stripped like
// message text: no prefix match, no case folding, no trimming, no coercion.
for (const [event, why] of [
  [{}, "no postback and no quick reply"],
  [{ postback: { payload: "DROP TABLE ORDERS" } }, "an unlisted payload"],
  [{ postback: { payload: "order_start" } }, "a lower-cased action"],
  [{ postback: { payload: "ORDER_START_EXTRA" } }, "an action with a suffix"],
  [{ postback: { payload: " ORDER_START" } }, "a padded action"],
  [{ postback: { payload: "" } }, "an empty payload"],
  [{ postback: { payload: 7 } }, "a numeric payload"],
  [{ postback: { payload: null } }, "a null payload"],
  [{ postback: { payload: ["ORDER_START"] } }, "an array payload"],
  [{ postback: { payload: { toString: () => "ORDER_START" } } }, "an object payload"],
  [{ postback: null }, "a null postback"],
  [{ postback: "ORDER_START" }, "a string postback"],
  [{ message: { text: TEXT } }, "an ordinary text message"],
  [{ message: { quick_reply: { payload: "SOMETHING_ELSE" } } }, "an unlisted quick reply"],
  [{ message: { quick_reply: null } }, "a null quick reply"],
  [{ message: { quick_reply: "SHOW_MENU" } }, "a string quick reply"],
  [{ delivery: { payload: "ORDER_START" } }, "a payload on a delivery event"],
  [{ read: { payload: "ORDER_START" } }, "a payload on a read event"],
]) {
  assert.equal(__test.messengerAction(event), null, `19d. ${why} yields null`);
}

// End to end: a quick-reply tap routes by action, and the title Meta echoes as
// message text — the words the customer tapped — is still stripped.
out = await deliver(wrap(quickReplyEvent("SHOW_LOCATION"), quickReplyEvent("SHOW_OPENING_HOURS")));
sent = forwarded(out);
assert.deepEqual(
  sent.events.map((e) => e.action),
  ["SHOW_LOCATION", "SHOW_OPENING_HOURS"],
  "19d. Location and Opening Time arrive as their own distinct actions",
);
assert.deepEqual(
  sent.events.map((e) => e.category),
  ["message", "message"],
  "19d. a quick reply is a MESSAGE event, which is why it needs its own read",
);
assert.ok(!out.calls[0].body.includes(TEXT), "19d. the echoed quick-reply title is still stripped");
assert.ok(!out.calls[0].body.includes(MID), "19d. and so is the mid beside it");

// THE ROUTING GUARANTEE. A slip, a tap and plain text are three disjoint
// shapes, so the receiver can no longer take the welcome branch for a payment
// slip the way the parallel branches did.
out = await deliver(
  wrap(
    envelope(image(imageAt(ATTACHMENT_URL))),
    quickReplyEvent("ORDER_START"),
    envelope({ message: { mid: MID, text: TEXT } }),
  ),
);
sent = forwarded(out);
assert.deepEqual(
  sent.events.map((e) => [e.attachment !== null, e.action]),
  [
    [true, null],
    [false, "ORDER_START"],
    [false, null],
  ],
  "19d. slip / tap / plain text are three disjoint shapes",
);
for (const event of sent.events) {
  assert.ok(
    event.attachment === null || event.action === null,
    "19d. no event can be both a payment slip and a menu tap",
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   E. Forwarding behaviour (tests 20–22)
   ══════════════════════════════════════════════════════════════════════════ */

// 20. Unset URL: still 200 after full validation, and NO external request.
env({ hook: null });
out = await deliver(wrap(messageEvent));
assert.equal(out.status, 200, "20. forwarding disabled still answers Meta 200");
assert.equal(out.calls.length, 0, "20. forwarding disabled makes no external request");
assert.ok(
  out.logs.some((l) => l.includes("forwarding=disabled")),
  "20. forwarding disabled is logged safely",
);
// Still validated: a bad signature is refused whether or not forwarding is on.
assert.equal(
  (await deliver(wrap(messageEvent), { signature: sign("{}") })).status,
  403,
  "20. validation is unchanged when forwarding is disabled",
);

// 21. A forward that fails in ANY way leaves Meta its 200.
env({ hook: HOOK });
for (const hookBehavior of ["reject", "timeout", "http500"]) {
  out = await deliver(wrap(messageEvent), { state: { hookBehavior } });
  assert.equal(out.status, 200, `21. a "${hookBehavior}" forward still answers Meta 200`);
  assert.equal(out.calls.length, 1, `21. a "${hookBehavior}" forward is attempted exactly once`);
}

// 22. No retry — one accepted event produces exactly one outbound request.
out = await deliver(wrap(messageEvent, postbackEvent, deliveryEvent));
assert.equal(out.calls.length, 1, "22. a batch forwards once, never per event, never retried");

/* ══════════════════════════════════════════════════════════════════════════
   F. Nothing leaks, nothing is sent (tests 23–24)
   ══════════════════════════════════════════════════════════════════════════ */

// 23. No log line, on ANY path, carries a secret, an identifier, or content.
const everyLog = [];
for (const [payload, options, environment] of [
  [wrap(messageEvent), {}, { hook: HOOK }],
  [wrap(postbackEvent, deliveryEvent, readEvent), {}, { hook: HOOK }],
  [wrap(messageEvent), {}, { hook: null }],
  [wrap(messageEvent), { signature: null }, { hook: HOOK }],
  [wrap(messageEvent), { signature: `sha256=${"f".repeat(64)}` }, { hook: HOOK }],
  [wrap(messageEvent), { signature: `garbage ${MID}` }, { hook: HOOK }],
  [`{"object":"page","entry":[${TEXT}`, {}, { hook: HOOK }],
  [{ object: "instagram", entry: [{ id: PAGE_ID }] }, {}, { hook: HOOK }],
  [wrap(messageEvent), { state: { hookBehavior: "reject" } }, { hook: HOOK }],
  [wrap(messageEvent), { state: { hookBehavior: "timeout" } }, { hook: HOOK }],
  [wrap(messageEvent), { state: { hookBehavior: "http500" } }, { hook: HOOK }],
  [wrap(messageEvent), {}, { secret: null, hook: HOOK }],
]) {
  env(environment);
  everyLog.push(...(await deliver(payload, options)).logs);
}
env();
for (const query of [
  { "hub.mode": "subscribe", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": CHALLENGE },
  { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": CHALLENGE },
  { "hub.mode": "delete", "hub.verify_token": VERIFY_TOKEN, "hub.challenge": CHALLENGE },
]) {
  everyLog.push(...(await verify(query)).logs);
}
env({ verify: null });
everyLog.push(...(await verify({ "hub.mode": "subscribe", "hub.challenge": CHALLENGE })).logs);

assert.ok(everyLog.length > 0, "23. the paths under test do log something");
// SENSITIVE still includes the PSID here, deliberately. The forward may carry
// it (test 17); a LOG LINE never may. This is the assertion that keeps the one
// forwarded identifier out of every log sink.
for (const line of everyLog) {
  for (const secretish of SENSITIVE) {
    assert.ok(!line.includes(secretish), `23. a log line must not contain "${secretish}": ${line}`);
  }
  assert.ok(!line.includes(CHALLENGE), "23. logs must not contain the verification challenge");
  assert.ok(!line.includes("ECONNREFUSED"), "23. logs must not contain a fetch error message");
  assert.ok(!line.includes('"object"'), "23. logs must not contain a raw payload fragment");
}

// 24. Receive-only, proven by the fetch stub: the ONLY outbound request this
// module can make is the sanitized forward to the configured n8n hook. Every
// Graph API host and every messaging deep link is asserted unreachable above,
// so no customer message can be sent from this endpoint.
env({ hook: HOOK });
out = await deliver(wrap(messageEvent));
assert.equal(out.calls.length, 1, "24. exactly one outbound request");
assert.equal(out.calls[0].url, HOOK, "24. and it is the n8n hook, never Meta");

const source = (await import("node:fs")).readFileSync(
  "api/_lib/metaMessengerWebhook.server.ts",
  "utf8",
);
for (const forbidden of [
  "graph.facebook.com",
  "PAGE_ACCESS_TOKEN",
  "access_token",
  "/me/messages",
]) {
  assert.ok(!source.includes(forbidden), `24. the module must not reference "${forbidden}"`);
}

console.log("test-meta-messenger-webhook: all assertions passed");
