import { timingSafeEqual } from "node:crypto";
import process from "node:process";
import { z } from "zod";

import { supabaseAuthHeaders } from "./supabaseAuth.js";

// Server-only staff write handlers — order actions (Phase 2G-D/2G-D2),
// add-expense (Phase 2G-G), and menu availability (Phase 2G-H).
//
// Each export is a complete web-standard (Request) => Response handler,
// consumed by TWO thin delegate layers so there is ONE implementation:
//   - src/routes/api.staff.*.ts — TanStack Start server routes (npm run dev)
//   - api/staff/*.ts            — native Vercel functions (production; the
//     Vercel deploy is a static SPA, so TanStack server routes don't run there)
//
// LIVES UNDER api/_lib (not src/) because Vercel's function builder only
// reliably compiles TypeScript inside api/; importing into src/ shipped an
// unresolvable extensionless ESM specifier and crashed at runtime
// (ERR_MODULE_NOT_FOUND — runbook 2G-D2). The underscore prefix keeps this
// from being exposed as a function route. api/staff/*.ts must import it
// WITH the ".js" extension (Node ESM does no extension resolution).
//
// DELIBERATELY SELF-CONTAINED: no "@/" alias imports, no import.meta.env —
// Vercel bundles api/*.ts outside vite, where neither exists. Only zod +
// process.env. Secrets (SUPABASE_SERVICE_ROLE_KEY, STAFF_WRITE_SECRET) are
// read inside handlers, never at module scope, never in any client bundle.
//
// NOT LIVE by default: ACTIVE_WRITE_SOURCE stays "n8n" (src/lib/data/
// dataSource.ts) — only the per-device localStorage override in
// orderRepository.ts sends traffic here. Every patch replicates the n8n
// workflow behavior in docs/n8n-workflow-side-effects.md rows 2–3.

// FROZEN order-status vocabulary (Tuesday) — mirrors ORDER_STATUS_VALUES in
// src/lib/data/contracts/orderContract.ts and the orders_status_check DB
// constraint. Kept local so the Vercel bundle needs no vite-alias import chain.
// The app and DB now share these words; there is no done⇄completed translation.
type OrderType = "dine_in" | "pickup" | "delivery";
type OrderStatus =
  | "new"
  | "accepted"
  | "preparing"
  | "ready_for_pickup"
  | "out_for_delivery"
  | "delivered"
  | "completed"
  | "cancelled";

const APP_STATUSES: readonly OrderStatus[] = [
  "new",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "out_for_delivery",
  "delivered",
  "completed",
  "cancelled",
];

/**
 * THE authoritative forward-transition table (per order type). Each non-
 * terminal state has EXACTLY ONE legal successor, so a requested status is
 * legal iff it equals this value. That single rule rejects skipped, backward,
 * repeated, and terminal-state transitions at once. "cancelled" is never a
 * successor here — cancellation goes through the dedicated cancel route.
 *   dine_in:  new → accepted → preparing → completed
 *   pickup:   new → accepted → preparing → ready_for_pickup → completed
 *   delivery: new → accepted → preparing → out_for_delivery → delivered → completed
 */
function nextStatusFor(orderType: OrderType, status: OrderStatus): OrderStatus | null {
  switch (status) {
    case "new":
      return "accepted";
    case "accepted":
      return "preparing";
    case "preparing":
      return orderType === "delivery"
        ? "out_for_delivery"
        : orderType === "pickup"
          ? "ready_for_pickup"
          : "completed"; // dine_in
    case "ready_for_pickup":
      return "completed";
    case "out_for_delivery":
      return "delivered";
    case "delivered":
      return "completed";
    default:
      return null; // completed, cancelled — terminal
  }
}

/** Uniform JSON error body — never includes stack traces or env values. */
export function jsonError(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}

/** 405 JSON for non-POST verbs — wired to GET/PUT/PATCH/DELETE on both surfaces. */
export function methodNotAllowed(): Response {
  return jsonError(405, "Method not allowed.");
}

/**
 * Constant-time shared-secret comparison. Plain `!==` on strings short-circuits
 * on the first differing byte, leaking a prefix-matching oracle through timing;
 * this uses the same crypto.timingSafeEqual the order-event JWT verifier
 * already relies on (orderEventJwt.server.ts). The length pre-check is
 * required (timingSafeEqual throws on unequal lengths) and is not itself a
 * meaningful leak for a high-entropy secret.
 * Shared with the Phase 3D bot-session secret check (botSession.server.ts).
 */
