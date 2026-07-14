import { createHmac, randomUUID } from "node:crypto";
import process from "node:process";

import { waitUntil } from "@vercel/functions";
import { z } from "zod";

import { checkStaffSecret, jsonError } from "./staffOrderWrites.server.js";

// Server-only ORDER INTAKE (Phase 2G-I) — customer checkout + Staff Add Order.
//
// Same delivery pattern as staffOrderWrites.server.ts: one implementation,
// consumed by the TanStack dev routes (src/routes/api.order.submit.ts,
// api.staff.add-order.ts) and the native Vercel functions (api/order/
// submit.ts, api/staff/add-order.ts). Self-contained: zod + process.env only.
//
// TRUST MODEL — the browser sends ONLY item codes + quantities + order-type
// details. It is never trusted for prices, item names, line totals, subtotal,
// delivery fee, total, availability, or the order number. All of that is
// computed inside the create_order_with_items Postgres function
// (docs/sql/2026-07-14-2G-I-order-intake.sql), which inserts orders +
// order_items in ONE transaction and is callable by service_role only.
// Client-sent money fields, if present, are not even parsed (zod strips them).
//
// IDEMPOTENCY — the frontend generates one requestId per intended order and
// reuses it on retries; the function's unique client_request_id returns the
// original order instead of duplicating (double-tap / network-retry safe).

/* ── Validation limits (trust boundary — do not relax casually) ──────────── */

const MAX_BODY_BYTES = 16_384;
const MAX_QTY_PER_ITEM = 20;
const MAX_CART_LINES = 30;
const MAX_TOTAL_ITEMS = 60;

const intakeBody = z.object({
  requestId: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/),
  orderType: z.enum(["dine_in", "pickup", "delivery"]),
  tableNumber: z.string().max(20).nullish(),
  customerName: z.string().max(80).nullish(),
  customerPhone: z.string().max(30).nullish(),
  customerAddress: z.string().max(300).nullish(),
  notes: z.string().max(500).nullish(),
  items: z
    .array(
      z.object({
        itemCode: z
          .string()
          .min(1)
          .max(20)
          .regex(/^[A-Za-z0-9_-]+$/),
        quantity: z.number().int().min(1).max(MAX_QTY_PER_ITEM),
      }),
    )
    .min(1)
    .max(MAX_CART_LINES),
});

/* ── RPC error → safe client message ─────────────────────────────────────── */

// The Postgres function raises machine-readable ORDER_* messages with the
// offending item_code in DETAIL. Item codes are public menu data — safe to
// echo. Anything unrecognized becomes a generic 500 (no Supabase details).
const ITEM_ERRORS: Record<string, string> = {
  ORDER_ITEM_UNKNOWN: "is no longer on the menu",
  ORDER_ITEM_UNAVAILABLE: "just sold out",
  ORDER_ITEM_UNPRICED: "is not orderable right now",
};

function mapRpcError(message: string, detail: string): Response {
  const suffix = ITEM_ERRORS[message];
  if (suffix) {
    return jsonError(
      409,
      `Item ${detail} ${suffix} — please remove it from your cart and try again.`,
    );
  }
  console.error(`Order intake RPC rejected: ${message} ${detail}`);
  return jsonError(500, "Order could not be created. Please try again.");
}

/* ── Optional post-order automation bridge (Phase 3A) ────────────────────── */

// Fires ONLY when BOTH N8N_ORDER_AUTOMATION_WEBHOOK_URL and
// N8N_AUTOMATION_SECRET are set — otherwise skipped silently. NEVER point
// the URL at the old order-intake webhook (third-place-order-test) — its
// workflow INSERTS an order and would duplicate every order. It must be a
// NEW automation-only workflow (docs/n8n-workflow-side-effects.md § Phase 3A).
//
// Best-effort by design: runs AFTER the DB transaction succeeded, kept alive
// past the HTTP response via Vercel waitUntil (no-op outside Vercel — the
// long-lived dev server just lets the promise finish), and can never change
// the order result. Payload carries identifiers only (no customer data, no
// money, no secrets); n8n fetches the authoritative order from Supabase
// itself. Auth: a short-lived HS256 JWT (Authorization: Bearer) checked by
// n8n's built-in Webhook JWT Auth — the secret is the JWT
// credential's passphrase, never inside workflow code. Recipe in
// docs/backend-separation-runbook.md § Phase 3A. Never log the URL, secret,
// or JWT — logs carry event id / order number / status only.

const AUTOMATION_TIMEOUT_MS = 5_000;

export type OrderCreatedEvent = {
  eventId: string;
  eventType: "order.created";
  occurredAt: string;
  orderNumber: string;
  channel: "customer" | "staff";
};

/**
 * HS256 JWT over the order event, node:crypto only (no jwt dependency).
 * 120 s lifetime, 5 s nbf backdate for clock skew. Exported for the
 * standalone check (scripts/test-automation-bridge.mjs).
 */
