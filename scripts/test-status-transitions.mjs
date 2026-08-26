// Tuesday — order-status transition guard + mark-paid idempotency check
// (no framework — run with `npm run test:status-transitions`). Compiles
// api/_lib/staffOrderWrites.server.ts, stubs fetch as a tiny in-memory orders
// table, and asserts the AUTHORITATIVE server guard:
//   - each order type's legal flow advances one step at a time;
//   - skipped / backward / repeated / terminal transitions are rejected;
//   - "cancelled" is refused by update-status (cancel has its own route);
//   - cancel-order refuses a completed order and is idempotent when cancelled;
//   - mark-paid never re-stamps an already-paid order (paid_at is immutable);
//   - mark-paid routes each method to its own locking RPC, and the staff
//     QR / bank-transfer path is dine-in only and writes no payment proof.
// All fetches are stubbed — no network, no real secrets.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = "node_modules/.cache/status-transitions-test";
execSync(
  `npx tsc api/_lib/staffOrderWrites.server.ts --outDir ${outDir}` +
    " --module nodenext --moduleResolution nodenext --target es2022" +
    " --lib es2022,dom --skipLibCheck",
  { stdio: "inherit" },
);
writeFileSync(path.join(outDir, "package.json"), '{"type":"module"}\n');

const { postUpdateStatus, postCancelOrder, postMarkPaid } = await import(
  pathToFileURL(path.resolve(outDir, "staffOrderWrites.server.js")).href
);

const SECRET = "transition-test-secret";
process.env.STAFF_WRITE_SECRET = SECRET;
process.env.VITE_SUPABASE_URL = "https://supabase.invalid";
process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy-not-a-real-key";

// The in-memory order the stub serves + mutates. Reset per scenario.
let order = null;
let patchLog = [];
let rpcLog = [];

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const parsed = new URL(u);
  const method = (init.method ?? "GET").toUpperCase();

  if (u.includes("/rest/v1/orders?")) {
    if (method === "GET") {
      const select = parsed.searchParams.get("select")?.split(",") ?? [];
      if (!order) return Response.json([]);
      return Response.json([Object.fromEntries(select.map((f) => [f, order[f] ?? null]))]);
    }
    if (method === "PATCH") {
      patchLog.push({ url: u, body: JSON.parse(init.body) });
      // Honor the optimistic-concurrency guards in the query string.
      const statusGuard = parsed.searchParams.get("status"); // e.g. "eq.new"
      let match = !!order;
      if (order && statusGuard) match &&= statusGuard === `eq.${order.status}`;
      if (!match) return Response.json([]); // zero rows updated
      order = { ...order, ...JSON.parse(init.body) };
      return Response.json([order]);
    }
  }
  // mark-paid delegates to ONE locking RPC per method: mark_order_paid_cash
  // (any order type) or mark_order_paid_transfer (dine_in only). This stub
  // mirrors both docs/sql functions — cancelled refusal, idempotent on
  // already-paid, paid_at stamped exactly once — and, like them, never
  // touches payment_proofs.
  const rpc = u.match(/\/rest\/v1\/rpc\/(mark_order_paid_\w+)/)?.[1];
  if (rpc) {
    rpcLog.push({ rpc, body: JSON.parse(init.body) });
    const fail = (message) => Response.json({ message }, { status: 400 });
    const transfer = rpc === "mark_order_paid_transfer";
    if (!order) return fail("ORDER_NOT_FOUND");
    if (order.status === "cancelled") return fail("ORDER_CANCELLED");
    if (transfer && order.order_type !== "dine_in") return fail("ORDER_NOT_DINE_IN");
    // Like both real RPCs, the result carries the method the ROW holds — an
    // already-paid order reports its ORIGINAL method, not the requested one.
    if (String(order.payment_status ?? "").toLowerCase() === "paid") {
      return Response.json({
        already_paid: true,
        changed: false,
        payment_method: order.payment_method,
        paid_at: order.paid_at,
      });
    }
    order = {
      ...order,
      payment_status: "Paid",
      payment_method: transfer ? "Transfer" : "Cash",
      paid_at: order.paid_at ?? new Date().toISOString(),
    };
    return Response.json({
      already_paid: false,
      changed: true,
      payment_method: order.payment_method,
      paid_at: order.paid_at,
    });
  }
  throw new Error(`unexpected fetch target: ${method} ${u}`);
};

