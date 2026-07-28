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
  bh = { rpc: { ok: { proof_status: "approved", order_number: "TP-IG-1", payment_status: "Paid", changed: true } }, log: [] };
}
reset();

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  bh.log.push(u);
  if (u.includes("/rest/v1/rpc/review_payment_proof")) {
    if (bh.rpc.error) return Response.json({ message: bh.rpc.error }, { status: 400 });
    return Response.json(bh.rpc.ok);
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

console.log("test-payment-proof: all assertions passed");
