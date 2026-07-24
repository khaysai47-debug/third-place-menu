import process from "node:process";

import { z } from "zod";

import { verifyOrderEventJwt, type OrderEventChannel } from "./orderEventJwt.server.js";
import { jsonError } from "./staffOrderWrites.server.js";
import { supabaseAuthHeaders } from "./supabaseAuth.js";

// Server-only AUTHORITATIVE ORDER FETCH (Phase 3B) — n8n automation only.
//
// Same delivery pattern as orderIntake.server.ts: one implementation,
// consumed by the TanStack dev route (src/routes/api.automation.
// order-details.ts) and the native Vercel function (api/automation/
// order-details.ts). Self-contained: zod + process.env only.
//
// TRUST MODEL — the caller is the n8n order-automation workflow, which
// received a Phase 3A order.created event and forwards THE SAME short-lived
// Bearer JWT back here. The JWT is re-verified from scratch
// (orderEventJwt.server.ts) and must be BOUND to the request body: claims
// eventId/orderNumber must equal body eventId/orderNumber, so one token
// authorizes exactly one fetch of exactly one order — never a general query
// surface. n8n holds NO Supabase credential; this route reads Supabase with
// the server-only service-role key and returns a deliberately mapped payload
// (never raw rows, never Supabase errors).
//
// READ-ONLY GUARANTEE — this module performs exactly two GET requests
// (orders, order_items). No insert/update/upsert/delete/RPC exists here;
// scripts/test-order-details.mjs asserts every outgoing call is a GET.
//
// Never log the JWT, Authorization header, secret, or Supabase key — logs
// carry order number / event id / HTTP status only.

/* ── Validation limits (trust boundary — do not relax casually) ──────────── */

const MAX_BODY_BYTES = 1_024;

// eventId is the Phase 3A crypto.randomUUID(); orderNumber is "TP-…" /
// "TP-S-…". Both charsets exclude whitespace, so no trim ambiguity exists —
// padded or decorated values are simply rejected. .strict() rejects unknown
// fields (no smuggled filters/columns).
const detailsBody = z
  .object({
    eventId: z
      .string()
      .min(8)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/),
    orderNumber: z
      .string()
      .min(4)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/),
  })
  .strict();

/* ── Row mapping helpers (fail closed — never trust the row shape) ───────── */

// The bot/notification flow downstream will repeat these values to a
// customer, so malformed authoritative data must FAIL the request (502) —
// never be silently coerced (a junk total quietly becoming "0 THB" is worse
// than no message). Parsers return null on anything unexpected; the handler
// answers any null on a critical field with one generic 502.

const asStringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

/** Postgres numeric arrives as number or clean "150.00" string. Finite and non-negative only; junk → null. */
const parseMoney = (value: unknown): number | null => {
  const num =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+(\.\d+)?$/.test(value)
        ? Number(value)
        : null;
  return num !== null && Number.isFinite(num) && num >= 0 ? num : null;
};

const parseQuantity = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

// orders.source → the bridge's channel vocabulary (intake SQL: customer_menu
// for /api/order/submit, staff_manual for /api/staff/add-order). Legacy or
// unknown sources map to null rather than leaking the raw column value.
// instagram/messenger are Phase 3C forward mappings: NO current writer
// produces those source values — trusted bot sessions (Phase 3D) will set
// them server-side. Nothing client-controlled can reach this column.
const SOURCE_TO_CHANNEL: Record<string, OrderEventChannel> = {
  customer_menu: "customer",
  staff_manual: "staff",
  instagram: "instagram",
  messenger: "messenger",
};

// Explicit column lists — the response contract starts at the SELECT. No
// select=*, no client-supplied columns, ever.
const ORDER_COLUMNS =
  "id,order_number,order_type,status,source,table_number,customer_name," +
  "customer_phone,customer_address,customer_note,subtotal,delivery_fee," +
  "total,payment_method,payment_status,created_at";
const ITEM_COLUMNS = "item_code,item_name,quantity,unit_price,line_total";

/** One GET against PostgREST. Rows on success, null on ANY failure (logged as status only). */
async function supabaseGetRows(
  requestUrl: string,
  key: string,
  what: string,
): Promise<Record<string, unknown>[] | null> {
  try {
    const response = await fetch(requestUrl, {
      method: "GET",
      headers: supabaseAuthHeaders(key),
    });
    if (!response.ok) {
      console.error(`ORDER_DETAILS read failed: ${what} responded ${response.status}`);
      return null;
    }
    const rows: unknown = await response.json().catch(() => null);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : null;
  } catch {
    // Never log the error object — fetch errors can carry the URL.
    console.error(`ORDER_DETAILS read failed: ${what} unreachable`);
    return null;
  }
}

/* ── The handler ─────────────────────────────────────────────────────────── */

/**
 * POST /api/automation/order-details — server-to-server only (no CORS
 * headers on purpose; browsers have no business here). Auth first, then
 * body, then token↔body binding, then two Supabase GETs, then the mapped
 * response. Every auth failure is the same generic 401.
 */
