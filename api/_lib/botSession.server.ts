import { createHash, createHmac, randomBytes } from "node:crypto";
import process from "node:process";

import { z } from "zod";

import {
  fireOrderAutomation,
  intakeBody,
  mapRpcError,
  normalizeIntake,
  type Parsed,
  readIntakeJson,
  supabaseAdmin,
} from "./orderIntake.server.js";
import { ORDER_EVENT_CHANNELS, type OrderEventChannel } from "./orderEventJwt.server.js";
import { supabaseAuthHeaders } from "./supabaseAuth.js";
import { jsonError, secretMatches } from "./staffOrderWrites.server.js";

// Server-only SECURE BOT SESSIONS (Phase 3D) — the ONLY trusted path that can
// produce an instagram/messenger order.
//
// Same delivery pattern as every other route here: one implementation,
// consumed by the TanStack dev routes (src/routes/api.automation.
// bot-session.ts, api.menu-session.resolve.ts, api.order.submit-session.ts)
// and the native Vercel functions (api/automation/bot-session.ts,
// api/menu-session/resolve.ts, api/order/submit-session.ts).
// Self-contained: node:crypto + zod + process.env only.
//
// TRUST MODEL — three surfaces with three different boundaries:
//
//  1. POST /api/automation/bot-session  TRUSTED-SERVER-ONLY (x-bot-secret).
//     The simulated chat adapter asks for a secure link. Returns the plaintext
//     token exactly once per derivation.
//  2. POST /api/menu-session/resolve    PUBLIC. The token IS the credential.
//     Answers only "what state is this link in".
//  3. POST /api/order/submit-session    PUBLIC, token-authenticated. Checkout.
//
// THE CHANNEL RULE: the browser can never declare itself Instagram or
// Messenger. No schema here accepts a channel/platform/source field (zod
// strips unknown keys), and the order channel is read by the DATABASE from the
// locked bot_sessions row inside create_order_from_bot_session. The only
// client-supplied input on the bot path is the token, which must hash-match a
// stored row.
//
// TOKEN RULE: the plaintext token is NEVER stored. Supabase holds only
// sha256(token) as lowercase hex. The token is derived DETERMINISTICALLY
// (see deriveSessionToken) so a lost HTTP response can reproduce the exact
// same link on retry without the database ever holding the plaintext.
//
// LOGGING RULE: never log the token, the token hash, a URL containing the
// token, or the external chat id. Logs carry state / order number / platform.

/* ── Validation (trust boundary — do not relax casually) ─────────────────── */

const MAX_SMALL_BODY_BYTES = 1_024;

/** 32 raw bytes of HMAC output, base64url, unpadded. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * UUIDv4, enforced identically in four places: this schema, the bot_sessions
 * request_id CHECK, create_bot_session, and the tests. Not a length bound:
 * >= 122 bits of entropy is what stops someone holding
 * BOT_SESSION_TOKEN_SECRET but not the database from enumerating tokens by
 * guessing derivation inputs.
 */
export const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Meta PSID/IGSID charset — mirrors the bot_sessions CHECK exactly. */
export const EXTERNAL_CHAT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** Public page/account handle — never a full URL (see chatDeepLink). */
const HANDLE_PATTERN = /^[A-Za-z0-9._]{1,60}$/;

const createSessionBody = z
  .object({
    requestId: z.string().regex(UUID_V4_PATTERN),
    platform: z.enum(["instagram", "messenger"]),
    externalChatId: z.string().regex(EXTERNAL_CHAT_ID_PATTERN),
  })
  .strict();

const resolveBody = z.object({ token: z.string().regex(TOKEN_PATTERN) }).strict();

// The customer checkout schema plus the token. Inherits every limit from the
// public intake schema; still has no channel/platform/source key.
const sessionOrderBody = intakeBody.extend({ token: z.string().regex(TOKEN_PATTERN) });

/* ── Deterministic token derivation ──────────────────────────────────────── */

const TOKEN_DOMAIN = "atlas.botsession.v1";
const FIELD_SEPARATOR = "\x1f"; // ASCII US — excluded from every field charset

/**
 * Injective canonical encoding. Plain concatenation is NOT injective —
 * ("instagram","12","3456") and ("instagram","123","456") would collide and
 * derive the same token for two different chats. Every field is length-
 * prefixed (byte length, not JS characters) and separated by 0x1F, so exactly
 * one input tuple can produce any given string.
 *
 * The domain/version prefix gives cryptographic domain separation and a clean
 * upgrade path: bump to v2 to change the derivation with no key change.
 */
