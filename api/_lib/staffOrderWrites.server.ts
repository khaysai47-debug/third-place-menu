import process from "node:process";
import { z } from "zod";

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

// Wire vocabulary of these routes — the app's 7 statuses (must mirror
// ORDER_STATUS_VALUES in src/lib/data/contracts/orderContract.ts; kept local
// so the Vercel bundle needs no vite-alias import chain). The DB stores
// "completed" where the app says "done" (orderMapper.ts, confirmed Phase 2B).
const APP_STATUSES = [
  "new",
  "preparing",
  "ready",
  "out_for_delivery",
  "delivered",
  "done",
  "cancelled",
] as const;

const statusToDb = (status: string): string => (status === "done" ? "completed" : status);

/** Uniform JSON error body — never includes stack traces or env values. */
function jsonError(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}

/** 405 JSON for non-POST verbs — wired to GET/PUT/PATCH/DELETE on both surfaces. */
export function methodNotAllowed(): Response {
  return jsonError(405, "Method not allowed.");
}

/**
 * Checks the x-staff-secret header against STAFF_WRITE_SECRET.
 * Returns a Response to send (401/500) or null when authorized.
 */
function checkStaffSecret(request: Request): Response | null {
  const secret = process.env.STAFF_WRITE_SECRET;
  if (!secret) return jsonError(500, "Server is not configured for staff writes.");
  if (request.headers.get("x-staff-secret") !== secret) {
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
): Promise<number | Response> {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return jsonError(500, "Server is not configured for staff writes.");
  try {
    const response = await fetch(
      `${url.replace(/\/+$/, "")}/rest/v1/${table}?${column}=eq.${encodeURIComponent(value)}`,
      {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
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
): Promise<number | Response> =>
  patchRowsByColumn("orders", "order_number", orderNumber, patch, "Order update failed.");

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
 * POST /api/staff/update-status — writes orders.status. Non-cancel statuses
 * reset the cancellation fields to null; "cancelled" stamps reason +
 * cancelled_at (exact n8n Update Order Status behavior).
 */
export async function postUpdateStatus(request: Request): Promise<Response> {
  const denied = checkStaffSecret(request);
  if (denied) return denied;

  const body = updateStatusBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "Invalid request body.");
  const { orderId, status, cancellationReason } = body.data;
  if (!APP_STATUSES.includes(status as (typeof APP_STATUSES)[number])) {
    return jsonError(400, `Unknown status "${status}".`);
  }

  const patch =
    status === "cancelled"
      ? cancelledPatch(cancellationReason)
      : { status: statusToDb(status), cancellation_reason: null, cancelled_at: null };
  const updated = await patchOrderByNumber(orderId, patch);
  if (updated instanceof Response) return updated;
  if (updated === 0) return jsonError(404, "Order not found.");
  return Response.json({ ok: true, orderId, status });
}

const cancelOrderBody = z.object({
  orderId: z.string().min(1),
  reason: z.string().optional(),
});

/** POST /api/staff/cancel-order — same DB write n8n performs for "cancelled". */
export async function postCancelOrder(request: Request): Promise<Response> {
  const denied = checkStaffSecret(request);
  if (denied) return denied;

  const body = cancelOrderBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "Invalid request body.");
  const { orderId, reason } = body.data;

  const updated = await patchOrderByNumber(orderId, cancelledPatch(reason));
  if (updated instanceof Response) return updated;
  if (updated === 0) return jsonError(404, "Order not found.");
  return Response.json({ ok: true, orderId, status: "cancelled" });
}

const markPaidBody = z.object({
  orderId: z.string().min(1),
  paymentMethod: z.enum(["Cash", "Transfer"]),
});

/**
 * POST /api/staff/mark-paid — payment_status "Paid", payment_method verbatim,
 * paid_at now (exact n8n Update Payment behavior). Cash/Transfer only.
 */
export async function postMarkPaid(request: Request): Promise<Response> {
  const denied = checkStaffSecret(request);
  if (denied) return denied;

  const body = markPaidBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "Invalid request body.");
  const { orderId, paymentMethod } = body.data;

  const updated = await patchOrderByNumber(orderId, {
    payment_status: "Paid",
    payment_method: paymentMethod,
    paid_at: new Date().toISOString(),
  });
  if (updated instanceof Response) return updated;
  if (updated === 0) return jsonError(404, "Order not found.");
  return Response.json({ ok: true, orderId, paymentStatus: "paid", paymentMethod });
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
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
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