export async function postOrderDetails(request: Request): Promise<Response> {
  const secret = process.env.N8N_AUTOMATION_SECRET;
  if (!secret) return jsonError(500, "Server is not configured for order automation.");

  // Exact scheme "Bearer <jwt>". A repeated Authorization header arrives
  // comma-joined from Headers.get and fails token verification (base64url
  // segments admit no commas or spaces).
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  const claims = token ? verifyOrderEventJwt(token, secret) : null;
  if (!claims) return jsonError(401, "Unauthorized.");

  // Exact media type (parameters like "; charset=utf-8" allowed) — a
  // substring check would accept "text/application/json" or "application/jsonp".
  const mediaType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return jsonError(415, "Unsupported content type.");
  }
  const raw = await request.text().catch(() => null);
  // Real UTF-8 bytes, not JS characters — multibyte padding must not slip under the cap.
  if (raw === null || Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return jsonError(413, "Request too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return jsonError(400, "Invalid request body.");
  }
  const body = detailsBody.safeParse(parsed);
  if (!body.success) return jsonError(400, "Invalid request body.");
  const { eventId, orderNumber } = body.data;

  // Token↔body binding: the JWT authorizes THIS event's order and nothing else.
  if (claims.eventId !== eventId || claims.orderNumber !== orderNumber) {
    return jsonError(401, "Unauthorized.");
  }

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return jsonError(500, "Server is not configured for order automation.");
  const base = url.replace(/\/+$/, "");

  const orders = await supabaseGetRows(
    `${base}/rest/v1/orders?order_number=eq.${encodeURIComponent(orderNumber)}` +
      `&select=${ORDER_COLUMNS}&limit=1`,
    key,
    "orders",
  );
  if (orders === null) return jsonError(502, "Order lookup failed.");
  const order = orders[0];
  if (!order) return jsonError(404, "Order not found.");

  // Fail closed on a malformed authoritative row: found-but-broken is a 502
  // (upstream problem), never a 404 and never a coerced success. Log names
  // the field, response stays generic.
  const invalidOrder = (field: string): Response => {
    console.error(`ORDER_DETAILS invalid order row for ${orderNumber}: ${field}`);
    return jsonError(502, "Order lookup failed.");
  };
  const orderId = asStringOrNull(order.id);
  if (!orderId) return invalidOrder("id");
  if (order.order_number !== orderNumber) return invalidOrder("order_number");
  const subtotal = parseMoney(order.subtotal);
  // delivery_fee 0 for non-delivery orders; NULL on legacy rows means the
  // same "no fee" — the only nullable money column we accept as 0.
  const deliveryFee = order.delivery_fee == null ? 0 : parseMoney(order.delivery_fee);
  const total = parseMoney(order.total);
  if (subtotal === null) return invalidOrder("subtotal");
  if (deliveryFee === null) return invalidOrder("delivery_fee");
  if (total === null) return invalidOrder("total");

  const itemRows = await supabaseGetRows(
    `${base}/rest/v1/order_items?order_id=eq.${encodeURIComponent(orderId)}` +
      `&select=${ITEM_COLUMNS}&order=created_at.asc`,
    key,
    "order_items",
  );
  if (itemRows === null) return jsonError(502, "Order lookup failed.");
  // Intake writes orders + items in one transaction — an itemless order is a
  // broken row set, and any malformed line fails the WHOLE response.
  if (itemRows.length === 0) return invalidOrder("no items");
  const items = [];
  for (const row of itemRows) {
    const itemName = asStringOrNull(row.item_name);
    const quantity = parseQuantity(row.quantity);
    const unitPrice = parseMoney(row.unit_price);
    const lineTotal = parseMoney(row.line_total);
    if (!itemName) return invalidOrder("item_name");
    if (quantity === null) return invalidOrder("quantity");
    if (unitPrice === null) return invalidOrder("unit_price");
    if (lineTotal === null) return invalidOrder("line_total");
    items.push({
      itemCode: asStringOrNull(row.item_code),
      itemName,
      quantity,
      unitPrice,
      lineTotal,
    });
  }

  console.log(`ORDER_DETAILS ${orderNumber} event=${eventId} items=${items.length}`);

  // The safe response contract — versioned by shape, mapped field by field.
  // Adding a field here is a deliberate contract change, never an accident.
  return Response.json({
    ok: true,
    data: {
      eventId,
      order: {
        orderNumber,
        channel: SOURCE_TO_CHANNEL[asStringOrNull(order.source) ?? ""] ?? null,
        orderType: asStringOrNull(order.order_type),
        status: asStringOrNull(order.status),
        paymentStatus: asStringOrNull(order.payment_status),
        paymentMethod: asStringOrNull(order.payment_method),
        customerName: asStringOrNull(order.customer_name),
        customerPhone: asStringOrNull(order.customer_phone),
        deliveryAddress: asStringOrNull(order.customer_address),
        tableNumber: asStringOrNull(order.table_number),
        customerNote: asStringOrNull(order.customer_note),
        subtotal,
        deliveryFee,
        total,
        createdAt: asStringOrNull(order.created_at),
      },
      items,
    },
  });
}
