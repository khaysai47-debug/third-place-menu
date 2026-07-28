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

// payment_proofs on the DASHBOARD POLL: metadata ONLY — no URL of any kind.
// proof_url is not even SELECTed: on legacy n8n rows it holds a PERMANENT
// public link, and this contract must never hand one to a client. proof_file_
// path is not SELECTed either, so the private storage key stays server-side.
// Every preview comes from getProofHistory, signed on demand.
const PAYMENT_PROOF_FIELDS = [
  "id",
  "order_id",
  "status",
  "received_at",
  "created_at",
  "rejection_reason",
] as const;

// Full per-order proof history (getProofHistory) — proof_file_path is SELECTed
// (to sign) but never returned. Order deterministically by time.
const PROOF_HISTORY_SELECT = [
  "id",
  "proof_file_path",
  "status",
  "source",
  "received_at",
  "created_at",
  "reviewed_at",
  "reviewed_by",
  "rejection_reason",
] as const;

// The history RESPONSE contract. proof_url here is ALWAYS a freshly signed,
// short-lived URL derived from proof_file_path — never a stored value; the
// legacy proof_url column is not read at all. hasFile tells the UI whether a
// private object exists, so it can distinguish "legacy row, no preview
// possible" (hasFile false) from "signing failed, try again" (hasFile true,
// proof_url null).
const PROOF_HISTORY_FIELDS = [
  "id",
  "proof_url",
  "hasFile",
  "status",
  "source",
  "received_at",
  "created_at",
  "reviewed_at",
  "reviewed_by",
  "rejection_reason",
] as const;

/** Private bucket holding chat payment slips (see paymentIntake.server.ts). */
const proofBucket = (): string => process.env.PAYMENT_PROOFS_BUCKET || "payment-proofs";

/** Signed-URL lifetime — long enough for a staff review, short enough to expire. */
const PROOF_URL_TTL_SECONDS = 600;

/**
 * Sets proof_url to a freshly SIGNED, short-lived url for every proof that has
 * a private-storage proof_file_path, and hasFile so the UI knows which case it
 * is looking at.
 *
 * A LEGACY row (no proof_file_path — written by the old n8n workflow, which
 * stored a permanent public link in proof_url) gets proof_url null and hasFile
 * false: the permanent link is NEVER returned, and the drawer shows "legacy
 * proof preview unavailable" instead. Migrating those old objects into the
 * private bucket is optional and manual (see docs/payment-proof-tuesday.md).
 * Signing failures also yield null, but with hasFile true.
 */
async function signProofUrls(
  base: string,
  key: string,
  proofs: Record<string, unknown>[],
): Promise<void> {
  const bucket = proofBucket();
  await Promise.all(
    proofs.map(async (proof) => {
      const path = proof.proof_file_path;
      proof.proof_url = null;
      proof.hasFile = typeof path === "string" && path !== "";
      if (typeof path !== "string" || path === "") return; // legacy row
      try {
        const response = await fetch(
          `${base}/storage/v1/object/sign/${bucket}/${encodeURI(path)}`,
          {
            method: "POST",
            headers: supabaseAuthHeaders(key, { "Content-Type": "application/json" }),
            body: JSON.stringify({ expiresIn: PROOF_URL_TTL_SECONDS }),
          },
        );
        if (!response.ok) {
          proof.proof_url = null;
          return;
        }
        const body = (await response.json().catch(() => null)) as { signedURL?: string } | null;
        proof.proof_url =
          typeof body?.signedURL === "string" ? `${base}/storage/v1${body.signedURL}` : null;
      } catch {
        proof.proof_url = null;
      }
    }),
  );
}

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

  // No signing on the poll — the drawer signs the selected order's history on
  // demand (getProofHistory). The dashboard shows proof STATUS only.

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

// order_number charset — mirrors the intake formats (TP-/TP-S-/TP-IG-/TP-MS-).
const ORDER_NUMBER_PATTERN = /^[A-Za-z0-9-]{1,32}$/;

/**
 * GET /api/staff/proof-history?order=<order_number> — the FULL proof audit
 * history for ONE order (oldest → newest): every pending / rejected / approved
 * proof with reviewer + time + reason, each with a SHORT-LIVED SIGNED preview
 * URL. Signing happens ONLY here (staff opened the order), never on the poll.
 * proof_file_path is never returned. Requires x-staff-secret.
 */
export async function getProofHistory(request: Request): Promise<Response> {
  const denied = checkStaffSecret(request);
  if (denied) return denied;
  const env = requireEnv();
  if (env instanceof Response) return env;

  const orderNumber = new URL(request.url).searchParams.get("order") ?? "";
  if (!ORDER_NUMBER_PATTERN.test(orderNumber)) {
    return jsonError(400, "Invalid order.");
  }

  // Resolve order_number → id (the join key), server-side.
  const orders = await supabaseGetRows(
    env.base,
    env.key,
    "orders",
    `select=id&order_number=eq.${encodeURIComponent(orderNumber)}&limit=1`,
  );
  if (orders === null) return jsonError(502, "Proof history read failed.");
  const orderId = typeof orders[0]?.id === "string" ? (orders[0].id as string) : null;
  if (!orderId) return jsonError(404, "Order not found.");

  const proofs = await supabaseGetRows(
    env.base,
    env.key,
    "payment_proofs",
    `select=${PROOF_HISTORY_SELECT.join(",")}&order_id=eq.${encodeURIComponent(orderId)}` +
      `&order=created_at.asc`,
  );
  if (proofs === null) return jsonError(502, "Proof history read failed.");

  // Sign on demand (only this order's proofs), then drop the storage key.
  await signProofUrls(env.base, env.key, proofs);

  console.log(`PROOF_HISTORY ${orderNumber} proofs=${proofs.length}`);
  return noStore({ ok: true, data: { proofs: pickRows(proofs, PROOF_HISTORY_FIELDS) } });
}