export function canonicalTokenInput(
  platform: string,
  externalChatId: string,
  requestId: string,
): string {
  const field = (value: string) => `${Buffer.byteLength(value, "utf8")}:${value}`;
  return [TOKEN_DOMAIN, field(platform), field(externalChatId), field(requestId)].join(
    FIELD_SEPARATOR,
  );
}

/**
 * HMAC-SHA256 over the canonical input → 32 bytes → 43 base64url characters.
 *
 * DETERMINISTIC BY DESIGN. If the HTTP response to a session-creation call is
 * lost, the adapter retries with the same requestId and this reproduces the
 * byte-identical token, so the customer receives the same working link. A
 * random token could not be reproduced, because only its hash is stored.
 *
 * The trade this accepts, stated plainly: BOT_SESSION_TOKEN_SECRET together
 * with a database dump makes every live token recomputable (request_id is a
 * stored column). That is inherent to "same link on retry" — an encrypted-
 * ciphertext design has the identical exposure — and is bounded by the 24 h
 * TTL and single-use checkout.
 */
export function deriveSessionToken(
  secret: string,
  platform: string,
  externalChatId: string,
  requestId: string,
): string {
  return createHmac("sha256", secret)
    .update(canonicalTokenInput(platform, externalChatId, requestId), "utf8")
    .digest("base64url");
}

/** sha256 of the token text, lowercase hex — the only form Supabase stores. */
export const hashSessionToken = (token: string): string =>
  createHash("sha256").update(token, "utf8").digest("hex");

/* ── Trusted-caller authentication ───────────────────────────────────────── */

/**
 * Checks x-bot-secret against BOT_SESSION_SECRET in constant time.
 * DELIBERATELY NOT STAFF_WRITE_SECRET: that secret lives in staff-device
 * localStorage, so reusing it would let any staff device mint bot sessions and
 * would couple its rotation to the dashboards.
 * Returns a Response to send (401/500) or null when authorized.
 */
export function checkBotSecret(request: Request): Response | null {
  const secret = process.env.BOT_SESSION_SECRET;
  if (!secret) return jsonError(500, "Server is not configured for bot sessions.");
  if (!secretMatches(request.headers.get("x-bot-secret"), secret)) {
    return jsonError(401, "Unauthorized.");
  }
  return null;
}

/* ── Return-to-chat deep links ───────────────────────────────────────────── */

/**
 * Builds the "back to your conversation" link from the BUSINESS's own public
 * handle. It is NEVER built from external_chat_id: a PSID/IGSID is an opaque
 * page-scoped id, Meta publishes no customer-side URL scheme for it, and it
 * must not reach the browser at all.
 *
 * NO OPEN REDIRECT: the environment supplies a HANDLE, never a URL, the handle
 * is charset-validated, and it is interpolated into one of two fixed
 * templates. An unset or malformed handle yields null and the UI falls back to
 * generic return-to-chat instructions — never a broken or invented button.
 */
export function chatDeepLink(platform: OrderEventChannel | null): string | null {
  if (platform === "messenger") {
    const handle = process.env.MESSENGER_PAGE_HANDLE;
    return handle && HANDLE_PATTERN.test(handle) ? `https://m.me/${handle}` : null;
  }
  if (platform === "instagram") {
    const handle = process.env.INSTAGRAM_HANDLE;
    return handle && HANDLE_PATTERN.test(handle) ? `https://ig.me/m/${handle}` : null;
  }
  return null;
}

/* ── Small-body reader (create + resolve) ────────────────────────────────── */

// Exact media type (parameters like "; charset=utf-8" allowed) — a substring
// check would accept "text/application/json". Real UTF-8 bytes, not JS
// characters, so multibyte padding cannot slip under the cap. Same shape as
// orderDetails.server.ts.
async function readSmallJson(request: Request): Promise<Parsed<unknown>> {
  const mediaType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    return { ok: false, response: jsonError(415, "Unsupported content type.") };
  }
  const raw = await request.text().catch(() => null);
  if (raw === null || Buffer.byteLength(raw, "utf8") > MAX_SMALL_BODY_BYTES) {
    return { ok: false, response: jsonError(413, "Request too large.") };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false, response: jsonError(400, "Invalid request body.") };
  }
}