export function buildOrderEventJwt(event: OrderCreatedEvent, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: "atlas-order-bridge",
      aud: "n8n-order-automation",
      sub: "order.created",
      jti: event.eventId,
      iat: now,
      nbf: now - 5,
      exp: now + 120,
      ...event,
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function fireOrderAutomation(orderNumber: string, channel: "customer" | "staff"): void {
  const hook = process.env.N8N_ORDER_AUTOMATION_WEBHOOK_URL;
  const secret = process.env.N8N_AUTOMATION_SECRET;
  if (!hook || !secret) return;

  const event: OrderCreatedEvent = {
    eventId: randomUUID(),
    eventType: "order.created",
    occurredAt: new Date().toISOString(),
    orderNumber,
    channel,
  };
  const eventId = event.eventId;
  const jwt = buildOrderEventJwt(event, secret);

  waitUntil(
    fetch(hook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
        "x-atlas-event-id": eventId,
        "x-atlas-timestamp": event.occurredAt,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(AUTOMATION_TIMEOUT_MS),
    }).then(
      (res) => {
        console.log(
          `ORDER_AUTOMATION ${orderNumber} event=${eventId} status=${res.status} ${res.ok ? "delivered" : "rejected"}`,
        );
      },
      (error: unknown) => {
        // error.name only (TimeoutError/AbortError/TypeError) — fetch error
        // messages/causes can contain the webhook hostname.
        console.error(
          `ORDER_AUTOMATION ${orderNumber} event=${eventId} failed: ${error instanceof Error ? error.name : "error"}`,
        );
      },
    ),
  );
}

/* ── The intake handler ──────────────────────────────────────────────────── */

async function handleIntake(request: Request, channel: "customer" | "staff"): Promise<Response> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return jsonError(415, "Unsupported content type.");
  }
  const raw = await request.text().catch(() => null);
  if (raw === null || raw.length > MAX_BODY_BYTES) {
    return jsonError(413, "Request too large.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return jsonError(400, "Invalid request body.");
  }
  const body = intakeBody.safeParse(parsed);
  if (!body.success) return jsonError(400, "Invalid request body.");
  const { requestId, orderType, notes } = body.data;

  // Required-fields per order type. dine_in deliberately drops any leftover
  // customer/delivery data from a prior order-type selection (the DB function
  // enforces the same rule again on insert).
  const tableNumber = body.data.tableNumber?.trim() || null;
  const customerName = orderType === "dine_in" ? null : body.data.customerName?.trim() || null;
  const customerPhone = orderType === "dine_in" ? null : body.data.customerPhone?.trim() || null;
  const customerAddress =
    orderType === "delivery" ? body.data.customerAddress?.trim() || null : null;

  if (orderType === "dine_in" && !tableNumber) {
    return jsonError(400, "Table number is required.");
  }
  if (orderType !== "dine_in" && (!customerName || !customerPhone)) {
    return jsonError(400, "Name and phone are required.");
  }
  if (orderType === "delivery" && !customerAddress) {
    return jsonError(400, "Delivery address is required.");
  }

  // Combine duplicate item codes safely (sum quantities), enforce caps.
  const combined = new Map<string, number>();
  for (const item of body.data.items) {
    combined.set(item.itemCode, (combined.get(item.itemCode) ?? 0) + item.quantity);
  }
  let totalItems = 0;
  const items: { item_code: string; quantity: number }[] = [];
  for (const [itemCode, quantity] of combined) {
    if (quantity > MAX_QTY_PER_ITEM) {
      return jsonError(400, `Too many of item ${itemCode} (max ${MAX_QTY_PER_ITEM}).`);
    }
    totalItems += quantity;
    items.push({ item_code: itemCode, quantity });
  }
  if (totalItems > MAX_TOTAL_ITEMS) {
    return jsonError(400, `Too many items in one order (max ${MAX_TOTAL_ITEMS}).`);
  }

  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return jsonError(500, "Server is not configured for order intake.");

  let response: globalThis.Response;
  try {
    response = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/create_order_with_items`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_channel: channel,
        p_client_request_id: requestId,
        p_order_type: orderType,
        p_table_number: tableNumber,
        p_customer_name: customerName,
        p_customer_phone: customerPhone,
        p_customer_address: customerAddress,
        p_customer_note: notes?.trim() || null,
        p_items: items,
      }),
    });
  } catch (error) {
    console.error("Order intake RPC unreachable", error);
    return jsonError(500, "Order could not be created. Please try again.");
  }

  if (!response.ok) {
    // PostgREST error body: { message, details, ... } — map, never leak.
    const err = (await response.json().catch(() => null)) as {
      message?: string;
      details?: string;
    } | null;
    return mapRpcError(err?.message ?? `HTTP ${response.status}`, err?.details ?? "");
  }

  const result = (await response.json().catch(() => null)) as {
    order_number?: string;
    subtotal?: number;
    delivery_fee?: number;
    total?: number;
    duplicate?: boolean;
  } | null;
  if (!result || typeof result.order_number !== "string") {
    console.error("Order intake RPC returned an unexpected shape");
    return jsonError(500, "Order could not be created. Please try again.");
  }

  // Debuggable without customer data: order number, channel, sizes only.
  console.log(
    `ORDER_INTAKE ${channel} ${result.order_number} type=${orderType} lines=${items.length} total=${result.total}${result.duplicate ? " (idempotent replay)" : ""}`,
  );

  if (!result.duplicate) fireOrderAutomation(result.order_number, channel);

  return Response.json({
    ok: true,
    orderNumber: result.order_number,
    subtotal: result.subtotal,
    deliveryFee: result.delivery_fee,
    total: result.total,
    duplicate: result.duplicate === true,
  });
}

/** POST /api/order/submit — PUBLIC customer checkout (customers aren't logged in). */
export function postCustomerOrder(request: Request): Promise<Response> {
  return handleIntake(request, "customer");
}

/** POST /api/staff/add-order — Staff Add Order; requires x-staff-secret. */
export async function postStaffAddOrder(request: Request): Promise<Response> {
  const denied = checkStaffSecret(request);
  if (denied) return denied;
  return handleIntake(request, "staff");
}
