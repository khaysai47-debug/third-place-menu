import { randomUUID } from "node:crypto";
import process from "node:process";

import { waitUntil } from "@vercel/functions";
import { z } from "zod";

import {
  buildOrderEventJwt,
  isAutomationChannel,
  type OrderCreatedEvent,
  type OrderEventChannel,
} from "./orderEventJwt.server.js";
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

// Exported for the Phase 3D session-order route, which extends this schema
// with a `token` field. It deliberately has NO channel/platform/source key —
// zod strips unknown keys, so a browser sending one is silently discarded
// before any handler sees it.
export const intakeBody = z.object({
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

export type IntakeInput = z.infer<typeof intakeBody>;

/** Server-normalized intake, ready for the RPC. Money is never in here. */
export interface NormalizedIntake {
  requestId: string;
  orderType: "dine_in" | "pickup" | "delivery";
  tableNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerAddress: string | null;
  customerNote: string | null;
  items: { item_code: string; quantity: number }[];
}

/**
 * Either a parsed value or a ready-to-send error Response.
 *
 * Both members declare BOTH properties (the unused one as `?: undefined`) on
 * purpose: the standalone `npx tsc` calls in scripts/test-*.mjs compile these
 * modules WITHOUT --strict, and without strictNullChecks TypeScript will not
 * narrow a discriminated union on a boolean literal. With the optional members
 * present, `x.response` / `x.value` typecheck under strict (via narrowing) and
 * non-strict (via the declaration) alike. Do not "tidy" these away.
 */
export type Parsed<T> =
  | { ok: true; value: T; response?: undefined }
  | { ok: false; value?: undefined; response: Response };

/**
 * Content-type gate + size cap + JSON parse — extracted VERBATIM from
 * handleIntake so the Phase 3D session-order route enforces byte-identical
 * limits instead of re-implementing them.
 */
export async function readIntakeJson(request: Request): Promise<Parsed<unknown>> {
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) {
    return { ok: false, response: jsonError(415, "Unsupported content type.") };
  }
  const raw = await request.text().catch(() => null);
  if (raw === null || raw.length > MAX_BODY_BYTES) {
    return { ok: false, response: jsonError(413, "Request too large.") };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, response: jsonError(400, "Invalid request body.") };
  }
}

/**
 * Per-order-type required fields, dine_in field nulling, duplicate item-code
 * combining and the quantity caps — extracted VERBATIM from handleIntake.
 * ONE implementation, so the bot-session path can never drift from the
 * customer path on validation. (The DB function enforces the same rules again
 * on insert.)
 */
export function normalizeIntake(data: IntakeInput): Parsed<NormalizedIntake> {
  const { requestId, orderType, notes } = data;

  // dine_in deliberately drops any leftover customer/delivery data from a
  // prior order-type selection.
  const tableNumber = data.tableNumber?.trim() || null;
  const customerName = orderType === "dine_in" ? null : data.customerName?.trim() || null;
  const customerPhone = orderType === "dine_in" ? null : data.customerPhone?.trim() || null;
  const customerAddress = orderType === "delivery" ? data.customerAddress?.trim() || null : null;

  if (orderType === "dine_in" && !tableNumber) {
    return { ok: false, response: jsonError(400, "Table number is required.") };
  }
  if (orderType !== "dine_in" && (!customerName || !customerPhone)) {
    return { ok: false, response: jsonError(400, "Name and phone are required.") };
  }
  if (orderType === "delivery" && !customerAddress) {
    return { ok: false, response: jsonError(400, "Delivery address is required.") };
  }

  // Combine duplicate item codes safely (sum quantities), enforce caps.
  const combined = new Map<string, number>();
  for (const item of data.items) {
    combined.set(item.itemCode, (combined.get(item.itemCode) ?? 0) + item.quantity);
  }
  let totalItems = 0;
  const items: { item_code: string; quantity: number }[] = [];
  for (const [itemCode, quantity] of combined) {
    if (quantity > MAX_QTY_PER_ITEM) {
      return {
        ok: false,
        response: jsonError(400, `Too many of item ${itemCode} (max ${MAX_QTY_PER_ITEM}).`),
      };
    }
    totalItems += quantity;
    items.push({ item_code: itemCode, quantity });
  }
  if (totalItems > MAX_TOTAL_ITEMS) {
    return {
      ok: false,
      response: jsonError(400, `Too many items in one order (max ${MAX_TOTAL_ITEMS}).`),
    };
  }

  return {
    ok: true,
    value: {
      requestId,
      orderType,
      tableNumber,
      customerName,
      customerPhone,
      customerAddress,
      customerNote: notes?.trim() || null,
      items,
    },
  };
}

/** Supabase REST base + service-role key, or a ready-to-send 500. */
export function supabaseAdmin(unconfigured: string): Parsed<{ base: string; key: string }> {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, response: jsonError(500, unconfigured) };
  return { ok: true, value: { base: url.replace(/\/+$/, ""), key } };
}

/* ── RPC error → safe client message ─────────────────────────────────────── */

// The Postgres function raises machine-readable ORDER_* messages with the
// offending item_code in DETAIL. Item codes are public menu data — safe to
// echo. Anything unrecognized becomes a generic 500 (no Supabase details).
const ITEM_ERRORS: Record<string, string> = {
  ORDER_ITEM_UNKNOWN: "is no longer on the menu",
  ORDER_ITEM_UNAVAILABLE: "just sold out",
  ORDER_ITEM_UNPRICED: "is not orderable right now",
};

