import process from "node:process";

import { checkStaffSecret, jsonError } from "./staffOrderWrites.server.js";
import { supabaseAuthHeaders } from "./supabaseAuth.js";

// Server-only PROTECTED DASHBOARD READS (Pre-Pilot Security Hardening).
//
// WHY: until this phase, the staff board and owner dashboard read orders,
// order_items, payment_proofs, and expenses straight from the browser with
// the anon key (permissive anon SELECT policies from the Phase 2D/2E parity
// setup). That exposed customer PII and money data to anyone holding the
// anon key — which ships in the client bundle. These routes move those reads
// behind the existing x-staff-secret model; the companion migration
// (docs/sql/2026-07-17-pre-pilot-security-hardening.sql) then removes the
// anon SELECT access. menu_items is NOT here: the public customer menu keeps
// its column-limited anon read (2G-H) by design.
//
// Same delivery pattern as staffOrderWrites.server.ts: ONE implementation,
// consumed by the TanStack dev routes (src/routes/api.staff.orders.ts,
// api.staff.expenses.ts) and the native Vercel functions (api/staff/
// orders.ts, expenses.ts). Self-contained: process.env only.
//
// CONTRACT — the response carries EXACTLY the columns the frontend mappers
// consume (src/lib/data/mappers/orderMapper.ts SupabaseOrderRow/ItemRow/
// ProofRow and expenseMapper.ts SupabaseExpenseRow). Rows are copied
// FIELD-BY-FIELD from an explicit-column SELECT, never spread — a column
// added to the DB (or over-returned by PostgREST) can never leak. The
// client keeps its existing defensive mappers, so dashboard data is
// byte-equivalent to the old anon read of the same columns
// (scripts/test-dashboard-parity.mjs proves it).
//
// READ-ONLY: this module performs only GETs; no insert/update/delete/RPC
// exists here (scripts/test-staff-dashboard.mjs asserts it). Never log the
// secret or the Supabase key — logs carry counts and HTTP statuses only.

/* ── The explicit column contracts (mirror the mapper row types) ─────────── */

// orders → SupabaseOrderRow (orderMapper.ts). Deliberately absent: source,
// client_request_id, airtable_record_id, delivery_zone_id,
// delivery_location_name, updated_at — the dashboard never reads them.
const ORDER_FIELDS = [
  "id",
  "order_number",
  "order_type",
  "status",
  "table_number",
  "customer_name",
  "customer_phone",
  "customer_address",
  "customer_note",
  "subtotal",
  "delivery_fee",
  "total",
  "payment_method",
  "payment_status",
  "created_at",
  "paid_at",
  "cancellation_reason",
  "cancelled_at",
] as const;

// order_items → SupabaseOrderItemRow. order_id is the join key; line order
// comes from the SELECT's order=created_at.asc (column readable by
// service_role without being selected).
const ORDER_ITEM_FIELDS = ["order_id", "item_code", "item_name", "quantity", "unit_price"] as const;

// payment_proofs → SupabasePaymentProofRow (latest-proof sort needs
// received_at/created_at).
const PAYMENT_PROOF_FIELDS = [
  "order_id",
  "proof_url",
  "status",
  "received_at",
  "created_at",
] as const;

// expenses → SupabaseExpenseRow (expense_date is only the server-side day
// filter, same window the old anon read used).
const EXPENSE_FIELDS = [
  "id",
  "category",
  "description",
  "amount",
  "payment_method",
  "staff_name",
  "note",
  "created_at",
] as const;

/** Copies exactly `fields` from each row — unknown/extra columns never pass. */
function pickRows(
  rows: Record<string, unknown>[],
  fields: readonly string[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const field of fields) out[field] = row[field] ?? null;
    return out;
  });
}

/** Bangkok service-day date (yyyy-MM-dd) — same day window as the old read. */
const bangkokToday = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

/* ── One GET against PostgREST (service-role, explicit columns only) ─────── */

async function supabaseGetRows(
  base: string,
  key: string,
  table: string,
  query: string,
): Promise<Record<string, unknown>[] | null> {
  try {
    const response = await fetch(`${base}/rest/v1/${table}?${query}`, {
      method: "GET",
      headers: supabaseAuthHeaders(key),
    });
    if (!response.ok) {
      console.error(`DASHBOARD_READ failed: ${table} responded ${response.status}`);
      return null;
    }
    const rows: unknown = await response.json().catch(() => null);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : null;
  } catch {
    // Never log the error object — fetch errors can carry the URL.
    console.error(`DASHBOARD_READ failed: ${table} unreachable`);
    return null;
  }
}

const noStore = (body: unknown): Response =>
  Response.json(body, { headers: { "Cache-Control": "no-store" } });

type ServerEnv = { base: string; key: string } | Response;

function requireEnv(): ServerEnv {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return jsonError(500, "Server is not configured for staff reads.");
  return { base: url.replace(/\/+$/, ""), key };
}

/* ── The two GET handlers ────────────────────────────────────────────────── */

/**
 * GET /api/staff/orders — the staff board / owner dashboard order snapshot:
 * all orders + order_items + payment_proofs (same unbounded window as the
 * old anon read; the client joins and maps exactly as before).
 * Requires x-staff-secret. Any Supabase failure → one generic 502.
 * ponytail: three unbounded selects — add date filters when volume demands.
 */
export async function getStaffOrders(request: Request): Promise<Response> {
  const denied = checkStaffSecret(request);
  if (denied) return denied;
  const env = requireEnv();
  if (env instanceof Response) return env;

  const [orders, items, proofs] = await Promise.all([
    supabaseGetRows(env.base, env.key, "orders", `select=${ORDER_FIELDS.join(",")}`),
    supabaseGetRows(
      env.base,
      env.key,
      "order_items",
      `select=${ORDER_ITEM_FIELDS.join(",")}&order=created_at.asc`,
    ),
    supabaseGetRows(
      env.base,
      env.key,
      "payment_proofs",
      `select=${PAYMENT_PROOF_FIELDS.join(",")}`,
    ),
  ]);
  if (orders === null || items === null || proofs === null) {
    return jsonError(502, "Dashboard read failed.");
  }

  console.log(
    `DASHBOARD_READ orders=${orders.length} items=${items.length} proofs=${proofs.length}`,
  );
  return noStore({
    ok: true,
    data: {
      orders: pickRows(orders, ORDER_FIELDS),
      orderItems: pickRows(items, ORDER_ITEM_FIELDS),
      paymentProofs: pickRows(proofs, PAYMENT_PROOF_FIELDS),
    },
  });
}

/**
 * GET /api/staff/expenses — TODAY's expenses (Bangkok expense_date), the
 * same window the old anon read used. Requires x-staff-secret.
 */
export async function getStaffExpenses(request: Request): Promise<Response> {
  const denied = checkStaffSecret(request);
  if (denied) return denied;
  const env = requireEnv();
  if (env instanceof Response) return env;

  const expenses = await supabaseGetRows(
    env.base,
    env.key,
    "expenses",
    `select=${EXPENSE_FIELDS.join(",")}&expense_date=eq.${bangkokToday()}`,
  );
  if (expenses === null) return jsonError(502, "Dashboard read failed.");

  console.log(`DASHBOARD_READ expenses=${expenses.length}`);
  return noStore({ ok: true, data: { expenses: pickRows(expenses, EXPENSE_FIELDS) } });
}