const req = (body) =>
  new Request("https://app.invalid/api/staff/update-status", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-staff-secret": SECRET },
    body: JSON.stringify(body),
  });

async function advance(orderType, status, requested) {
  order = { order_type: orderType, status, payment_status: "unpaid" };
  patchLog = [];
  const res = await postUpdateStatus(req({ orderId: "TP-1", status: requested }));
  return { status: res.status, json: await res.json(), order };
}

/* ── A. Legal flows advance one step at a time ───────────────────────────── */

const DINE_IN = ["new", "accepted", "preparing", "completed"];
const PICKUP = ["new", "accepted", "preparing", "ready_for_pickup", "completed"];
const DELIVERY = ["new", "accepted", "preparing", "out_for_delivery", "delivered", "completed"];

for (const [type, flow] of [
  ["dine_in", DINE_IN],
  ["pickup", PICKUP],
  ["delivery", DELIVERY],
]) {
  for (let i = 0; i < flow.length - 1; i++) {
    const from = flow[i];
    const to = flow[i + 1];
    const r = await advance(type, from, to);
    assert.equal(r.status, 200, `${type}: ${from} → ${to} allowed`);
    assert.equal(r.order.status, to, `${type}: ${from} → ${to} persisted`);
  }
}

/* ── B. Illegal transitions are rejected (nothing persisted) ─────────────── */

// Skipped: new → preparing (must go through accepted).
let r = await advance("pickup", "new", "preparing");
assert.equal(r.status, 409, "skipped transition rejected");
assert.equal(r.order.status, "new", "skipped transition not persisted");

// Backward: preparing → new.
r = await advance("pickup", "preparing", "new");
assert.equal(r.status, 409, "backward transition rejected");
assert.equal(r.order.status, "preparing", "backward transition not persisted");

// Repeated: accepted → accepted.
r = await advance("pickup", "accepted", "accepted");
assert.equal(r.status, 409, "repeated transition rejected");

// Terminal: completed → anything.
r = await advance("dine_in", "completed", "preparing");
assert.equal(r.status, 409, "terminal-state transition rejected");
assert.equal(r.order.status, "completed", "terminal state unchanged");

// Wrong branch for type: a dine_in order can never reach ready_for_pickup.
r = await advance("dine_in", "preparing", "ready_for_pickup");
assert.equal(r.status, 409, "dine_in cannot go to ready_for_pickup (that's pickup)");

// dine_in preparing → completed IS legal (proves the branch is type-aware).
r = await advance("dine_in", "preparing", "completed");
assert.equal(r.status, 200, "dine_in preparing → completed allowed");

/* ── C. Cancellation is refused by update-status ─────────────────────────── */

r = await advance("pickup", "new", "cancelled");
assert.equal(r.status, 400, "update-status refuses 'cancelled'");
assert.equal(r.order.status, "new", "cancel via update-status persisted nothing");

// Unknown status is a 400.
order = { order_type: "pickup", status: "new", payment_status: "unpaid" };
r = { status: (await postUpdateStatus(req({ orderId: "TP-1", status: "banana" }))).status };
assert.equal(r.status, 400, "unknown status rejected");

// Missing order → 404.
order = null;
const missing = await postUpdateStatus(req({ orderId: "TP-NONE", status: "accepted" }));
assert.equal(missing.status, 404, "missing order → 404");

/* ── D. cancel-order: terminal guard + idempotency ───────────────────────── */

const cancelReq = (body) =>
  new Request("https://app.invalid/api/staff/cancel-order", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-staff-secret": SECRET },
    body: JSON.stringify(body),
  });

