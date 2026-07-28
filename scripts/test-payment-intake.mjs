// Tuesday (corrected) — TRUSTED payment-proof INTAKE check (no framework — run
// with `npm run test:payment-intake`). Compiles api/_lib/paymentIntake.server.ts
// and stubs bot_sessions / orders / storage / insert to assert:
//   AUTH      - missing or wrong x-proof-secret is refused before any Supabase
//               call; an unset PAYMENT_PROOF_SECRET fails closed (500).
//   BINDING   - the order is resolved from bot_sessions by platform +
//               external_chat_id; an order number from ANOTHER chat is refused;
//               several unpaid orders with no order number is refused, never
//               guessed; cancelled / completed / already-paid are refused.
//   FILE      - magic-byte validation (JPEG/PNG/WebP), declared/detected MIME
//               mismatch, short/garbage bytes, empty/oversized/missing files.
//   STORAGE   - server-generated unguessable key under the resolved order id;
//               insert failure and the one-pending conflict delete the object.
//   RESPONSE  - no storage path, no URL, no chat id in any response body.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/payment-intake-test";
execSync(
  `npx tsc api/_lib/paymentIntake.server.ts --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const { postAutomationPaymentProof } = await import(
  pathToFileURL(path.resolve(outDir, "paymentIntake.server.js")).href
);

const SECRET = "intake-test-secret";
process.env.PAYMENT_PROOF_SECRET = SECRET;
process.env.VITE_SUPABASE_URL = "https://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-not-a-real-key";
process.env.PAYMENT_PROOFS_BUCKET = "payment-proofs";

const ORDER_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const OTHER_UUID = "11111111-2222-4333-8444-555555555555";
const CHAT_ID = "IG_1234567890";
const ORDER_NUMBER = "TP-IG-1";

const openOrder = {
  id: ORDER_UUID,
  order_number: ORDER_NUMBER,
  status: "accepted",
  payment_status: "unpaid",
};

// The exact PostgREST error body a one-pending-index violation produces.
const ONE_PENDING_ERROR = {
  code: "23505",
  message: 'duplicate key value violates unique constraint "payment_proofs_one_pending_per_order"',
  details: "Key (order_id)=(…) already exists.",
};

let bh;
function reset() {
  bh = {
    sessions: [{ order_id: ORDER_UUID }],
    orders: [openOrder],
    sessionsOk: true,
    uploadOk: true,
    deleteOk: true,
    insert: "ok", // ok | conflict | error | a { status, body } literal
    log: [],
  };
}
reset();

// Captured console.error lines, so cleanup-failure logging can be asserted to
// be present AND free of anything sensitive.
const errorLog = [];
const realError = console.error;
console.error = (...args) => {
  errorLog.push(args.join(" "));
};
process.on("exit", () => {
  console.error = realError;
});

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method ?? "GET").toUpperCase();
  bh.log.push({ method, url: u });
  if (u.includes("/rest/v1/bot_sessions?")) {
    return bh.sessionsOk ? Response.json(bh.sessions) : new Response("boom", { status: 500 });
  }
  if (u.includes("/rest/v1/orders?")) return Response.json(bh.orders);
  if (u.includes("/storage/v1/object/") && method === "POST") {
    return bh.uploadOk ? new Response(null, { status: 200 }) : new Response(null, { status: 500 });
  }
  if (u.includes("/storage/v1/object/") && method === "DELETE") {
    if (bh.deleteOk === "throw") throw new Error("network down");
    return bh.deleteOk ? new Response(null, { status: 200 }) : new Response(null, { status: 500 });
  }
  if (u.includes("/rest/v1/payment_proofs")) {
    if (bh.insert === "ok") return new Response(null, { status: 201 });
    if (bh.insert === "conflict") return Response.json(ONE_PENDING_ERROR, { status: 409 });
    if (typeof bh.insert === "object") {
      return Response.json(bh.insert.body, { status: bh.insert.status });
    }
    return new Response("boom", { status: 500 });
  }
  throw new Error(`unexpected fetch target: ${method} ${u}`);
};

/* ── Bytes with real magic signatures ────────────────────────────────────── */

function imageBytes(kind, size = 2048) {
  const b = new Uint8Array(size);
  if (kind === "jpeg") b.set([0xff, 0xd8, 0xff], 0);
  else if (kind === "png") b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  else if (kind === "webp") {
    b.set([0x52, 0x49, 0x46, 0x46], 0);
    b.set([0x57, 0x45, 0x42, 0x50], 8);
  }
  // "garbage" → all zeros
  return b;
}

const MIME = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

function intakeReq({
  secret = SECRET,
  channel = "instagram",
  externalChatId = CHAT_ID,
  orderNumber,
  declaredType,
  kind = "jpeg",
  bytes,
  filename = "IMG_evil.jpg",
  omitFile = false,
  omitChannel = false,
} = {}) {
  const form = new FormData();
  if (!omitChannel) form.append("channel", channel);
  if (externalChatId !== null) form.append("externalChatId", externalChatId);
  if (orderNumber !== undefined) form.append("orderNumber", orderNumber);
  if (!omitFile) {
    const data = bytes ?? imageBytes(kind);
    form.append(
      "file",
      new Blob([data], { type: declaredType ?? MIME[kind] ?? "image/jpeg" }),
      filename,
    );
  }
  return new Request("https://app.invalid/api/automation/payment-proof", {
    method: "POST",
    headers: secret === null ? {} : { "x-proof-secret": secret },
    body: form,
  });
}

const codeOf = async (res) => (await res.json()).code;
const noSupabaseCalls = () =>
  assert.ok(!bh.log.length, "no Supabase call was made");

/* ── A. Authentication fails closed ──────────────────────────────────────── */

reset();
let res = await postAutomationPaymentProof(intakeReq({ secret: null }));
assert.equal(res.status, 401, "missing automation secret rejected");
assert.equal(await codeOf(res), "UNAUTHORIZED", "stable auth code");
noSupabaseCalls();

reset();
res = await postAutomationPaymentProof(intakeReq({ secret: "wrong-secret" }));
assert.equal(res.status, 401, "invalid automation secret rejected");
noSupabaseCalls();

reset();
delete process.env.PAYMENT_PROOF_SECRET;
res = await postAutomationPaymentProof(intakeReq());
assert.equal(res.status, 500, "unset PAYMENT_PROOF_SECRET fails closed");
noSupabaseCalls();
process.env.PAYMENT_PROOF_SECRET = SECRET;

/* ── B. Happy path: Instagram + Messenger, order bound via bot_sessions ──── */

reset();
res = await postAutomationPaymentProof(intakeReq({ orderNumber: ORDER_NUMBER }));
let json = await res.json();
assert.equal(res.status, 200, "valid Instagram proof accepted");
assert.equal(json.status, "pending", "proof filed as pending");
assert.equal(json.orderNumber, ORDER_NUMBER, "order number echoed");

// The chat identity really was the lookup key.
const sessionCall = bh.log.find((c) => c.url.includes("/rest/v1/bot_sessions?"));
assert.ok(sessionCall.url.includes("platform=eq.instagram"), "platform bound in the lookup");
assert.ok(sessionCall.url.includes(`external_chat_id=eq.${CHAT_ID}`), "chat id bound in the lookup");
assert.equal(sessionCall.method, "GET", "session lookup is read-only");

// Storage key: under the RESOLVED order uuid, random, never the sender filename.
const put = bh.log.find((c) => c.url.includes("/storage/v1/object/") && c.method === "POST");
assert.ok(put.url.includes(`/${ORDER_UUID}/`), "object key under the resolved order id");
assert.ok(!put.url.includes("IMG_evil"), "sender filename NOT used as the key");
assert.match(put.url, /\/[0-9a-f-]{36}\.jpg$/, "key ends in random uuid + real extension");

// The response leaks no storage path, no URL, no chat id.
const bodyText = JSON.stringify(json);
assert.ok(!bodyText.includes(ORDER_UUID), "no order uuid in the response");
assert.ok(!bodyText.includes("http"), "no URL of any kind in the response");
assert.ok(!bodyText.includes(".jpg") && !bodyText.includes(CHAT_ID), "no storage path or chat id");

reset();
res = await postAutomationPaymentProof(
  intakeReq({ channel: "messenger", externalChatId: "MS_9876543210" }),
);
assert.equal(res.status, 200, "valid Messenger proof accepted");
assert.ok(
  bh.log.some((c) => c.url.includes("platform=eq.messenger")),
  "messenger bound in the lookup",
);

// Order number is OPTIONAL when exactly one unpaid order matches the chat.
reset();
res = await postAutomationPaymentProof(intakeReq());
assert.equal(res.status, 200, "single unpaid order resolves without an order number");

// PNG and WebP with correct magic bytes are accepted.
for (const kind of ["png", "webp"]) {
  reset();
  res = await postAutomationPaymentProof(intakeReq({ kind }));
  assert.equal(res.status, 200, `valid ${kind} accepted`);
}

/* ── C. Channel / chat / order binding failures ──────────────────────────── */

reset();
res = await postAutomationPaymentProof(intakeReq({ channel: "whatsapp" }));
assert.equal(res.status, 400, "unsupported channel rejected");
assert.equal(await codeOf(res), "UNSUPPORTED_CHANNEL");
noSupabaseCalls();

reset();
res = await postAutomationPaymentProof(intakeReq({ omitChannel: true }));
assert.equal(res.status, 400, "missing channel rejected");
noSupabaseCalls();

reset();
res = await postAutomationPaymentProof(intakeReq({ externalChatId: "not a chat id!" }));
assert.equal(res.status, 400, "malformed chat id rejected");
noSupabaseCalls();

reset();
res = await postAutomationPaymentProof(intakeReq({ orderNumber: "TP IG 1" }));
assert.equal(res.status, 400, "malformed order number rejected");
noSupabaseCalls();

// The chat has no order at all.
reset();
bh.sessions = [];
res = await postAutomationPaymentProof(intakeReq());
assert.equal(res.status, 404, "chat with no linked order rejected");
assert.equal(await codeOf(res), "NO_ORDER_FOR_CHAT");

// The named order is NOT one of this chat's orders → never attached.
reset();
res = await postAutomationPaymentProof(intakeReq({ orderNumber: "TP-IG-999" }));
assert.equal(res.status, 409, "order from another conversation rejected");
assert.equal(await codeOf(res), "ORDER_CHAT_MISMATCH");
assert.ok(!bh.log.some((c) => c.url.includes("/storage/")), "mismatch never reaches storage");

// Two unpaid orders in one chat and no order number → refuse, never guess.
reset();
bh.sessions = [{ order_id: ORDER_UUID }, { order_id: OTHER_UUID }];
bh.orders = [openOrder, { ...openOrder, id: OTHER_UUID, order_number: "TP-IG-2" }];
res = await postAutomationPaymentProof(intakeReq());
assert.equal(res.status, 409, "ambiguous chat→order match rejected");
assert.equal(await codeOf(res), "AMBIGUOUS_ORDER");
assert.ok(!bh.log.some((c) => c.url.includes("/storage/")), "ambiguous match never stores a file");

// …and the SAME chat resolves cleanly once n8n names the order.
reset();
bh.sessions = [{ order_id: ORDER_UUID }, { order_id: OTHER_UUID }];
bh.orders = [openOrder, { ...openOrder, id: OTHER_UUID, order_number: "TP-IG-2" }];
res = await postAutomationPaymentProof(intakeReq({ orderNumber: "TP-IG-2" }));
assert.equal(res.status, 200, "an authoritative order number disambiguates");
assert.ok(
  bh.log.find((c) => c.url.includes("/storage/v1/object/") && c.method === "POST").url.includes(OTHER_UUID),
  "the NAMED order received the proof",
);

/* ── D. Closed / paid orders refuse proof ────────────────────────────────── */

for (const [patch, code] of [
  [{ status: "cancelled" }, "ORDER_CANCELLED"],
  [{ status: "completed" }, "ORDER_COMPLETED"],
  [{ payment_status: "Paid" }, "ORDER_ALREADY_PAID"],
]) {
  reset();
  bh.orders = [{ ...openOrder, ...patch }];
  res = await postAutomationPaymentProof(intakeReq({ orderNumber: ORDER_NUMBER }));
  assert.equal(res.status, 409, `${code} → 409`);
  assert.equal(await codeOf(res), code);
  assert.ok(!bh.log.some((c) => c.url.includes("/storage/")), `${code}: nothing stored`);
}

// No order number + only a paid order in the chat → nothing to attach to.
reset();
bh.orders = [{ ...openOrder, payment_status: "Paid" }];
res = await postAutomationPaymentProof(intakeReq());
assert.equal(res.status, 409, "already-paid order rejected without an order number too");

/* ── E. File validation (never trust the declared type) ──────────────────── */

reset();
res = await postAutomationPaymentProof(intakeReq({ declaredType: "image/png", kind: "jpeg" }));
assert.equal(res.status, 415, "declared/detected MIME mismatch rejected");
assert.equal(await codeOf(res), "MIME_MISMATCH");
noSupabaseCalls();

reset();
res = await postAutomationPaymentProof(intakeReq({ declaredType: "image/jpeg", kind: "garbage" }));
assert.equal(res.status, 415, "unrecognizable bytes rejected");

reset();
res = await postAutomationPaymentProof(
  intakeReq({ declaredType: "image/jpeg", bytes: new Uint8Array([0xff, 0xd8]) }),
);
assert.equal(res.status, 415, "file too short to identify rejected");

reset();
res = await postAutomationPaymentProof(intakeReq({ declaredType: "application/pdf" }));
assert.equal(res.status, 415, "non-image declared type rejected");

reset();
res = await postAutomationPaymentProof(intakeReq({ omitFile: true }));
assert.equal(res.status, 400, "missing file rejected");

reset();
res = await postAutomationPaymentProof(intakeReq({ bytes: new Uint8Array(0) }));
assert.equal(res.status, 400, "empty file rejected");

reset();
res = await postAutomationPaymentProof(
  intakeReq({ kind: "jpeg", bytes: imageBytes("jpeg", 6 * 1024 * 1024) }),
);
assert.equal(res.status, 413, "oversized file rejected");
noSupabaseCalls();

reset();
res = await postAutomationPaymentProof(
  new Request("https://app.invalid/api/automation/payment-proof", {
    method: "POST",
    headers: { "x-proof-secret": SECRET, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: "instagram" }),
  }),
);
assert.equal(res.status, 415, "non-multipart body rejected");
noSupabaseCalls();

/* ── F. Storage cleanup on DB failure + one-pending conflict ─────────────── */

reset();
bh.insert = "error";
res = await postAutomationPaymentProof(intakeReq());
assert.equal(res.status, 502, "insert failure → safe 502");
assert.equal(await codeOf(res), "INSERT_FAILED");
assert.ok(
  bh.log.some((c) => c.url.includes("/storage/v1/object/") && c.method === "DELETE"),
  "orphan object deleted after failed insert",
);

reset();
bh.insert = "conflict";
res = await postAutomationPaymentProof(intakeReq());
assert.equal(res.status, 409, "second pending proof mapped safely");
assert.equal(await codeOf(res), "PENDING_PROOF_EXISTS");
assert.ok(
  bh.log.some((c) => c.url.includes("/storage/v1/object/") && c.method === "DELETE"),
  "duplicate upload cleaned up",
);

/* ── F2. ONLY the expected one-pending violation is PENDING_PROOF_EXISTS ─── */

// A bare 409 with no PostgreSQL code proves nothing → INSERT_FAILED.
reset();
bh.insert = { status: 409, body: { message: "conflict" } };
res = await postAutomationPaymentProof(intakeReq());
assert.equal(res.status, 502, "unrelated 409 is not a pending-proof conflict");
assert.equal(await codeOf(res), "INSERT_FAILED");

// A 23505 on a DIFFERENT unique constraint → INSERT_FAILED, never "pending".
reset();
bh.insert = {
  status: 409,
  body: {
    code: "23505",
    message: 'duplicate key value violates unique constraint "payment_proofs_pkey"',
    details: "Key (id)=(…) already exists.",
  },
};
res = await postAutomationPaymentProof(intakeReq());
assert.equal(res.status, 502, "unrelated 23505 is not a pending-proof conflict");
assert.equal(await codeOf(res), "INSERT_FAILED");

// The expected index name WITHOUT the 23505 code is not proof either.
reset();
bh.insert = {
  status: 409,
  body: { message: "something about payment_proofs_one_pending_per_order" },
};
res = await postAutomationPaymentProof(intakeReq());
assert.equal(res.status, 502, "index name alone (no 23505) is not a conflict");
assert.equal(await codeOf(res), "INSERT_FAILED");

// Other integrity failures (FK / CHECK) are plain insert failures.
for (const code of ["23503", "23514"]) {
  reset();
  bh.insert = { status: 409, body: { code, message: "violates constraint" } };
  res = await postAutomationPaymentProof(intakeReq());
  assert.equal(await codeOf(res), "INSERT_FAILED", `${code} → INSERT_FAILED`);
}

// No raw database message, constraint name, or code reaches the client.
reset();
bh.insert = { status: 409, body: { code: "23505", message: 'unique constraint "orders_pkey"' } };
res = await postAutomationPaymentProof(intakeReq());
const errBody = JSON.stringify(await res.json());
assert.ok(!errBody.includes("23505"), "no PostgreSQL code leaked");
assert.ok(!errBody.includes("orders_pkey"), "no constraint name leaked");
assert.ok(!errBody.includes("unique constraint"), "no raw database message leaked");

/* ── F3. Cleanup failure logs safely and never masks the real error ──────── */

for (const [mode, label] of [
  [false, "cleanup DELETE returns 500"],
  ["throw", "cleanup DELETE throws"],
]) {
  // Primary failure = insert error → the client must still see INSERT_FAILED.
  reset();
  errorLog.length = 0;
  bh.insert = "error";
  bh.deleteOk = mode;
  res = await postAutomationPaymentProof(intakeReq({ orderNumber: ORDER_NUMBER }));
  assert.equal(res.status, 502, `${label}: primary status preserved`);
  assert.equal(await codeOf(res), "INSERT_FAILED", `${label}: primary code preserved`);

  const cleanupLines = errorLog.filter((line) => line.includes("orphan cleanup failed"));
  assert.equal(cleanupLines.length, 1, `${label}: exactly one cleanup log line`);
  const line = cleanupLines[0];
  assert.ok(!line.includes(ORDER_UUID), `${label}: no order uuid logged`);
  assert.ok(!line.includes(ORDER_NUMBER), `${label}: no order number logged`);
  assert.ok(!line.includes(CHAT_ID), `${label}: no chat id logged`);
  assert.ok(!line.includes(".jpg") && !line.includes("/"), `${label}: no object path logged`);
  assert.ok(!line.includes(SECRET) && !line.includes("dummy-not-a-real-key"), `${label}: no secret`);

  // Same for the one-pending conflict path.
  reset();
  errorLog.length = 0;
  bh.insert = "conflict";
  bh.deleteOk = mode;
  res = await postAutomationPaymentProof(intakeReq());
  assert.equal(res.status, 409, `${label}: conflict status preserved`);
  assert.equal(await codeOf(res), "PENDING_PROOF_EXISTS", `${label}: conflict code preserved`);
  assert.equal(
    errorLog.filter((l) => l.includes("orphan cleanup failed")).length,
    1,
    `${label}: cleanup failure logged on the conflict path too`,
  );
}

// A SUCCESSFUL cleanup logs nothing.
reset();
errorLog.length = 0;
bh.insert = "conflict";
res = await postAutomationPaymentProof(intakeReq());
assert.equal(
  errorLog.filter((l) => l.includes("orphan cleanup failed")).length,
  0,
  "successful cleanup is silent",
);

reset();
bh.uploadOk = false;
res = await postAutomationPaymentProof(intakeReq());
assert.equal(res.status, 502, "storage failure → safe 502");
assert.ok(!bh.log.some((c) => c.url.includes("/rest/v1/payment_proofs")), "no row without a file");

// A failed session lookup never becomes a guessed order.
reset();
bh.sessionsOk = false;
res = await postAutomationPaymentProof(intakeReq());
assert.equal(res.status, 502, "session lookup failure → 502");
assert.ok(!bh.log.some((c) => c.url.includes("/storage/")), "lookup failure stores nothing");

/* ── G. Isolation: intake can never create an order or issue a link ──────── */

const source = readFileSync("api/_lib/paymentIntake.server.ts", "utf8");
assert.ok(!source.includes("rpc/create_order"), "intake calls NO order-creation RPC");
assert.ok(!source.includes("rpc/create_bot_session"), "intake mints no ordering session");
assert.ok(!source.includes("PUBLIC_SITE_URL"), "intake issues no customer link");
// The proof row is written with a private path only — never a public url.
assert.ok(source.includes("proof_file_path"), "intake stores a private storage path");
assert.ok(!source.includes("proof_url"), "intake never writes a public proof_url");
// payment_proofs is the ONLY table it writes.
assert.ok(!/method: "PATCH"|\/rest\/v1\/orders`?,\s*\{\s*method: "POST"/.test(source), "intake never patches orders");

console.log("test-payment-intake: all assertions passed");