export function mapRpcError(message: string, detail: string): Response {
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

/* ── Optional post-order automation bridge (Phase 3A, gated in Phase 3C) ── */

// SELECTIVE DISPATCH (Phase 3C): only server-resolved BOT channels
// (AUTOMATION_DISPATCH_CHANNELS: instagram/messenger) dispatch to n8n.
// Normal restaurant orders — customer checkout, dine-in QR, staff manual —
// never do: ordinary operations cost zero n8n executions. No intake route
// can produce a bot channel yet (trusted bot sessions arrive in Phase 3D),
// so today NOTHING dispatches. Channel eligibility is decided here on the
// server only — never from a query parameter or any client-sent field.
//
// Fires ONLY when BOTH N8N_ORDER_AUTOMATION_WEBHOOK_URL and
// N8N_AUTOMATION_SECRET are set — otherwise skipped silently (unsetting
// them remains the global emergency dispatch-off switch). NEVER point
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

// Non-2xx diagnostic reason (Sunday E2E: n8n JWT Auth returns 403 with a body
// that explains why). Extract ONLY a short, sanitized reason — never the full
// body, never a token/secret (the body is n8n's own error text, not ours).
// Prefers a JSON `message`/`error` field, strips CR/LF/tab/control chars,
// collapses whitespace, truncates to 120 chars, and falls back to "unknown".
const MAX_REASON_LEN = 120;

// Redact anything credential-shaped BEFORE it can reach a log line. Deliberately
// PATTERN-based: the configured secret values (N8N_AUTOMATION_SECRET, the JWT,
// the webhook URL) are NEVER read from the environment or compared here —
// reading a secret in order to redact it would itself risk logging it and would
// couple this to secret rotation. These patterns catch an upstream body that
// echoes a Bearer token, a JWT, a webhook URL, or any long opaque blob. Order
// matters: Bearer/URL/JWT run before the generic long-blob rule so each
// collapses to a SINGLE [REDACTED] rather than a string of them.
function redactSecrets(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "[REDACTED]") // Authorization: Bearer <token>
    .replace(/https?:\/\/\S+/gi, "[REDACTED]") // any URL (e.g. the webhook host)
    .replace(/[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[REDACTED]") // JWT-shaped
    .replace(/[A-Za-z0-9+/=_-]{24,}/g, "[REDACTED]"); // long opaque / base64 / base64url blob
}

function sanitizeAutomationReason(raw: string | null): string {
  if (!raw) return "unknown";
  let text = raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      const message = record.message ?? record.error;
      if (typeof message === "string" && message) text = message;
    }
  } catch {
    // Not JSON — fall back to the raw text, sanitized below.
  }
  const cleaned = redactSecrets(text)
    .replace(/[\u0000-\u001F\u007F]+/g, " ") // control chars incl. CR/LF/TAB
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "unknown";
  return cleaned.length > MAX_REASON_LEN ? cleaned.slice(0, MAX_REASON_LEN) : cleaned;
}

// JWT constants + signing moved VERBATIM to orderEventJwt.server.ts in Phase
// 3B (the order-details endpoint verifies against the same contract).
// Re-exported so scripts/test-automation-bridge.mjs keeps importing from here.
export { buildOrderEventJwt };
export type { OrderCreatedEvent };

// Exported for scripts/test-automation-bridge.mjs (no intake route can
// produce a bot channel until Phase 3D — the test drives this directly).
export function fireOrderAutomation(orderNumber: string, channel: OrderEventChannel): void {
  // Defense in depth: the intake call site already gates on
  // isAutomationChannel, but the policy is re-checked here so no future
  // caller can dispatch a non-bot channel by accident.
  if (!isAutomationChannel(channel)) return;
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
      async (res) => {
        // Success path unchanged: 2xx never reads the body. Only a non-2xx
        // response is read, and only for a short sanitized reason. res.text()
        // is catch-guarded so a body-read failure never throws here.
        let reason = "";
        if (!res.ok) {
          const raw = await res.text().catch(() => null);
          reason = ` reason="${sanitizeAutomationReason(raw)}"`;
        }
        console.log(
          `ORDER_AUTOMATION ${orderNumber} event=${eventId} status=${res.status} ${res.ok ? "delivered" : "rejected"}${reason}`,
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
  const json = await readIntakeJson(request);
  if (!json.ok) return json.response;
  const body = intakeBody.safeParse(json.value);
  if (!body.success) return jsonError(400, "Invalid request body.");
  const normalized = normalizeIntake(body.data);
  if (!normalized.ok) return normalized.response;
  const { requestId, orderType, tableNumber, customerName, customerPhone } = normalized.value;
  const { customerAddress, customerNote, items } = normalized.value;

  const admin = supabaseAdmin("Server is not configured for order intake.");
  if (!admin.ok) return admin.response;
  const { base, key } = admin.value;

  let response: globalThis.Response;
  try {
    response = await fetch(`${base}/rest/v1/rpc/create_order_with_items`, {
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
        p_customer_note: customerNote,
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

  // Phase 3C: dispatch only server-resolved bot channels — customer/staff
  // intake never reaches n8n. (Duplicate replays never dispatch either.)
  if (!result.duplicate && isAutomationChannel(channel)) {
    fireOrderAutomation(result.order_number, channel);
  }

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