// Completed order cannot be cancelled.
order = { order_type: "pickup", status: "completed", payment_status: "Paid" };
let c = await postCancelOrder(cancelReq({ orderId: "TP-1", reason: "x" }));
assert.equal(c.status, 409, "completed order cannot be cancelled");
assert.equal(order.status, "completed", "completed order unchanged");

// Non-terminal order cancels.
order = { order_type: "pickup", status: "preparing", payment_status: "unpaid" };
c = await postCancelOrder(cancelReq({ orderId: "TP-1", reason: "No payment received" }));
assert.equal(c.status, 200, "preparing order cancels");
assert.equal(order.status, "cancelled", "cancel persisted");

// Already-cancelled is idempotent (reason NOT restamped).
order = { order_type: "pickup", status: "cancelled", cancellation_reason: "First reason" };
patchLog = [];
c = await postCancelOrder(cancelReq({ orderId: "TP-1", reason: "Second reason" }));
assert.equal(c.status, 200, "already-cancelled is idempotent");
assert.equal(order.cancellation_reason, "First reason", "original cancel reason preserved");
assert.equal(patchLog.length, 0, "idempotent cancel issues no PATCH");

/* ── E. mark-paid (Cash): via RPC, idempotent (paid_at never re-stamped) ──── */

const paidReq = (method) =>
  new Request("https://app.invalid/api/staff/mark-paid", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-staff-secret": SECRET },
    body: JSON.stringify({ orderId: "TP-1", paymentMethod: method }),
  });

// First Cash payment stamps paid_at via the Cash RPC. UNCHANGED behavior.
order = { order_type: "pickup", status: "preparing", payment_status: "unpaid" };
rpcLog = [];
let p = await postMarkPaid(paidReq("Cash"));
assert.equal(p.status, 200, "first Cash mark-paid succeeds");
assert.equal(rpcLog[0].rpc, "mark_order_paid_cash", "Cash uses the cash RPC");
assert.equal(order.payment_status, "Paid", "order flips to Paid (Cash)");
assert.equal(order.payment_method, "Cash", "method is Cash");
assert.ok(order.paid_at, "paid_at stamped");
const firstPaidAt = order.paid_at;

// Second Cash mark-paid → RPC reports already_paid; paid_at unchanged.
p = await postMarkPaid(paidReq("Cash"));
const pJson = await p.json();
assert.equal(p.status, 200, "second Cash mark-paid is a safe no-op");
assert.equal(pJson.alreadyPaid, true, "second mark-paid reports alreadyPaid");
assert.equal(order.paid_at, firstPaidAt, "paid_at NOT re-stamped on replay");

// Cancelled order cannot be paid — by either method.
order = { order_type: "pickup", status: "cancelled", payment_status: "unpaid" };
p = await postMarkPaid(paidReq("Cash"));
assert.equal(p.status, 409, "a cancelled order cannot be marked paid");
order = { order_type: "dine_in", status: "cancelled", payment_status: "unpaid" };
p = await postMarkPaid(paidReq("Transfer"));
assert.equal(p.status, 409, "a cancelled order cannot be marked paid by transfer");
assert.equal(order.payment_status, "unpaid", "cancelled order is left unpaid");

/* ── F. Staff-verified QR / bank transfer: dine-in only, no payment proof ─── */

// A dine-in transfer records Transfer — never Cash — through its own RPC. The
// single RPC call is the whole write: no proof row, no Messenger step.
order = { order_type: "dine_in", status: "preparing", payment_status: "unpaid" };
rpcLog = [];
p = await postMarkPaid(paidReq("Transfer"));
assert.equal(p.status, 200, "dine-in transfer succeeds");
assert.equal(rpcLog.length, 1, "one RPC call and nothing else");
assert.equal(rpcLog[0].rpc, "mark_order_paid_transfer", "Transfer uses the transfer RPC");
assert.equal(order.payment_status, "Paid", "order flips to Paid (Transfer)");
assert.equal(order.payment_method, "Transfer", "method is Transfer, never Cash");
assert.ok(order.paid_at, "paid_at stamped");
const transferPaidAt = order.paid_at;