export function secretMatches(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Checks the x-staff-secret header against STAFF_WRITE_SECRET.
 * Returns a Response to send (401/500) or null when authorized.
 * Also used by the staff order-intake route (orderIntake.server.ts).
 * Phase 3D: the comparison is now timing-safe; status codes and messages are
 * deliberately UNCHANGED.
 */
export function checkStaffSecret(request: Request): Response | null {
  const secret = process.env.STAFF_WRITE_SECRET;
  if (!secret) return jsonError(500, "Server is not configured for staff writes.");
  if (!secretMatches(request.headers.get("x-staff-secret"), secret)) {
    return jsonError(401, "Unauthorized.");
  }
  return null;
}

/**
 * PATCHes the rows of `table` where `column` equals `value`. Returns the
 * number of rows updated, or a ready-to-send error Response (`failMessage`
 * is the safe client-facing error — never Supabase details).
 * VITE_SUPABASE_URL is public config; it reaches functions via process.env.
 */
async function patchRowsByColumn(
  table: string,
  column: string,
  value: string,
  patch: Record<string, unknown>,
  failMessage: string,
  /** Extra PostgREST filter appended to the URL, e.g. "&status=eq.new" — the
   *  optimistic-concurrency guard for status/payment transitions. Must be
   *  pre-encoded by the caller. */
  guardQuery = "",
): Promise<number | Response> {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return jsonError(500, "Server is not configured for staff writes.");
  try {
    const response = await fetch(
      `${url.replace(/\/+$/, "")}/rest/v1/${table}?${column}=eq.${encodeURIComponent(value)}${guardQuery}`,
      {
        method: "PATCH",
        headers: supabaseAuthHeaders(key, {
          "Content-Type": "application/json",
          Prefer: "return=representation",
        }),
        body: JSON.stringify(patch),
      },
    );
    if (!response.ok) {
      console.error(`Supabase staff write failed: ${table} responded ${response.status}`);
      return jsonError(500, failMessage);
    }
    const rows: unknown = await response.json();
    return Array.isArray(rows) ? rows.length : 0;
  } catch (error) {
    console.error("Supabase staff write failed", error);
    return jsonError(500, failMessage);
  }
}

/**
 * PATCHes the `orders` row matched by order_number (the frontend orderId,
 * "TP-…") — NEVER by the row UUID; a client-sent UUID simply matches nothing.
 */
const patchOrderByNumber = (
  orderNumber: string,
  patch: Record<string, unknown>,
  guardQuery = "",
): Promise<number | Response> =>
  patchRowsByColumn("orders", "order_number", orderNumber, patch, "Order update failed.", guardQuery);

/**
 * Reads a single order's guard-relevant columns by order_number (never by the
 * row UUID). Returns the row, null when the order does not exist, or a
 * ready-to-send error Response on a transport/config failure. The current
 * status and type are the inputs to the transition guard — read server-side so
 * a client can never assert its own "current" state.
 */
async function readOrderByNumber(
  orderNumber: string,
  columns: string,
): Promise<Record<string, unknown> | null | Response> {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return jsonError(500, "Server is not configured for staff writes.");
  try {
    const response = await fetch(
      `${url.replace(/\/+$/, "")}/rest/v1/orders?order_number=eq.${encodeURIComponent(orderNumber)}&select=${columns}&limit=1`,
      { method: "GET", headers: supabaseAuthHeaders(key) },
    );
    if (!response.ok) {
      console.error(`Supabase order read failed: responded ${response.status}`);
      return jsonError(502, "Order lookup failed.");
    }
    const rows: unknown = await response.json().catch(() => null);
    if (!Array.isArray(rows)) return jsonError(502, "Order lookup failed.");
    return (rows[0] as Record<string, unknown>) ?? null;
  } catch {
    // Never log the error object — a fetch error can carry the Supabase host.
    console.error("Supabase order read failed: unreachable");
    return jsonError(502, "Order lookup failed.");
  }
}

/**
 * Cancellation patch — mirrors the n8n Update Order Status workflow:
 * reason defaults to "Other", cancelled_at is stamped now.
 */
function cancelledPatch(reason?: string): Record<string, unknown> {
  return {
    status: "cancelled",
    cancellation_reason: reason?.trim() || "Other",
    cancelled_at: new Date().toISOString(),
  };
}

/* ── The three POST handlers ────────────────────────────────────────────── */

const updateStatusBody = z.object({
  orderId: z.string().min(1),
  status: z.string().min(1),
  cancellationReason: z.string().optional(),
});

/**
 * POST /api/staff/update-status — advances orders.status by EXACTLY ONE legal
 * step for the order's type (nextStatusFor). The current status and type are
 * read server-side, never trusted from the client, so a skipped, backward,
 * repeated, or terminal-state transition is rejected with a stable 409.
 *
 * Cancellation is NOT accepted here — it has its own route
 * (/api/staff/cancel-order) so the reason-capture flow stays in one place.
 *
 * Race-safe: the PATCH is guarded by status=eq.<currentStatus>, so a second
 * concurrent advance matches zero rows and gets the same 409 rather than
 * double-stepping.
 */
export async function postUpdateStatus(request: Request): Promise<Response> {
  const denied = checkStaffSecret(request);
  if (denied) return denied;

  const body = updateStatusBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "Invalid request body.");
  const { orderId, status } = body.data;
  if (!APP_STATUSES.includes(status as OrderStatus)) {
    return jsonError(400, `Unknown status "${status}".`);
  }
  if (status === "cancelled") {
    return jsonError(400, "Use the cancel action to cancel an order.");
  }

  const current = await readOrderByNumber(orderId, "order_type,status");
  if (current instanceof Response) return current;
  if (current === null) return jsonError(404, "Order not found.");

  const orderType = current.order_type as OrderType;
  const currentStatus = current.status as OrderStatus;
  const expected = nextStatusFor(orderType, currentStatus);
  if (expected === null) {
    return jsonError(409, `Order is already ${currentStatus} and cannot change.`);
  }
  if (status !== expected) {
    return jsonError(409, `Cannot change ${currentStatus} → ${status}.`);
  }

  // Guarded PATCH: only updates if the row is STILL at currentStatus.
  const updated = await patchOrderByNumber(
    orderId,
    { status, cancellation_reason: null, cancelled_at: null },
    `&status=eq.${encodeURIComponent(currentStatus)}`,
  );
  if (updated instanceof Response) return updated;
  if (updated === 0) {
    // The row moved between the read and the write (another device advanced it).
    return jsonError(409, "Order changed — refresh and try again.");
  }
  return Response.json({ ok: true, orderId, status });
}

