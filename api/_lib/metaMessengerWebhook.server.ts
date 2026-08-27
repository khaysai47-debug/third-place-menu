import { createHmac } from "node:crypto";
import process from "node:process";

import { waitUntil } from "@vercel/functions";

import { EXTERNAL_CHAT_ID_PATTERN } from "./botSession.server.js";
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
// NONE of it is logged or persisted, and the only parts ever forwarded are the
// sender PSID, as `externalChatId` on each event, the first image attachment's
// URL, as `attachment` on a message event, and an allowlisted Atlas action, as
// `action`. The raw body exists only long enough to verify its signature and
// read its structure, and what leaves this file is the SanitizedMessengerPayload
// below: counts, categories, timestamps, and those three values. If a field is
// not on that type, it does not exist downstream.
//
// WHY THE PSID IS AN EXCEPTION: it names the conversation to answer, so without
// it n8n receives an event it cannot act on. It is opaque and Page-scoped
// (meaningless to anyone but this Page), it travels ONLY in the body of the
// forward to N8N_MESSENGER_EVENTS_WEBHOOK_URL, and it appears in NO log line,
// NO stored row, and NOT in the eventId derivation.
//
// WHY THE IMAGE URL IS THE OTHER EXCEPTION: a payment proof IS the image, so
// without its URL the proof cannot be fetched and reviewed. Only the FIRST
// valid image attachment travels, and only as { type, url } — one HTTPS URL,
// nothing else from the attachment.
//
// WHY AN ALLOWLISTED ACTION IS THE THIRD: a tap on a button or quick reply the
// APP ITSELF composed carries no customer content — the payload is Atlas
// vocabulary we put there. Forwarding it is what lets the receiver route a tap
// deterministically ("the customer asked for Location") instead of re-reading
// the message and replaying the welcome over somebody's payment slip. It is a
// CLOSED allowlist (MESSENGER_ACTIONS): a payload that is not one of ours is
// null, exactly like arbitrary text, so nothing free-form can ride in on it.
//
// Message text, the recipient Page id and non-image attachments remain
// stripped unconditionally — they are not needed to reply or to review a proof.

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

/**
 * The CLOSED set of actions a customer can trigger from a control the app
 * itself composed — the four welcome options. These are the ONLY payload
 * values that may leave this module; anything else is customer-controlled
 * input and is stripped like message text.
 *
 * The charset matches POSTBACK_PAYLOAD_PATTERN in chatMessaging.server.ts, the
 * module that puts these payloads on the buttons and quick replies in the
 * first place. Adding a value here is a deliberate contract change on BOTH
 * sides — a new option is composed there and admitted here, never one without
 * the other.
 */
export const MESSENGER_ACTIONS = [
  "ORDER_START",
  "SHOW_MENU",
  "SHOW_LOCATION",
  "SHOW_OPENING_HOURS",
] as const;
export type MessengerAction = (typeof MESSENGER_ACTIONS)[number];

/**
 * The one image reference that may leave this module: type and URL, nothing
 * else. No file name, no size, no sticker or thumbnail metadata.
 */
export type SanitizedMessengerAttachment = { type: "image"; url: string };

/**
 * One messaging event, reduced to shape plus the identifier a reply needs, the
 * image a payment proof consists of, and the allowlisted action a tap means. No
 * recipient Page id, no message text, no non-image attachment, and no payload
 * this app did not itself author.
 */
export type SanitizedMessengerEvent = {
  category: MessengerEventCategory;
  /** event.timestamp when it is a finite number, else null. */
  timestamp: number | null;
  /**
   * The sender PSID — `event.sender.id` — when it is a string matching the
   * repository's EXTERNAL_CHAT_ID_PATTERN, else null.
   *
   * WHY THIS ONE FIELD IS NOT STRIPPED: it names the conversation to answer.
   * Without it n8n receives an event it cannot act on. It is opaque (a
   * Page-scoped id, meaningless to anyone but this Page), it travels ONLY to
   * N8N_MESSENGER_EVENTS_WEBHOOK_URL, and this module never logs, persists, or
   * derives anything from it.
   */
  externalChatId: string | null;
  /**
   * The FIRST valid image attachment on a message event — `{ type: "image",
   * url }` — else null. Always present, so the event shape stays fixed.
   *
   * WHY THIS IS NOT STRIPPED: a payment proof IS the image. Without its URL,
   * the proof intake at /api/automation/payment-proof has nothing to fetch. It
   * travels ONLY to N8N_MESSENGER_EVENTS_WEBHOOK_URL and is never logged.
   */
  attachment: SanitizedMessengerAttachment | null;
  /**
   * The Atlas action the customer tapped — a postback button's payload, or a
   * quick reply's — but ONLY when it is one of MESSENGER_ACTIONS. Every other
   * payload, and every event that is not a tap, is null. Always present, so
   * the event shape stays fixed.
   *
   * WHY THIS IS NOT STRIPPED: it is the receiver's routing key. An event with
   * an `action` is a menu choice; an event with an `attachment` is a payment
   * slip; an event with neither is ordinary text. Those three are disjoint, so
   * a slip can no longer take the same branch as a greeting.
   */
  action: MessengerAction | null;
};