// Replay is idempotent: paid_at not re-stamped, method unchanged.
p = await postMarkPaid(paidReq("Transfer"));
assert.equal((await p.json()).alreadyPaid, true, "transfer replay reports alreadyPaid");
assert.equal(order.paid_at, transferPaidAt, "transfer paid_at NOT re-stamped");
assert.equal(order.payment_method, "Transfer", "transfer replay keeps the method");

// PICKUP / DELIVERY transfers stay on the Messenger payment-proof flow: the
// RPC refuses them under its row lock, and the route answers a stable 409.
for (const type of ["pickup", "delivery"]) {
  order = { order_type: type, status: "preparing", payment_status: "unpaid" };
  p = await postMarkPaid(paidReq("Transfer"));
  assert.equal(p.status, 409, `${type} transfer refused server-side`);
  assert.equal(order.payment_status, "unpaid", `${type} transfer leaves the order unpaid`);
  assert.equal(order.paid_at, undefined, `${type} transfer stamps no paid_at`);
}

// A recorded payment is never rewritten, and the route REPORTS the method the
// row actually holds rather than the one that was requested. Both directions,
// because either can happen: a mis-tap, or two devices racing on one order.
order = { order_type: "dine_in", status: "preparing", payment_status: "unpaid" };
await postMarkPaid(paidReq("Cash"));
const cashFirstPaidAt = order.paid_at;
let replay = await (await postMarkPaid(paidReq("Transfer"))).json();
assert.equal(order.payment_method, "Cash", "Cash first wins — transfer never overwrites");
assert.equal(replay.paymentMethod, "Cash", "transfer replay reports the stored Cash method");
assert.equal(replay.alreadyPaid, true, "transfer replay on a Cash order reports alreadyPaid");
assert.equal(order.paid_at, cashFirstPaidAt, "Cash paid_at NOT re-stamped by a transfer");

order = { order_type: "dine_in", status: "preparing", payment_status: "unpaid" };
await postMarkPaid(paidReq("Transfer"));
const transferFirstPaidAt = order.paid_at;
replay = await (await postMarkPaid(paidReq("Cash"))).json();
assert.equal(order.payment_method, "Transfer", "Transfer first wins — cash never overwrites");
assert.equal(replay.paymentMethod, "Transfer", "cash replay reports the stored Transfer method");
assert.equal(replay.alreadyPaid, true, "cash replay on a Transfer order reports alreadyPaid");
assert.equal(order.paid_at, transferFirstPaidAt, "Transfer paid_at NOT re-stamped by cash");

// An unknown method is still rejected by the body schema, before any RPC.
order = { order_type: "dine_in", status: "preparing", payment_status: "unpaid" };
rpcLog = [];
p = await postMarkPaid(paidReq("Crypto"));
assert.equal(p.status, 400, "unknown payment method rejected");
assert.equal(rpcLog.length, 0, "rejected method never calls a paid RPC");
assert.equal(order.payment_status, "unpaid", "rejected method leaves the order unpaid");

// The shared STAFF_WRITE_SECRET gate still guards this route. Transfer was
// previously refused by the handler itself; now that it reaches an RPC, prove
// the header is what stands between an anonymous caller and a paid order.
order = { order_type: "dine_in", status: "preparing", payment_status: "unpaid" };
rpcLog = [];
for (const secret of [null, "wrong-secret"]) {
  const headers = { "Content-Type": "application/json" };
  if (secret !== null) headers["x-staff-secret"] = secret;
  const unauthorised = new Request("https://app.invalid/api/staff/mark-paid", {
    method: "POST",
    headers,
    body: JSON.stringify({ orderId: "TP-1", paymentMethod: "Transfer" }),
  });
  assert.equal((await postMarkPaid(unauthorised)).status, 401, "mark-paid needs the secret");
}
assert.equal(rpcLog.length, 0, "an unauthorised mark-paid never calls a paid RPC");
assert.equal(order.payment_status, "unpaid", "an unauthorised mark-paid writes nothing");

console.log("test-status-transitions: all assertions passed");
