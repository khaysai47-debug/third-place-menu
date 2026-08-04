import { createHmac } from "node:crypto";
import process from "node:process";

import { waitUntil } from "@vercel/functions";

import { secretMatches } from "./staffOrderWrites.server.js";

// Server-only META MESSENGER CALLBACK — the app-owned webhook foundation.
//
// WHY THIS EXISTS: Meta subscribes ONE callback URL and uses it for BOTH the
// GET verification handshake and the POST event deliveries. n8n Cloud minted a
// DIFFERENT public URL per HTTP method for the same workflow, so there was no
// single value that could be entered in the Meta callback field. An app-owned
// route has one URL by construction, so the handshake and the events land in
// the same place. The n8n workflow "Atlas Messenger Webhook Receiver
// (STAGING)" stays inactive and untouched; nothing here calls it.
//
// WHAT THIS IS NOT: this module RECEIVES only. There is no Graph API call, no
// Page access token, no customer reply, and no Supabase write anywhere in this
// file. The outbound sender lives in chatMessaging.server.ts and its Meta
// adapter remains hard-disabled — receiving a webhook cannot and does not
// enable it.
//
// TRUST MODEL: the two Meta secrets, read inside the handlers (never at module
// scope, never VITE_ prefixed, never logged):
//   META_MESSENGER_VERIFY_TOKEN — the handshake token. Compared, never echoed.
//     Unset → every GET is refused (fails closed).
//   META_APP_SECRET             — keys the HMAC-SHA256 body signature Meta
//     sends as x-hub-signature-256. Unset → every POST is refused (fails
//     closed). An unsigned POST is an anonymous POST; it is never processed.
// Both comparisons use the repository's constant-time secretMatches.
// No CORS headers: this is a server-to-server callback, never a browser fetch.
//
// PRIVACY RULE — THE POINT OF THIS MODULE. A Messenger payload is customer
// data: message text, attachments, the sender PSID and the recipient Page ID.
// NONE of it is logged, persisted, or forwarded. The raw body exists only long
// enough to verify its signature and count its structure, and what leaves this
// file is the SanitizedMessengerPayload below: counts, categories, timestamps.
// If a field is not on that type, it does not exist downstream.

/** Meta's verification query fields. */
const HUB_MODE = "hub.mode";
const HUB_TOKEN = "hub.verify_token";
const HUB_CHALLENGE = "hub.challenge";

/** The body-signature header and its ONLY accepted spelling. */
const SIGNATURE_HEADER = "x-hub-signature-256";
const SIGNATURE_PATTERN = /^sha256=([0-9a-f]{64})$/;

/**
 * Body cap. Meta event batches are a few kilobytes; this bounds the HMAC and
 * JSON.parse work an oversized (still unverified) body can cost.
 */
const MAX_BODY_BYTES = 256 * 1024;

/** Forwarding budget. No retry — see forward(). */
const FORWARD_TIMEOUT_MS = 5_000;

/** Domain separator so eventId can never be mistaken for the signature. */
const EVENT_ID_DOMAIN = "atlas.metaevent.v1";

/** The closed category vocabulary. Anything unrecognised is "other". */
export const EVENT_CATEGORIES = ["message", "postback", "delivery", "read", "other"] as const;
export type MessengerEventCategory = (typeof EVENT_CATEGORIES)[number];

/** One messaging event, reduced to shape. No sender, no recipient, no content. */
export type SanitizedMessengerEvent = {
  category: MessengerEventCategory;
  /** event.timestamp when it is a finite number, else null. */
  timestamp: number | null;
};

/**
 * THE ONLY shape that leaves this module. Every key is structural: nothing
 * here can identify a person, a Page, or a conversation, and nothing here
 * carries message content.
 */
export type SanitizedMessengerPayload = {
  eventId: string;
  object: "page";
  entryCount: number;
  messagingEventCount: number;
  events: SanitizedMessengerEvent[];
  receivedAt: string;
};

/* ── Responses ───────────────────────────────────────────────────────────── */

/**
 * Plain text, always. The success path MUST be text (Meta compares the echoed
 * challenge byte for byte and a JSON-quoted string fails verification), so the
 * refusals use the same content type rather than mixing two.
 */
function textResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** The one generic refusal. Never says WHICH check failed. */
const forbidden = (): Response => textResponse(403, "Forbidden");

/* ── GET — the verification handshake ────────────────────────────────────── */

/**
 * GET /api/automation/meta-messenger-webhook
 *
 * Echoes hub.challenge VERBATIM as plain text when hub.mode is "subscribe" and
 * hub.verify_token matches META_MESSENGER_VERIFY_TOKEN in constant time.
 * Everything else — unset token, wrong token, wrong mode, absent challenge —
 * is the same generic 403.
 *
 * The query is read from request.url, which works on BOTH surfaces: in dev
 * TanStack serves the real path, and in production the vercel.json rewrite
 * merges the incoming query string into /api/router, so the hub.* values
 * survive alongside the router's own `path` parameter.
 */
export function getMetaMessengerWebhook(request: Request): Response {
  const expected = process.env.META_MESSENGER_VERIFY_TOKEN;
  if (!expected) {
    console.error("META_MESSENGER_WEBHOOK verification refused: verify token not configured");
    return forbidden();
  }

  const params = new URL(request.url).searchParams;
  const challenge = params.get(HUB_CHALLENGE);
  // A valid handshake ALWAYS carries a challenge; without one there is nothing
  // to echo, so it is refused rather than answered with an empty 200.
  if (params.get(HUB_MODE) !== "subscribe" || challenge === null || challenge === "") {
    return forbidden();
  }
  if (!secretMatches(params.get(HUB_TOKEN), expected)) return forbidden();

  return textResponse(200, challenge);
}

/* ── POST — signature, then structure, then nothing else ─────────────────── */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Which KIND of event this is, by the discriminating key Meta puts on it.
 * Meta sends exactly one of these per event; an unrecognised or malformed
 * event is "other", never a guess.
 */
function categorize(event: Record<string, unknown>): MessengerEventCategory {
  if ("message" in event) return "message";
  if ("postback" in event) return "postback";
  if ("delivery" in event) return "delivery";
  if ("read" in event) return "read";
  return "other";
}

/**
 * Reduces the parsed payload to structure. Returns null for anything that is
 * not a `page` object — the only object type this endpoint accepts.
 *
 * Deliberately tolerant BELOW the object check: a missing or malformed entry /
 * messaging array counts as zero rather than throwing, because the signature
 * already proved the sender. Deliberately strict ABOUT what it emits: it reads
 * only array lengths, the four discriminating keys, and a numeric timestamp —
 * it never touches sender/recipient/message/attachments, so no identifier or
 * content can reach the returned object even by accident.
 */
function sanitize(payload: unknown, eventId: string): SanitizedMessengerPayload | null {
  if (!isRecord(payload) || payload.object !== "page") return null;

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const events: SanitizedMessengerEvent[] = [];
  for (const entry of entries) {
    const messaging = isRecord(entry) && Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const event of messaging) {
      if (!isRecord(event)) {
        events.push({ category: "other", timestamp: null });
        continue;
      }
      const at = event.timestamp;
      events.push({
        category: categorize(event),
        timestamp: typeof at === "number" && Number.isFinite(at) ? at : null,
      });
    }
  }

  return {
    eventId,
    object: "page",
    entryCount: entries.length,
    messagingEventCount: events.length,
    events,
    receivedAt: new Date().toISOString(),
  };
}

/**
 * Best-effort forward of the SANITIZED payload only. Never retries: Meta
 * already retries the delivery, and n8n deduplicates on eventId, so a retry
 * here would only multiply the same event. Never reads the response body,
 * which is foreign text this module has no use for.
 *
 * ponytail: unauthenticated POST — the n8n webhook URL's secrecy plus whatever
 * auth is configured on the n8n node is the trust boundary, matching how the
 * STAGING receiver was already going to be reached. Add a signed JWT (the
 * N8N_AUTOMATION_SECRET pattern in paymentReviewNotify.server.ts) if this ever
 * forwards anything an injected event could act on.
 */