/** One PostgREST RPC call with the service-role key. */
async function callRpc(
  base: string,
  key: string,
  fn: string,
  args: Record<string, unknown>,
): Promise<globalThis.Response | null> {
  try {
    return await fetch(`${base}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: supabaseAuthHeaders(key, { "Content-Type": "application/json" }),
      body: JSON.stringify(args),
    });
  } catch {
    // Never log the error object — fetch errors can carry the Supabase host.
    return null;
  }
}

/** PostgREST { message, details } from a failed RPC, never leaked to clients. */
async function rpcError(
  response: globalThis.Response,
): Promise<{ message: string; detail: string }> {
  const body = (await response.json().catch(() => null)) as {
    message?: string;
    details?: string;
  } | null;
  return {
    message: body?.message ?? `HTTP ${response.status}`,
    detail: body?.details ?? "",
  };
}

/* ── 1. POST /api/automation/bot-session (trusted-server-only) ───────────── */

/**
 * Creates (or idempotently re-derives) a secure menu link for one chat thread.
 * Trusted callers only — x-bot-secret. No CORS headers on purpose: browsers
 * have no business here.
 *
 * The response carries the plaintext token and the full link. On an idempotent
 * retry it carries the SAME token and link, because the token is derived, not
 * random — this is what makes a lost response recoverable.
 *
 * Error messages here are deliberately specific: this endpoint is
 * trusted-server-only, so operational detail helps the adapter and reaches no
 * customer. The two PUBLIC endpoints keep generic messages.
 */
export async function postCreateBotSession(request: Request): Promise<Response> {
  const denied = checkBotSecret(request);
  if (denied) return denied;

  const tokenSecret = process.env.BOT_SESSION_TOKEN_SECRET;
  if (!tokenSecret) return jsonError(500, "Server is not configured for bot sessions.");
  const siteUrl = process.env.PUBLIC_SITE_URL;
  if (!siteUrl) return jsonError(500, "Server is not configured for bot sessions.");

  const json = await readSmallJson(request);
  if (!json.ok) return json.response;
  const body = createSessionBody.safeParse(json.value);
  if (!body.success) return jsonError(400, "Invalid request body.");
  const { requestId, platform, externalChatId } = body.data;

  const admin = supabaseAdmin("Server is not configured for bot sessions.");
  if (!admin.ok) return admin.response;
  const { base, key } = admin.value;

  const token = deriveSessionToken(tokenSecret, platform, externalChatId, requestId);
  const tokenHash = hashSessionToken(token);

  const response = await callRpc(base, key, "create_bot_session", {
    p_platform: platform,
    p_external_chat_id: externalChatId,
    p_token_hash: tokenHash,
    p_request_id: requestId,
    p_ttl_hours: 24,
  });
  if (!response) {
    console.error("BOT_SESSION create RPC unreachable");
    return jsonError(502, "Session could not be created.");
  }

  if (!response.ok) {
    const { message } = await rpcError(response);
    if (message.includes("SESSION_REQUEST_ID_CONFLICT")) {
      return jsonError(409, "Idempotency key already used for a different conversation.");
    }
    if (message.includes("SESSION_TOKEN_UNRECOVERABLE")) {
      // The derivation secret was rotated (or the canonical encoding changed)
      // since this session was created. Fail closed — NEVER return a guessed
      // or dead URL.
      return jsonError(409, "This link cannot be re-issued. Use a fresh requestId.");
    }
    if (message.includes("SESSION_BAD_")) {
      return jsonError(400, "Invalid request body.");
    }
    console.error(`BOT_SESSION create rejected: ${message}`);
    return jsonError(502, "Session could not be created.");
  }

  const result = (await response.json().catch(() => null)) as {
    session_id?: string;
    status?: string;
    expires_at?: string;
    duplicate?: boolean;
  } | null;
  if (!result || typeof result.session_id !== "string" || typeof result.expires_at !== "string") {
    console.error("BOT_SESSION create RPC returned an unexpected shape");
    return jsonError(502, "Session could not be created.");
  }

  // Never log the token, the hash, the link, or the chat id.
  console.log(`BOT_SESSION created platform=${platform} duplicate=${result.duplicate === true}`);

  return Response.json(
    {
      ok: true,
      // The token travels in the URL FRAGMENT: it is never sent to a server,
      // never appears in an access log, and is stripped from every Referer.
      url: `${siteUrl.replace(/\/+$/, "")}/m#${token}`,
      token,
      expiresAt: result.expires_at,
      duplicate: result.duplicate === true,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/* ── 2. POST /api/menu-session/resolve (public) ──────────────────────────── */

export type SessionState = "active" | "completed" | "expired" | "revoked" | "invalid";

/** Explicit column list — external_chat_id is not merely filtered out of the
 *  response, it is never SELECTed, so it cannot leak by accident. */
const SESSION_COLUMNS = "status,platform,expires_at,order_id";

/**
 * Tells the /m page what state its link is in. The token is the credential and
 * travels ONLY in the JSON body — deliberately POST, because request paths and
 * query strings are written to Vercel/CDN access logs and bodies are not.
 *
 * Always answers 200, including for `invalid`: a 404/200 split is itself an
 * oracle and complicates the client for nothing. With a 256-bit token the
 * expired-vs-invalid distinction (required for the customer messaging) has no
 * enumeration value.
 */
export async function postResolveSession(request: Request): Promise<Response> {
  const json = await readSmallJson(request);
  if (!json.ok) return json.response;
  const body = resolveBody.safeParse(json.value);
  // A malformed token is indistinguishable from an unknown one, by design.
  if (!body.success) return sessionStateResponse("invalid", null, null);

  const admin = supabaseAdmin("Server is not configured for bot sessions.");
  if (!admin.ok) return admin.response;
  const { base, key } = admin.value;

  const tokenHash = hashSessionToken(body.data.token);
  const rows = await supabaseGet(
    `${base}/rest/v1/bot_sessions?token_hash=eq.${tokenHash}&select=${SESSION_COLUMNS}&limit=1`,
    key,
    "bot_sessions",
  );
  if (rows === null) return jsonError(502, "Link lookup failed.");

  const row = rows[0];
  if (!row) return sessionStateResponse("invalid", null, null);

  const platform =
    typeof row.platform === "string" &&
    (ORDER_EVENT_CHANNELS as readonly string[]).includes(row.platform)
      ? (row.platform as OrderEventChannel)
      : null;

  // Status first, expiry only for an otherwise-active row: a completed session
  // that has since passed expires_at must still read "completed" so the
  // customer sees their order rather than an expiry message.
  let state: SessionState;
  if (row.status === "revoked") state = "revoked";
  else if (row.status === "completed") state = "completed";
  else if (row.status === "active") {
    const expiresAt = typeof row.expires_at === "string" ? Date.parse(row.expires_at) : NaN;
    state = Number.isFinite(expiresAt) && expiresAt <= Date.now() ? "expired" : "active";
  } else {
    // Unknown status — fail closed rather than render a menu.
    state = "invalid";
  }

  let orderNumber: string | null = null;
  if (state === "completed" && typeof row.order_id === "string") {
    const orders = await supabaseGet(
      `${base}/rest/v1/orders?id=eq.${encodeURIComponent(row.order_id)}&select=order_number&limit=1`,
      key,
      "orders",
    );
    if (orders === null) return jsonError(502, "Link lookup failed.");
    const value = orders[0]?.order_number;
    orderNumber = typeof value === "string" && value !== "" ? value : null;
  }

  console.log(`MENU_SESSION_RESOLVE state=${state}`);
  return sessionStateResponse(state, state === "invalid" ? null : platform, orderNumber);
}

/**
 * The resolve contract. `returnToChat.platform` is null for `invalid` — the
 * originating platform of an unknown token is unknowable and must never be
 * invented. external_chat_id never appears in any state.
 */
function sessionStateResponse(
  state: SessionState,
  platform: OrderEventChannel | null,
  orderNumber: string | null,
): Response {
  return Response.json(
    {
      ok: true,
      state,
      returnToChat: { platform, url: chatDeepLink(platform) },
      ...(orderNumber ? { orderNumber } : {}),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** One GET against PostgREST. Rows on success, null on ANY failure. */
async function supabaseGet(
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
      console.error(`MENU_SESSION read failed: ${what} responded ${response.status}`);
      return null;
    }
    const rows: unknown = await response.json().catch(() => null);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : null;
  } catch {
    // Never log the error object — fetch errors can carry the URL, which here
    // contains the token hash.
    console.error(`MENU_SESSION read failed: ${what} unreachable`);
    return null;
  }
}

/* ── 3. POST /api/order/submit-session (public, token-authenticated) ─────── */

// The session RPC's machine-readable failures → safe customer messages.
// 410 Gone for expired/revoked (the link existed and is finished), 409 for a
// consumed session, 404 for a token that matches nothing.
const SESSION_ORDER_ERRORS: Record<string, { status: number; message: string }> = {
  SESSION_INVALID: { status: 404, message: "This link is no longer valid." },
  SESSION_EXPIRED: {
    status: 410,
    message: "This link has expired. Send us a message for a fresh one.",
  },
  SESSION_REVOKED: {
    status: 410,
    message: "This link was replaced. Please use the newest link in your chat.",
  },
  SESSION_REQUEST_ID_REUSED: {
    status: 409,
    message: "This order was already submitted. Please reopen your link.",
  },
};

/**
 * Checkout that atomically consumes the session. The order channel comes from
 * the LOCKED bot_sessions row inside create_order_from_bot_session — never
 * from this request. Validation and normalisation are the customer path's,
 * imported rather than re-implemented, so the two can never drift.
 */
export async function postSessionOrder(request: Request): Promise<Response> {
  const json = await readIntakeJson(request);
  if (!json.ok) return json.response;
  const body = sessionOrderBody.safeParse(json.value);
  if (!body.success) return jsonError(400, "Invalid request body.");
  const normalized = normalizeIntake(body.data);
  if (!normalized.ok) return normalized.response;
  const n = normalized.value;

  const admin = supabaseAdmin("Server is not configured for bot sessions.");
  if (!admin.ok) return admin.response;
  const { base, key } = admin.value;

  const response = await callRpc(base, key, "create_order_from_bot_session", {
    p_token_hash: hashSessionToken(body.data.token),
    p_client_request_id: n.requestId,
    p_order_type: n.orderType,
    p_table_number: n.tableNumber,
    p_customer_name: n.customerName,
    p_customer_phone: n.customerPhone,
    p_customer_address: n.customerAddress,
    p_customer_note: n.customerNote,
    p_items: n.items,
  });
  if (!response) {
    console.error("SESSION_ORDER RPC unreachable");
    return jsonError(500, "Order could not be created. Please try again.");
  }

  if (!response.ok) {
    const { message, detail } = await rpcError(response);
    for (const [code, mapped] of Object.entries(SESSION_ORDER_ERRORS)) {
      if (message.includes(code)) return jsonError(mapped.status, mapped.message);
    }
    if (message.includes("SESSION_COMPLETED")) {
      // detail is the order number — safe to echo, the customer already has it.
      return jsonError(
        409,
        detail
          ? `This link was already used for order ${detail}. Tap Start New Order below.`
          : "This link has already been used. Tap Start New Order below.",
      );
    }
    // Item availability/pricing failures reuse the customer path's messages.
    return mapRpcError(message, detail);
  }

  const result = (await response.json().catch(() => null)) as {
    order_number?: string;
    subtotal?: number;
    delivery_fee?: number;
    total?: number;
    platform?: string;
    duplicate?: boolean;
  } | null;
  if (!result || typeof result.order_number !== "string") {
    console.error("SESSION_ORDER RPC returned an unexpected shape");
    return jsonError(500, "Order could not be created. Please try again.");
  }

  console.log(
    `SESSION_ORDER ${result.order_number} platform=${result.platform ?? "?"} type=${n.orderType} lines=${n.items.length}${result.duplicate ? " (idempotent replay)" : ""}`,
  );

  // Phase 3C dispatch policy, unchanged: only server-resolved bot channels
  // reach n8n, and duplicate replays never dispatch. The channel here came
  // from the trusted RPC (the locked session row), never from the request.
  // fireOrderAutomation re-checks isAutomationChannel itself — that existing
  // defense-in-depth line becomes load-bearing for the first time here.
  if (
    result.duplicate !== true &&
    typeof result.platform === "string" &&
    (ORDER_EVENT_CHANNELS as readonly string[]).includes(result.platform)
  ) {
    fireOrderAutomation(result.order_number, result.platform as OrderEventChannel);
  }

  // The SAME response shape the existing client already parses (orders.ts).
  return Response.json(
    {
      ok: true,
      orderNumber: result.order_number,
      subtotal: result.subtotal,
      deliveryFee: result.delivery_fee,
      total: result.total,
      duplicate: result.duplicate === true,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/* ── Dev/ops helper ──────────────────────────────────────────────────────── */

/**
 * Generates a UUIDv4-shaped requestId. Exported for the simulated adapter and
 * the tests; randomBytes keeps this independent of crypto.randomUUID
 * availability in older runtimes.
 */
export function newRequestId(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const hex = b.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