const cancelOrderBody = z.object({
  orderId: z.string().min(1),
  reason: z.string().optional(),
});

/**
 * POST /api/staff/cancel-order — cancellation is reachable from any NON-terminal
 * state. A completed order can never be cancelled (money collected, food out);
 * an already-cancelled order returns idempotently without restamping the reason.
 */
export async function postCancelOrder(request: Request): Promise<Response> {
  const denied = checkStaffSecret(request);
  if (denied) return denied;

  const body = cancelOrderBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "Invalid request body.");
  const { orderId, reason } = body.data;

  const current = await readOrderByNumber(orderId, "status");
  if (current instanceof Response) return current;
  if (current === null) return jsonError(404, "Order not found.");
  const currentStatus = current.status as OrderStatus;
  if (currentStatus === "completed") {
    return jsonError(409, "A completed order cannot be cancelled.");
  }
  if (currentStatus === "cancelled") {
    // Idempotent: already cancelled, leave the original reason/timestamp intact.
    return Response.json({ ok: true, orderId, status: "cancelled" });
  }

  // Guarded PATCH: only cancels a row that is STILL non-terminal.
  const updated = await patchOrderByNumber(
    orderId,
    cancelledPatch(reason),
    `&status=eq.${encodeURIComponent(currentStatus)}`,
  );
  if (updated instanceof Response) return updated;
  if (updated === 0) return jsonError(409, "Order changed — refresh and try again.");
  return Response.json({ ok: true, orderId, status: "cancelled" });
}

const markPaidBody = z.object({
  orderId: z.string().min(1),
  // The schema still accepts the shape, but the handler refuses Transfer:
  // Transfer can ONLY become paid via approved payment-proof review.
  paymentMethod: z.enum(["Cash", "Transfer"]),
});

/**
 * POST /api/staff/mark-paid — the manual CASH-ONLY path. Transfer is refused
 * here (server-side, not just hidden in the UI): a Transfer becomes paid only
 * inside review_payment_proof after an approved slip. Delegates to the
 * mark_order_paid_cash RPC, which locks the order, refuses cancelled orders,
 * and is idempotent — paid_at is stamped once and never rewritten. No route
 * PATCHes paid_at directly (the paid_at-immutability trigger backs this).
 */
export async function postMarkPaid(request: Request): Promise<Response> {
  const denied = checkStaffSecret(request);
  if (denied) return denied;

  const body = markPaidBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "Invalid request body.");
  const { orderId, paymentMethod } = body.data;
  if (paymentMethod === "Transfer") {
    return jsonError(400, "Transfer must be confirmed by approving the customer's payment slip.");
  }

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return jsonError(500, "Server is not configured for staff writes.");
  const base = url.replace(/\/+$/, "");

  let response: globalThis.Response;
  try {
    response = await fetch(`${base}/rest/v1/rpc/mark_order_paid_cash`, {
      method: "POST",
      headers: supabaseAuthHeaders(key, { "Content-Type": "application/json" }),
      body: JSON.stringify({ p_order_number: orderId }),
    });
  } catch {
    console.error("mark_order_paid_cash RPC unreachable");
    return jsonError(502, "Payment update failed.");
  }

  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { message?: string } | null;
    const message = err?.message ?? `HTTP ${response.status}`;
    if (message.includes("ORDER_NOT_FOUND")) return jsonError(404, "Order not found.");
    if (message.includes("ORDER_CANCELLED")) return jsonError(409, "A cancelled order cannot be paid.");
    console.error(`mark_order_paid_cash rejected: ${message}`);
    return jsonError(502, "Payment update failed.");
  }

  const result = (await response.json().catch(() => null)) as { already_paid?: boolean } | null;
  return Response.json({
    ok: true,
    orderId,
    paymentStatus: "paid",
    paymentMethod: "Cash",
    alreadyPaid: result?.already_paid === true,
  });
}