async function forward(hook: string, event: SanitizedMessengerPayload): Promise<void> {
  try {
    const res = await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-atlas-event-id": event.eventId },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
    console.log(
      `META_MESSENGER_WEBHOOK event=${event.eventId} forward status=${res.status} ${res.ok ? "delivered" : "rejected"}`,
    );
  } catch (error) {
    // error.name only (TimeoutError/AbortError/TypeError) — fetch error
    // messages and causes can contain the webhook hostname.
    console.error(
      `META_MESSENGER_WEBHOOK event=${event.eventId} forward failed: ${error instanceof Error ? error.name : "error"}`,
    );
  }
}

/**
 * POST /api/automation/meta-messenger-webhook
 *
 * Order is the security property: raw bytes → signature → size → parse →
 * object type. Nothing downstream of a failed check runs, and NOTHING from the
 * body is logged at any point.
 *
 * eventId is DERIVED, not random: HMAC(app secret, domain ‖ body digest). Meta
 * retries the identical body, so the identical eventId comes back and n8n can
 * deduplicate on it. It is keyed, so it discloses nothing about the payload,
 * and domain-separated so it is never equal to the signature Meta sent.
 *
 * The forward floats past the response on waitUntil — Meta must get its 200
 * quickly or it retries and eventually unsubscribes the app, so no downstream
 * failure, timeout or misconfiguration may ever change this status code.
 */
export async function postMetaMessengerWebhook(request: Request): Promise<Response> {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.error("META_MESSENGER_WEBHOOK refused: app secret not configured");
    return textResponse(500, "Server is not configured for Messenger webhooks.");
  }

  const header = request.headers.get(SIGNATURE_HEADER);
  const match = header === null ? null : SIGNATURE_PATTERN.exec(header);
  if (!match) {
    // The header value is NEVER echoed — only whether it was there at all.
    console.error(
      `META_MESSENGER_WEBHOOK refused: signature ${header === null ? "missing" : "malformed"}`,
    );
    return forbidden();
  }

  let raw: Buffer;
  try {
    raw = Buffer.from(await request.arrayBuffer());
  } catch {
    console.error("META_MESSENGER_WEBHOOK refused: body unreadable");
    return forbidden();
  }
  if (raw.length > MAX_BODY_BYTES) {
    console.error(`META_MESSENGER_WEBHOOK refused: body exceeds ${MAX_BODY_BYTES} bytes`);
    return textResponse(413, "Request too large.");
  }

  // Over the EXACT bytes received — a decode/re-encode round trip could change
  // them and break a signature that was actually valid.
  const digest = createHmac("sha256", secret).update(raw).digest("hex");
  if (!secretMatches(match[1], digest)) {
    console.error("META_MESSENGER_WEBHOOK refused: signature invalid");
    return forbidden();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw.toString("utf8")) as unknown;
  } catch {
    // A parse error message quotes the offending body — never log it.
    console.error("META_MESSENGER_WEBHOOK refused: body is not valid JSON");
    return textResponse(400, "Invalid request body.");
  }

  const eventId = createHmac("sha256", secret)
    .update(`${EVENT_ID_DOMAIN}\x1f${digest}`)
    .digest("hex")
    .slice(0, 32);

  const event = sanitize(payload, eventId);
  if (!event) {
    console.error(`META_MESSENGER_WEBHOOK event=${eventId} refused: unsupported object`);
    return textResponse(400, "Unsupported object.");
  }

  const hook = process.env.N8N_MESSENGER_EVENTS_WEBHOOK_URL;
  const summary = `event=${eventId} entries=${event.entryCount} events=${event.messagingEventCount}`;
  if (!hook) {
    console.log(`META_MESSENGER_WEBHOOK ${summary} forwarding=disabled`);
  } else {
    console.log(`META_MESSENGER_WEBHOOK ${summary} forwarding=enabled`);
    // The .catch is the last line of defence: an unhandled rejection inside
    // waitUntil surfaces as a process-level error, which a best-effort forward
    // must never cause.
    waitUntil(
      forward(hook, event).catch(() =>
        console.error(`META_MESSENGER_WEBHOOK event=${eventId} forward failed: unexpected`),
      ),
    );
  }

  return textResponse(200, "EVENT_RECEIVED");
}

/** Exported for the standalone check (scripts/test-meta-messenger-webhook.mjs). */
export const __test = {
  categorize,
  sanitize,
  SIGNATURE_HEADER,
  MAX_BODY_BYTES,
  FORWARD_TIMEOUT_MS,
  EVENT_CATEGORIES,
};