/**
 * THE ONLY shape that leaves this module. Everything is structural except
 * externalChatId, attachment and action above: the opaque identifier a reply
 * requires, the one image URL a payment proof consists of, and the closed
 * action vocabulary this app authored. Nothing here carries message text, a
 * Page id, any other attachment, or any payload we did not put there.
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
 * `event.sender.id` when it is a string matching the repository's
 * EXTERNAL_CHAT_ID_PATTERN — the SAME validation the bot-session route applies
 * to a chat id — else null. Never guesses, never falls back to
 * `recipient.id`, never coerces a number.
 *
 * The pattern is reused rather than restated so that a chat id which would be
 * refused everywhere else in the app cannot enter through the webhook.
 */
function senderChatId(event: Record<string, unknown>): string | null {
  const sender = event.sender;
  if (!isRecord(sender)) return null;
  const id = sender.id;
  return typeof id === "string" && EXTERNAL_CHAT_ID_PATTERN.test(id) ? id : null;
}

/** HTTPS only, with a real host and no embedded userinfo credentials. */
function isValidImageUrl(value: unknown): value is string {
  if (typeof value !== "string" || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" && url.hostname !== "" && url.username === "" && url.password === ""
    );
  } catch {
    return false;
  }
}

/**
 * The FIRST valid image attachment on the event, as `{ type, url }`, else null.
 * Valid means `type === "image"` and `payload.url` is a non-empty HTTPS URL;
 * an attachment failing either test is skipped, never partially forwarded.
 *
 * This is message-only by construction: it reads `event.message`, and
 * categorize() returns "message" for exactly the events that carry that key. A
 * postback, delivery or read event therefore always yields null. Nothing else
 * from the attachment — file name, sticker id, size — is read at all.
 */
function imageAttachment(event: Record<string, unknown>): SanitizedMessengerAttachment | null {
  const message = event.message;
  if (!isRecord(message) || !Array.isArray(message.attachments)) return null;
  for (const attachment of message.attachments) {
    if (!isRecord(attachment) || attachment.type !== "image") continue;
    const payload = attachment.payload;
    if (!isRecord(payload)) continue;
    const url = payload.url;
    if (isValidImageUrl(url)) return { type: "image", url };
  }
  return null;
}

/**
 * A payload is an action ONLY if it is one of ours, verbatim. Case-sensitive
 * and whole-string: no prefix match, no normalization, no trimming — a value
 * that is nearly one of ours is not one of ours.
 */
const allowedAction = (value: unknown): MessengerAction | null =>
  typeof value === "string" && (MESSENGER_ACTIONS as readonly string[]).includes(value)
    ? (value as MessengerAction)
    : null;

/**
 * The allowlisted action this event represents, else null.
 *
 * Two sources, because Meta delivers the two controls differently: a button
 * template's postback arrives as `postback.payload` on a postback event, and a
 * quick reply arrives as `message.quick_reply.payload` on a MESSAGE event. Both
 * are taps on something this app composed, so both resolve through the same
 * allowlist rather than through two rules that could drift apart.
 *
 * Nothing else on the event is read. A quick-reply message's `text` — which
 * Meta echoes as the title the customer tapped — is still stripped.
 */
function messengerAction(event: Record<string, unknown>): MessengerAction | null {
  const postback = event.postback;
  if (isRecord(postback)) return allowedAction(postback.payload);
  const message = event.message;
  if (isRecord(message) && isRecord(message.quick_reply)) {
    return allowedAction(message.quick_reply.payload);
  }
  return null;
}

/**
 * Reduces the parsed payload to structure plus the one identifier a reply
 * needs, the first image a message carries, and any allowlisted action it
 * represents. Returns null for anything that is not a `page` object — the only
 * object type this endpoint accepts.
 *
 * Deliberately tolerant BELOW the object check: a missing or malformed entry /
 * messaging array counts as zero rather than throwing, because the signature
 * already proved the sender. Deliberately strict ABOUT what it emits: it reads
 * array lengths, the four discriminating keys, a numeric timestamp, `sender.id`,
 * one image URL, and a payload that is already on the closed allowlist — and
 * nothing else. It never touches `recipient`, `message.text` or `message.mid`,
 * so no Page id and no message content can reach the returned object even by
 * accident; a payload that is not one of ours is discarded the same way.
 */
function sanitize(payload: unknown, eventId: string): SanitizedMessengerPayload | null {
  if (!isRecord(payload) || payload.object !== "page") return null;

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  const events: SanitizedMessengerEvent[] = [];
  for (const entry of entries) {
    const messaging = isRecord(entry) && Array.isArray(entry.messaging) ? entry.messaging : [];
    for (const event of messaging) {
      if (!isRecord(event)) {
        events.push({
          category: "other",
          timestamp: null,
          externalChatId: null,
          attachment: null,
          action: null,
        });
        continue;
      }
      const at = event.timestamp;
      events.push({
        category: categorize(event),
        timestamp: typeof at === "number" && Number.isFinite(at) ? at : null,
        externalChatId: senderChatId(event),
        attachment: imageAttachment(event),
        action: messengerAction(event),
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
  imageAttachment,
  messengerAction,
  sanitize,
  senderChatId,
  SIGNATURE_HEADER,
  MAX_BODY_BYTES,
  FORWARD_TIMEOUT_MS,
  EVENT_CATEGORIES,
  MESSENGER_ACTIONS,
};