/* ── Add expense (Phase 2G-G) ───────────────────────────────────────────── */

// Frozen frontend payload (snake_case — see src/lib/expenses.ts) with the
// app's closed vocabularies. Column mapping replicates the n8n Add Expense
// workflow (docs/schema-discovery-notes.md § Expenses): the display name goes
// to `description` (no item_name column), paid_from → payment_method,
// expense_date is the Bangkok-local service day.
const addExpenseBody = z.object({
  item_name: z.string().min(1),
  amount: z.number().positive().finite(),
  paid_from: z.enum(["Cash", "Transfer", "Owner Paid", "Other"]),
  category: z.enum(["Drinks", "Ingredient", "Stock Refill", "Utility", "Delivery", "Other"]),
  note: z.string().optional(),
  created_by: z.string().optional(),
});

/** Bangkok service-day date (yyyy-MM-dd) — same rule as the n8n insert. */
const bangkokToday = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

/** POST /api/staff/add-expense — INSERT into expenses; returns the row UUID. */
export async function postAddExpense(request: Request): Promise<Response> {
  const denied = checkStaffSecret(request);
  if (denied) return denied;

  const body = addExpenseBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "Invalid request body.");
  const { item_name, amount, paid_from, category, note, created_by } = body.data;

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return jsonError(500, "Server is not configured for staff writes.");
  try {
    const response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/expenses`, {
      method: "POST",
      headers: supabaseAuthHeaders(key, {
        "Content-Type": "application/json",
        Prefer: "return=representation",
      }),
      body: JSON.stringify({
        expense_date: bangkokToday(),
        category,
        description: item_name,
        amount,
        payment_method: paid_from,
        staff_name: created_by || "Staff",
        note: note || "",
      }),
    });
    if (!response.ok) {
      console.error(`Supabase expense insert failed: responded ${response.status}`);
      return jsonError(500, "Expense insert failed.");
    }
    const rows = (await response.json()) as { id?: string }[];
    return Response.json({ ok: true, expenseId: rows[0]?.id ?? null });
  } catch (error) {
    console.error("Supabase expense insert failed", error);
    return jsonError(500, "Expense insert failed.");
  }
}

/* ── Update menu availability (Phase 2G-H) ──────────────────────────────── */

// The app's frozen 3-state vocabulary (src/lib/menuAvailability.ts) and its
// DB mapping. DUAL-WRITE during the transition: availability_status is the
// new source of truth; the legacy is_available boolean is kept in sync so
// the n8n workflows and any pre-migration reader keep working (runbook
// 2G-H). Hidden intentionally maps to is_available=false — same as Sold Out
// on the boolean; only availability_status can tell them apart.
const updateMenuAvailabilityBody = z.object({
  menuItemId: z.string().min(1),
  availabilityStatus: z.enum(["Available", "Sold Out", "Hidden"]),
});

const AVAILABILITY_TO_DB = {
  Available: "available",
  "Sold Out": "sold_out",
  Hidden: "hidden",
} as const;

/**
 * POST /api/staff/update-menu-availability — sets availability_status AND
 * is_available on the `menu_items` row matched by item_code (the frontend
 * menuItemId, e.g. "B01"). REQUIRES the availability_status column (SQL
 * migration docs/sql/2026-07-14-2G-H-menu-availability-status.sql) — before
 * it exists, the PATCH fails with a safe 500 and no data is touched.
 */
export async function postUpdateMenuAvailability(request: Request): Promise<Response> {
  const denied = checkStaffSecret(request);
  if (denied) return denied;

  const body = updateMenuAvailabilityBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "Invalid request body.");
  const { menuItemId, availabilityStatus } = body.data;

  const updated = await patchRowsByColumn(
    "menu_items",
    "item_code",
    menuItemId,
    {
      availability_status: AVAILABILITY_TO_DB[availabilityStatus],
      is_available: availabilityStatus === "Available",
    },
    "Menu update failed.",
  );
  if (updated instanceof Response) return updated;
  if (updated === 0) return jsonError(404, "Menu item not found.");
  return Response.json({ ok: true, menuItemId, availabilityStatus });
}
