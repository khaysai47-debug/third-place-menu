// Tuesday (corrected) — staff payment-proof REVIEW route check (no framework —
// run with `npm run test:payment-proof`). Compiles api/_lib/paymentProof.server
// .ts and stubs the review_payment_proof RPC to assert:
//   - the route requires the staff secret;
//   - reject without a reason is refused before the RPC;
//   - a non-uuid proofId is refused before the RPC;
//   - approve/reject success relays the RPC result;
//   - every PROOF_*/ORDER_ALREADY_PAID error maps to a stable status and the
//     raw code is never leaked to the client.
// The trusted n8n INTAKE path is covered by test-payment-intake.mjs.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/payment-proof-test";
execSync(
  `npx tsc api/_lib/paymentProof.server.ts --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const { postReviewPaymentProof } = await import(
  pathToFileURL(path.resolve(outDir, "paymentProof.server.js")).href
);

const STAFF_SECRET = "proof-test-secret";
process.env.STAFF_WRITE_SECRET = STAFF_SECRET;
process.env.VITE_SUPABASE_URL = "https://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-not-a-real-key";

const PROOF_ID = "cccccccc-dddd-eeee-ffff-000000000000";

let bh;
function reset() {
  bh = {
    rpc: { ok: { proof_status: "approved", order_number: "TP-IG-1", payment_status: "Paid", changed: true } },
    log: [],
    notified: [],
  };
}
reset();

const NOTIFY_HOOK = "https://n8n.invalid/webhook/atlas-payment-review-test";
const ORDER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  bh.log.push(u);
  if (u.includes("/rest/v1/rpc/review_payment_proof")) {
    if (bh.rpc.error) return Response.json({ message: bh.rpc.error }, { status: 400 });
    return Response.json(bh.rpc.ok);
  }
  // Section E only — the notification path stays entirely unreachable while
  // N8N_PAYMENT_REVIEW_WEBHOOK_URL is unset (sections A–D).
  if (u.includes("/rest/v1/orders?")) return Response.json([{ id: ORDER_ID }]);
  if (u.includes("/rest/v1/bot_sessions?")) {
    return Response.json([{ platform: "instagram", external_chat_id: "17841400000000001" }]);
  }
  if (u === NOTIFY_HOOK) {
    bh.notified.push(init);
    return new Response("ok");
  }
  throw new Error(`unexpected fetch target: ${(init.method ?? "GET")} ${u}`);
};

const reviewReq = (body, secret = STAFF_SECRET) =>
  new Request("https://app.invalid/api/staff/review-payment-proof", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(secret ? { "x-staff-secret": secret } : {}) },
    body: JSON.stringify(body),
  });

/* ── A. Auth + validation happen before the RPC ──────────────────────────── */

reset();
let res = await postReviewPaymentProof(reviewReq({ proofId: PROOF_ID, decision: "approve" }, ""));
assert.equal(res.status, 401, "review requires the staff secret");
assert.ok(!bh.log.some((u) => u.includes("rpc")), "no RPC without auth");

reset();
res = await postReviewPaymentProof(reviewReq({ proofId: PROOF_ID, decision: "reject" }));
assert.equal(res.status, 400, "reject requires a reason");
assert.ok(!bh.log.some((u) => u.includes("rpc")), "no RPC when reason missing");

reset();
res = await postReviewPaymentProof(reviewReq({ proofId: "nope", decision: "approve" }));
assert.equal(res.status, 400, "non-uuid proofId rejected");
assert.ok(!bh.log.some((u) => u.includes("rpc")), "no RPC for a bad proofId");

/* ── B. Success relays the RPC result ────────────────────────────────────── */

reset();
res = await postReviewPaymentProof(reviewReq({ proofId: PROOF_ID, decision: "approve" }));
let json = await res.json();
assert.equal(res.status, 200, "approve succeeds");
assert.equal(json.proofStatus, "approved", "approved status relayed");
assert.equal(json.changed, true, "changed flag relayed");

reset();
bh.rpc = { ok: { proof_status: "rejected", order_number: "TP-IG-1", payment_status: "unpaid", changed: true } };
res = await postReviewPaymentProof(reviewReq({ proofId: PROOF_ID, decision: "reject", reason: "Blurry slip" }));
json = await res.json();
assert.equal(res.status, 200, "reject with reason succeeds");
assert.equal(json.proofStatus, "rejected", "rejected status relayed");

/* ── C. RPC business errors → stable statuses, codes never leaked ─────────── */

for (const [code, expected] of [
  ["PROOF_ALREADY_APPROVED", 409],
  ["PROOF_ALREADY_REJECTED", 409],
  ["PROOF_NOT_FOUND", 404],
  ["PROOF_ORDER_MISSING", 409],
  ["PROOF_REASON_REQUIRED", 400],
  ["PROOF_ORDER_CANCELLED", 409],
  ["PROOF_ORDER_COMPLETED", 409],
  ["ORDER_ALREADY_PAID", 409],
]) {
  reset();
  bh.rpc = { error: code };
  res = await postReviewPaymentProof(
    reviewReq({ proofId: PROOF_ID, decision: "reject", reason: "x" }),
  );
  assert.equal(res.status, expected, `${code} → ${expected}`);
  const body = await res.json();
  assert.ok(!JSON.stringify(body).includes(code), `${code}: raw code not leaked to client`);
}

/* ── D. A COMPLETED order refuses BOTH decisions ─────────────────────────── */

// The RPC raises PROOF_ORDER_COMPLETED before touching the proof or the order,
// so the route must answer 409 for approve AND reject, with a staff-safe
// message and no trace of the internal code.
for (const decision of ["approve", "reject"]) {
  reset();
  bh.rpc = { error: "PROOF_ORDER_COMPLETED" };
  res = await postReviewPaymentProof(
    reviewReq({
      proofId: PROOF_ID,
      decision,
      ...(decision === "reject" ? { reason: "wrong slip" } : {}),
    }),
  );
  assert.equal(res.status, 409, `completed order: ${decision} refused with 409`);
  const body = await res.json();
  assert.equal(body.ok, false, `completed order: ${decision} is not a success`);
  assert.match(body.error, /completed/i, `completed order: ${decision} message names the reason`);
  assert.ok(
    !JSON.stringify(body).includes("PROOF_ORDER_COMPLETED"),
    `completed order: ${decision} never leaks the raw code`,
  );
  // The route calls the RPC and nothing else — no direct order/proof write can
  // sneak a payment or status change past the guard.
  assert.equal(bh.log.length, 1, `completed order: ${decision} makes exactly one RPC call`);
  assert.ok(bh.log[0].includes("rpc/review_payment_proof"), "only the guarded RPC is called");
}

/* ══════════════════════════════════════════════════════════════════════════
   E. payment.reviewed NOTIFICATION — fired from the review route only after a
      real state change, and never able to alter what staff got back.
   ══════════════════════════════════════════════════════════════════════════ */

process.env.N8N_PAYMENT_REVIEW_WEBHOOK_URL = NOTIFY_HOOK;
process.env.N8N_AUTOMATION_SECRET = "review-integration-secret";

/** Runs one review and returns { status, json, notified }. */
async function review(body, rpc) {
  reset();
  if (rpc) bh.rpc = rpc;
  const response = await postReviewPaymentProof(reviewReq(body));
  const parsed = await response.json();
  // Delivery floats past the response on waitUntil — settle before asserting.
  await new Promise((r) => setTimeout(r, 40));
  return { status: response.status, json: parsed, notified: bh.notified };
}

// E1. A successful APPROVAL with changed=true notifies exactly once, and the
//     response shape staff already parse is untouched.
let out = await review(
  { proofId: PROOF_ID, decision: "approve" },
  { ok: { proof_status: "approved", order_number: "TP-IG-1", payment_status: "Paid", changed: true } },
);
assert.equal(out.status, 200, "approve still answers 200");
assert.deepEqual(
  Object.keys(out.json).sort(),
  ["changed", "decision", "ok", "orderNumber", "paymentStatus", "proofStatus"],
  "the review response shape is unchanged",
);
assert.equal(out.json.ok, true);
assert.equal(out.json.decision, "approve");
assert.equal(out.json.proofStatus, "approved");
assert.equal(out.json.paymentStatus, "Paid", "approval still reports Paid");
assert.equal(out.json.changed, true);
assert.equal(out.notified.length, 1, "a changed approval notifies exactly once");
let event = JSON.parse(out.notified[0].body);
assert.equal(event.eventType, "payment.reviewed");
assert.equal(event.decision, "approved");
assert.equal(event.rejectionReason, null);
assert.equal(event.paymentStatus, "paid");
assert.equal(event.orderNumber, "TP-IG-1");
// The review RPC is still called exactly once — the notification adds reads
// and one POST, never a second write.
assert.equal(
  bh.log.filter((u) => u.includes("rpc/review_payment_proof")).length,
  1,
  "approval still marks Paid/Transfer through exactly ONE RPC call",
);

// E2. A successful REJECTION notifies once, with the exact validated reason,
//     and leaves the order unpaid.
out = await review(
  { proofId: PROOF_ID, decision: "reject", reason: "  Wrong amount  " },
  { ok: { proof_status: "rejected", order_number: "TP-IG-1", payment_status: "unpaid", changed: true } },
);
assert.equal(out.status, 200, "reject still answers 200");
assert.equal(out.json.proofStatus, "rejected");
assert.equal(out.json.paymentStatus, "unpaid", "rejection leaves the order unpaid");
assert.equal(out.notified.length, 1, "a changed rejection notifies exactly once");
event = JSON.parse(out.notified[0].body);
assert.equal(event.decision, "rejected");
assert.equal(event.rejectionReason, "Wrong amount", "the TRIMMED validated reason is notified");
assert.equal(event.paymentStatus, "unpaid");

// E3. changed=false (idempotent replay) notifies NOTHING — the customer must
//     not be messaged twice for one decision.
for (const decision of ["approve", "reject"]) {
  out = await review(
    { proofId: PROOF_ID, decision, ...(decision === "reject" ? { reason: "Wrong amount" } : {}) },
    {
      ok: {
        proof_status: decision === "approve" ? "approved" : "rejected",
        order_number: "TP-IG-1",
        payment_status: decision === "approve" ? "Paid" : "unpaid",
        changed: false,
      },
    },
  );
  assert.equal(out.status, 200, `${decision} replay still answers 200`);
  assert.equal(out.json.changed, false);
  assert.equal(out.notified.length, 0, `${decision} replay (changed=false) notifies nothing`);
}

// E4. A FAILED review never notifies — the RPC refused, so nothing happened.
for (const code of ["PROOF_ORDER_CANCELLED", "PROOF_ORDER_COMPLETED", "ORDER_ALREADY_PAID", "PROOF_NOT_FOUND"]) {
  out = await review({ proofId: PROOF_ID, decision: "reject", reason: "x" }, { error: code });
  assert.notEqual(out.status, 200, `${code} is still an error`);
  assert.equal(out.notified.length, 0, `${code}: a failed review never notifies`);
}

// E5. Refused BEFORE the RPC (bad auth/validation) → no RPC, no notification.
reset();
let res2 = await postReviewPaymentProof(reviewReq({ proofId: PROOF_ID, decision: "approve" }, ""));
await new Promise((r) => setTimeout(r, 20));
assert.equal(res2.status, 401);
assert.equal(bh.notified.length, 0, "an unauthenticated review notifies nothing");

reset();
res2 = await postReviewPaymentProof(reviewReq({ proofId: PROOF_ID, decision: "reject" }));
await new Promise((r) => setTimeout(r, 20));
assert.equal(res2.status, 400);
assert.equal(bh.notified.length, 0, "a reject with no reason notifies nothing");

// E6. A failing webhook cannot change the staff response.
const savedFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === NOTIFY_HOOK) {
    bh.notified.push(init);
    throw new TypeError("fetch failed");
  }
  return savedFetch(url, init);
};
out = await review(
  { proofId: PROOF_ID, decision: "approve" },
  { ok: { proof_status: "approved", order_number: "TP-IG-1", payment_status: "Paid", changed: true } },
);
globalThis.fetch = savedFetch;
assert.equal(out.status, 200, "a dead webhook leaves the review a 200");
assert.equal(out.json.proofStatus, "approved", "the approval still stands");
assert.equal(out.json.changed, true, "the state change is still reported");
assert.equal(out.notified.length, 1, "the attempt was made and swallowed");

console.log("test-payment-proof: all assertions passed");
