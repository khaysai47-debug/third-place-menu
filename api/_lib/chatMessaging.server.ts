import { createHmac } from "node:crypto";
import process from "node:process";

import { z } from "zod";

import { EXTERNAL_CHAT_ID_PATTERN, UUID_V4_PATTERN } from "./botSession.server.js";
import { readIntakeJson, supabaseAdmin } from "./orderIntake.server.js";
import { jsonError, secretMatches } from "./staffOrderWrites.server.js";
import { supabaseAuthHeaders } from "./supabaseAuth.js";

// Server-only CHAT MESSAGE DISPATCH — the app-owned sender foundation.
//
// WHY THIS EXISTS: n8n Cloud on this account cannot limit a workflow to
// concurrency 1, and an n8n Data Table gives no confirmed unique constraint and
// no atomic claim. A "check then insert" dedup there can elect two owners for
// one eventId, which is exactly how a customer gets told twice that their
// payment was rejected. PostgreSQL can decide that question in one statement,
// so the claim moves here: ONE unique event_id, ONE winner, decided by the
// database, not by a read that raced.
//
// MESSENGER IS LIVE, INSTAGRAM IS NOT. metaProvider below makes ONE real
// Graph API call for channel "messenger" when META_PAGE_ACCESS_TOKEN is set.
// Instagram is refused before the claim and reaches no network. Unsetting the
// token is the emergency send-off switch: every send then answers a safe
// needs_review and no eventId is consumed.
//
// NOT WIRED TO n8n: no automation calls this route yet — the n8n Atlas Chat
// Sender nodes are disabled and disconnected, and N8N_PAYMENT_REVIEW_WEBHOOK_URL
// stays unset in Production. Nothing reaches a customer until that is changed
// deliberately.
//
// TRUST MODEL: server-to-server only, x-chat-messaging-secret
// (CHAT_MESSAGING_SECRET), constant-time compared — its OWN secret, not
// STAFF_WRITE_SECRET (staff-device localStorage), not PAYMENT_PROOF_SECRET
// (proof intake), not BOT_SESSION_SECRET (link minting). Sending a customer a
// message is its own power and rotates on its own schedule. Unset → the
// endpoint refuses every request (fails closed). No CORS headers: a browser has
// no business here.
//
// THE CALLER COMPOSES THE MESSAGE. This module never builds, translates, or
// decorates one — it validates, claims, dispatches, and records. That keeps
// reply wording in one place (the caller) instead of two. Buttons are no
// exception: their titles, payloads and URLs all come from the caller, and
// this module transports them without knowing what any of them mean. Nothing
// here interprets a postback payload — handling one is a separate change.
//
// NO AUTOMATIC RESEND, EVER. A failed or ambiguous send ends as needs_review
// and waits for a human. Retrying a send whose outcome is unknown is the one
// mistake that produces the duplicate this whole module exists to prevent.
//
// LOGGING/STORAGE RULE: never the secret, never the raw external chat id,
// never the message body, never a provider response body. Logs and rows carry
// order number / event id / channel / chat_ref / state only.

/** The one inbound header. Its own secret — see the trust model above. */
const SECRET_HEADER = "x-chat-messaging-secret";

/**
 * Conservative customer-facing text cap. Meta's own text limit is larger; the
 * composed Atlas replies are two short sentences. A tight bound keeps a
 * malformed caller from parking kilobytes in a message it never should have
 * built, and this endpoint is not a general messaging surface.
 */
const MAX_MESSAGE_CHARS = 1_000;

/**
 * Button-template limits — Meta's own, not invented here. Exceeding any of
 * them is a guaranteed Graph rejection, so they are enforced at the trust
 * boundary where the answer is a clean 400, rather than after the claim where
 * it would burn an eventId into needs_review.
 */
const MAX_BUTTON_TEXT_CHARS = 640;
const MAX_BUTTON_TITLE_CHARS = 20;
const MAX_BUTTONS = 3;

/** URLs are foreign data even when the caller is trusted — bound the length. */
const MAX_BUTTON_URL_CHARS = 2_000;

/**
 * Postback payloads are ATLAS vocabulary, not free text: a closed uppercase
 * charset so a payload can never smuggle punctuation, whitespace, or a URL
 * into a value that comes back to us on the webhook.
 */
const POSTBACK_PAYLOAD_PATTERN = /^[A-Z0-9_]{1,100}$/;

/** Provider references are foreign data — bound what gets persisted. */
const MAX_MESSAGE_REF_CHARS = 200;

/**
 * order_number — the Atlas formats (TP-/TP-S-/TP-IG-/TP-MS-) with the TP-
 * prefix REQUIRED, not merely permitted by the charset. 32 characters total:
 * the 3-character prefix plus 1..29. Kept byte-identical to the
 * chat_message_dispatches_order_number_format CHECK in
 * docs/sql/2026-08-02-chat-message-dispatches.sql — if one moves, so does the
 * other, or a value the app accepts starts failing at the database.
 */
const ORDER_NUMBER_PATTERN = /^TP-[A-Za-z0-9-]{1,29}$/;

/** Only chat channels can be messaged — mirrors PROOF_CHANNELS on intake. */
const CHAT_CHANNELS = ["instagram", "messenger"] as const;

export type ChatChannel = (typeof CHAT_CHANNELS)[number];

/** The closed failure vocabulary. Mirrored by the DB check constraint. */
export const CHAT_ERROR_CLASSES = [
  "rate_limited",
  "outside_window",
  "invalid_recipient",
  "auth",
  "other",
] as const;
export type ChatErrorClass = (typeof CHAT_ERROR_CLASSES)[number];

/** The closed lifecycle vocabulary. Mirrored by the DB check constraint. */
const DISPATCH_STATES = ["processing", "sent", "needs_review"] as const;

/* ── The provider adapter boundary ───────────────────────────────────────── */

/**
 * One button on a button template. Both shapes are EXACTLY Meta's, so the
 * adapter forwards them without a second mapping step — one place to be wrong
 * instead of two.
 */
export type ChatButton =
  | { type: "postback"; title: string; payload: string }
  | { type: "web_url"; title: string; url: string };

/**
 * What to say, as a discriminated union. "text" is a plain message; "buttons"
 * is a Messenger button template. The tag is required on BOTH — there is no
 * untagged form, so a caller can never be ambiguous about which it meant.
 */
export type ChatMessage =
  | { type: "text"; text: string }
  | { type: "buttons"; text: string; buttons: ChatButton[] };

/** Exactly what a provider needs, and nothing else. No Supabase ids, no money. */
export type ChatSendInput = {
  eventId: string;
  orderNumber: string;
  channel: ChatChannel;
  externalChatId: string;
  message: ChatMessage;
};

/**
 * The normalized result contract — the ONLY shape this endpoint answers with
 * for a dispatch outcome, and the shape every provider must return. A caller
 * branches on `status`; `ok` is the one-bit summary.
 */
export type ChatSendResult =
  | {
      ok: true;
      provider: "meta";
      messageRef: string | null;
      errorClass: null;
      status: "sent" | "duplicate" | "in_progress";
    }
  | {
      ok: false;
      provider: "meta";
      messageRef: null;
      errorClass: ChatErrorClass;
      status: "needs_review";
    };

/**
 * A message provider.
 *
 * `isConfigured` is checked BEFORE the claim so that a channel this provider
 * cannot serve never consumes an eventId — burning one would leave a
 * needs_review row blocking the very replay a human would use once the channel
 * IS serviceable. It answers `true`, or the needs_review class to report
 * instead, so the reason ("auth" for a missing credential, "other" for a
 * channel that is not implemented) comes from the provider that knows it
 * rather than from the generic handler.
 *
 * Both members are functions, not constants, because environment reads must
 * happen per call (never at module scope, where a bundler can capture them).
 */
export type ChatProvider = {
  isConfigured: (channel: ChatChannel) => true | ChatErrorClass;
  send: (input: ChatSendInput) => Promise<ChatSendResult>;
};

const failure = (errorClass: ChatErrorClass): ChatSendResult => ({
  ok: false,
  provider: "meta",
  messageRef: null,
  errorClass,
  status: "needs_review",
});

/* ── THE META ADAPTER — Messenger only ───────────────────────────────────── */

/**
 * PINNED Graph API version. Meta dates every version and drops it about two
 * years later, so an unpinned call silently changes behaviour under the app.
 * ⚠️ Confirm this against the App Dashboard's configured version before the
 * first real send — this repository cannot read it.
 */
const GRAPH_API_VERSION = "v23.0";
const GRAPH_SEND_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages`;

/**
 * One send budget. Longer than the n8n forward (5 s) because this is the call
 * a customer is actually waiting on, and short enough to stay inside the
 * function timeout. NO RETRY on expiry — see the catch in sendMessenger.
 */
const SEND_TIMEOUT_MS = 10_000;

/** The only Graph fields this adapter reads. Everything else is discarded. */
type GraphSendResponse = {
  message_id?: unknown;
  error?: { code?: unknown; error_subcode?: unknown };
};

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Graph error → the closed normalized vocabulary. Best-effort BY DESIGN: an
 * unrecognised error is "other", which is the safe direction (a human reads
 * it) rather than a guess that could hide an expired token behind a
 * "rate limited" label and delay a real fix.
 *
 * Order matters where codes overlap:
 *   - the throttle codes are checked first, because Meta returns them under
 *     several HTTP statuses (429 and 403 both occur);
 *   - subcode 2018278 (outside the 24-hour standard messaging window) is
 *     checked BEFORE the generic permission mapping, because it arrives as
 *     code 10, which otherwise means "no permission for this action".
 * Codes are from the Messenger Platform Send API error reference; anything not
 * listed there falls through to "other" rather than being invented here.
 */
function classifyGraphError(
  status: number,
  code: number | null,
  subcode: number | null,
): ChatErrorClass {
  // App / Page / API throttling.
  if (status === 429 || code === 4 || code === 32 || code === 613) return "rate_limited";

  // The 24-hour standard messaging window closed. A payment review routinely
  // lands after it does; the pilot answer is a human reply, NEVER a message tag.
  if (subcode === 2018278) return "outside_window";

  // The PSID does not resolve for this Page, or the person cannot be messaged.
  if (subcode === 2018001 || code === 551 || code === 230) return "invalid_recipient";

  // Token expired/invalid, or the credential lacks pages_messaging. Subcode
  // 2018065 (development mode: testers only) arrives as code 10 and belongs
  // here too — it is a permission state, not a recipient problem.
  if (status === 401 || code === 190 || code === 102 || code === 10 || code === 200 || code === 3) {
    return "auth";
  }

  return "other";
}

/**
 * The Meta `message` object for one ChatMessage — the ONLY place the two
 * variants diverge. A text message is a plain `{ text }`; buttons become the
 * button template attachment.
 *
 * The buttons are passed through because ChatButton is already byte-identical
 * to Meta's button shape and both members were parsed with .strict(), so no
 * unknown key can exist on one. Re-mapping them here would be a second place
 * to get the same thing wrong.
 */
function graphMessage(message: ChatMessage): Record<string, unknown> {
  if (message.type === "text") return { text: message.text };
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: message.text,
        buttons: message.buttons,
      },
    },
  };
}

/**
 * The real Messenger send. ONE request, no retry, ever.
 *
 * The token is read HERE, per call — never at module scope, never cached, and
 * never passed to anything but the Authorization header of this one fetch.
 *
 * LOGGING RULE, absolute: the line below carries the HTTP status, the numeric
 * Graph code/subcode and the mapped class, and NOTHING else. Not the token,
 * not the Authorization header, not the recipient id, not the message text,
 * not the response body, not the Graph error message — Meta error bodies quote
 * the offending request back, which is exactly the payload that must not reach
 * a log sink.
 */
async function sendMessenger(input: ChatSendInput): Promise<ChatSendResult> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  // Defensive: the handler already refused an unconfigured channel. Reaching
  // this without a token means a direct caller bypassed isConfigured.
  if (!token) return failure("auth");

  let response: globalThis.Response;
  try {
    response = await fetch(GRAPH_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: { id: input.externalChatId },
        messaging_type: "RESPONSE",
        message: graphMessage(input.message),
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (error) {
    // Timeout or transport failure — the outcome is UNKNOWN: the message may
    // already have been delivered. error.name only; fetch error messages and
    // causes can carry the URL and the request. Never resent.
    console.error(
      `CHAT_MESSAGING meta event=${input.eventId} send failed: ${error instanceof Error ? error.name : "error"}`,
    );
    return failure("other");
  }

  // Read once, keep three fields, discard the rest. A non-JSON body yields
  // null and is handled the same as a missing one.
  const body = (await response.json().catch(() => null)) as GraphSendResponse | null;
  const code = asNumber(body?.error?.code);
  const subcode = asNumber(body?.error?.error_subcode);

  let result: ChatSendResult;
  if (!response.ok) {
    result = failure(classifyGraphError(response.status, code, subcode));
  } else if (typeof body?.message_id === "string" && body.message_id.length > 0) {
    result = {
      ok: true,
      provider: "meta",
      messageRef: body.message_id,
      errorClass: null,
      status: "sent",
    };
  } else {
    // 2xx with no usable message id is an AMBIGUOUS outcome — Meta may or may
    // not have delivered it. needs_review, and never a resend.
    result = failure("other");
  }

  console.log(
    `CHAT_MESSAGING meta event=${input.eventId} http=${response.status}` +
      ` code=${code ?? "-"} subcode=${subcode ?? "-"} status=${result.status}` +
      `${result.ok ? "" : ` class=${result.errorClass}`}`,
  );
  return result;
}

/**
 * THE SHIPPED ADAPTER. Messenger is live; Instagram is NOT implemented.
 *
 * Instagram is refused by isConfigured rather than inside send(), so it fails
 * BEFORE the claim: no eventId is consumed, no row is written, no network call
 * is made, and the same eventId can be replayed unchanged the day Instagram
 * sending lands. Its class is "other" (an unimplemented channel), deliberately
 * not "auth" (a credential problem), so a needs_review row points at the right
 * fix.
 */
export const metaProvider: ChatProvider = {
  isConfigured: (channel) => {
    if (channel !== "messenger") return "other";
    return process.env.META_PAGE_ACCESS_TOKEN ? true : "auth";
  },
  send: async (input) => {
    // Belt and braces for a direct caller that skipped isConfigured: Instagram
    // must never reach the network from here.
    if (input.channel !== "messenger") return failure("other");
    return sendMessenger(input);
  },
};

/* ── Request validation (trust boundary — do not relax casually) ─────────── */

// .strict() rejects unknown keys outright rather than stripping them: this is a
// server-to-server contract, and a caller sending a field we do not understand
// is a caller we do not understand. Every value is a primitive with a closed
// shape, so a nested object or array fails its own type check first.
/** Non-blank after trimming — whitespace is not a message and not a title. */
const filled = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0);

// Every button member is .strict() too: a caller sending `payload` on a
// web_url button, or `url` on a postback, is refused rather than silently
// stripped. That matters more here than elsewhere — a stripped `url` would
// ship a button that goes nowhere.
const postbackButton = z
  .object({
    type: z.literal("postback"),
    title: filled(MAX_BUTTON_TITLE_CHARS),
    payload: z.string().regex(POSTBACK_PAYLOAD_PATTERN),
  })
  .strict();

const urlButton = z
  .object({
    type: z.literal("web_url"),
    title: filled(MAX_BUTTON_TITLE_CHARS),
    // HTTPS ONLY. A plain-http button in a customer thread is a downgrade we
    // will not ship, and it also blocks javascript:/data: outright.
    url: z.string().max(MAX_BUTTON_URL_CHARS).url().startsWith("https://"),
  })
  .strict();

const chatMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: filled(MAX_MESSAGE_CHARS) }).strict(),
  z
    .object({
      type: z.literal("buttons"),
      text: filled(MAX_BUTTON_TEXT_CHARS),
      buttons: z
        .array(z.discriminatedUnion("type", [postbackButton, urlButton]))
        .min(1)
        .max(MAX_BUTTONS),
    })
    .strict(),
]);

const sendBody = z
  .object({
    eventId: z.string().regex(UUID_V4_PATTERN),
    orderNumber: z.string().regex(ORDER_NUMBER_PATTERN),
    channel: z.enum(CHAT_CHANNELS),
    externalChatId: z.string().regex(EXTERNAL_CHAT_ID_PATTERN),
    message: chatMessage,
  })
  .strict()
  // Button templates are a MESSENGER feature. Instagram has a different
  // mechanism entirely, so a buttons message on any other channel is a
  // contract error (400) — caught here rather than becoming a provider outcome
  // that would consume an eventId.
  .refine((body) => body.message.type !== "buttons" || body.channel === "messenger");

/**
 * Rebuilds the validated message field by field, for the same reason the rest
 * of `input` is rebuilt (see handleSendChatMessage): the standalone check in
 * scripts/test-chat-messaging.mjs compiles this module WITHOUT --strict, where
 * zod's inferred members read as optional and will not satisfy ChatMessage.
 * Do not "tidy" this back to a spread.
 */
function toChatMessage(parsed: z.infer<typeof chatMessage>): ChatMessage {
  if (parsed.type === "text") return { type: "text", text: parsed.text };
  return {
    type: "buttons",
    text: parsed.text,
    buttons: parsed.buttons.map((button) =>
      button.type === "postback"
        ? { type: "postback", title: button.title, payload: button.payload }
        : { type: "web_url", title: button.title, url: button.url },
    ),
  };
}

/* ── chat_ref — correlation without the chat id ──────────────────────────── */

const CHAT_REF_DOMAIN = "atlas.chatref.v1";

/**
 * A KEYED one-way reference to a conversation, for correlating rows and log
 * lines without ever storing or printing the PSID/IGSID itself.
 *
 * Keyed with CHAT_MESSAGING_SECRET rather than a plain hash, and deliberately
 * NOT with a new secret of its own: Meta chat ids are short numeric strings, so
 * an unkeyed sha256 is enumerable offline by anyone holding a table dump. With
 * the key, a dump alone reveals nothing.
 *
 * ⚠️ LIMITATION, stated rather than buried: rotating CHAT_MESSAGING_SECRET
 * changes every future chat_ref, so rows written before and after a rotation no
 * longer correlate with each other. That is acceptable because chat_ref is an
 * operational aid, never a key or a lookup path — nothing joins on it. The
 * alternative (its own never-rotated secret) buys continuity at the cost of one
 * more secret to hold, which is not a trade worth making for a debugging aid.
 *
 * The input is length-prefixed and 0x1F-separated so no two (channel, chatId)
 * pairs can collide — the same injective encoding botSession.server.ts uses.
 */
function chatRef(channel: string, externalChatId: string, secret: string): string {
  const field = (value: string) => `${Buffer.byteLength(value, "utf8")}:${value}`;
  const input = [CHAT_REF_DOMAIN, field(channel), field(externalChatId)].join("\x1f");
  return createHmac("sha256", secret).update(input).digest("hex").slice(0, 16);
}

/* ── The atomic claim ────────────────────────────────────────────────────── */

/** The table's own unique key. Either spelling of the constraint counts. */
const EVENT_ID_CONSTRAINTS = [
  "chat_message_dispatches_pkey",
  "chat_message_dispatches_event_id_key",
];

type DispatchRow = Record<string, unknown>;

type Claim =
  | { kind: "owned" }
  | { kind: "existing"; row: DispatchRow | null }
  | { kind: "unavailable" };

/**
 * Inserts the processing row. THE INSERT IS THE CLAIM: PostgreSQL's unique
 * event_id decides the winner in one statement, so exactly one concurrent
 * caller can ever be told "owned" — no read-then-write window exists for a
 * second caller to slip through.
 *
 * "existing" is claimed ONLY on PROOF of the expected unique violation:
 * PostgreSQL 23505 naming this table's event_id constraint. A bare 409, a
 * different 23505, a foreign-key or check violation are all real integrity
 * failures and must fail closed — treating them as "already claimed" would
 * silently swallow a broken write.
 */
async function claimEvent(
  base: string,
  key: string,
  input: ChatSendInput,
  ref: string,
): Promise<Claim> {
  let response: globalThis.Response;
  try {
    response = await fetch(`${base}/rest/v1/chat_message_dispatches`, {
      method: "POST",
      headers: supabaseAuthHeaders(key, {
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      }),
      body: JSON.stringify({
        event_id: input.eventId,
        order_number: input.orderNumber,
        channel: input.channel,
        chat_ref: ref,
        state: "processing",
        claimed_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Never log the error object — a fetch error can carry the Supabase host.
    console.error("CHAT_MESSAGING claim failed: dispatch store unreachable");
    return { kind: "unavailable" };
  }

  if (response.ok) return { kind: "owned" };

  const err = (await response.json().catch(() => null)) as {
    code?: string;
    message?: string;
    details?: string;
    constraint?: string;
  } | null;
  const namesEventId = [err?.message, err?.details, err?.constraint].some(
    (field) =>
      typeof field === "string" && EVENT_ID_CONSTRAINTS.some((name) => field.includes(name)),
  );
  if (err?.code === "23505" && namesEventId) {
    return { kind: "existing", row: await readDispatch(base, key, input.eventId) };
  }

  // The PostgREST code only — never the message, details, or body, which can
  // carry row values.
  console.error(
    `CHAT_MESSAGING claim failed: responded ${response.status} code=${err?.code ?? "?"}`,
  );
  return { kind: "unavailable" };
}

/** The already-claimed row, or null on ANY read failure. Never throws. */
async function readDispatch(
  base: string,
  key: string,
  eventId: string,
): Promise<DispatchRow | null> {
  try {
    const response = await fetch(
      `${base}/rest/v1/chat_message_dispatches?event_id=eq.${encodeURIComponent(eventId)}` +
        `&select=state,provider,message_ref,error_class&limit=1`,
      { method: "GET", headers: supabaseAuthHeaders(key) },
    );
    if (!response.ok) {
      console.error(`CHAT_MESSAGING dispatch read failed: responded ${response.status}`);
      return null;
    }
    const rows: unknown = await response.json().catch(() => null);
    return Array.isArray(rows) && rows.length > 0 ? (rows[0] as DispatchRow) : null;
  } catch {
    console.error("CHAT_MESSAGING dispatch read failed: dispatch store unreachable");
    return null;
  }
}

/**
 * Maps an ALREADY-CLAIMED row to its answer. None of these paths sends
 * anything — the claim is gone, so this request is a passenger.
 *
 * An unreadable row is answered needs_review, not in_progress: the conflict
 * proved a row exists but its state is unknown, and "unknown" belongs to a
 * human, not to a caller that might act on it.
 */
function fromExistingRow(row: DispatchRow | null): ChatSendResult {
  const state = typeof row?.state === "string" ? row.state : null;

  if (state === "sent") {
    const ref = row?.message_ref;
    return {
      ok: true,
      provider: "meta",
      messageRef: typeof ref === "string" ? ref : null,
      errorClass: null,
      status: "duplicate",
    };
  }
  if (state === "processing") {
    return { ok: true, provider: "meta", messageRef: null, errorClass: null, status: "in_progress" };
  }
  if (state === "needs_review") {
    const stored = row?.error_class;
    const known =
      typeof stored === "string" && (CHAT_ERROR_CLASSES as readonly string[]).includes(stored);
    return failure(known ? (stored as ChatErrorClass) : "other");
  }
  return failure("other");
}

/**
 * Writes the terminal state. Returns false on ANY failure — the caller then
 * answers needs_review and the row stays `processing`, so every later duplicate
 * reads in_progress and NOTHING is ever resent. Safe direction by construction:
 * a lost completion write can only suppress a future send, never cause one.
 */
async function completeEvent(
  base: string,
  key: string,
  eventId: string,
  result: ChatSendResult,
): Promise<boolean> {
  const now = new Date().toISOString();
  const patch = result.ok
    ? {
        state: "sent",
        provider: result.provider,
        message_ref:
          typeof result.messageRef === "string"
            ? result.messageRef.slice(0, MAX_MESSAGE_REF_CHARS)
            : null,
        completed_at: now,
        updated_at: now,
      }
    : {
        state: "needs_review",
        provider: result.provider,
        error_class: result.errorClass,
        completed_at: now,
        updated_at: now,
      };

  try {
    const response = await fetch(
      `${base}/rest/v1/chat_message_dispatches?event_id=eq.${encodeURIComponent(eventId)}`,
      {
        method: "PATCH",
        headers: supabaseAuthHeaders(key, {
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        }),
        body: JSON.stringify(patch),
      },
    );
    if (!response.ok) {
      console.error(`CHAT_MESSAGING completion write failed: responded ${response.status}`);
      return false;
    }
    return true;
  } catch {
    console.error("CHAT_MESSAGING completion write failed: dispatch store unreachable");
    return false;
  }
}

/* ── The handler ─────────────────────────────────────────────────────────── */

/** Every dispatch outcome answers the same normalized body. */
const normalized = (status: number, result: ChatSendResult): Response =>
  Response.json(result, { status, headers: { "Cache-Control": "no-store" } });

/**
 * POST /api/automation/send-chat-message — trusted server-to-server send.
 *
 * The provider is injected so tests drive a mock without any request-controlled
 * switch: NOTHING in the request body can influence which provider runs or
 * whether it succeeds. The exported route binding below always passes the real
 * metaProvider — the only channel it can serve is "messenger".
 *
 * HTTP status vs body: 401/400/500 are transport-level refusals with the
 * repository's generic error body — the request never became a dispatch. Every
 * request that DID become a dispatch answers the normalized contract, with 200
 * for a resolved outcome and 503 when nothing was attempted because a
 * dependency was down.
 */
export async function handleSendChatMessage(
  request: Request,
  provider: ChatProvider,
): Promise<Response> {
  const secret = process.env.CHAT_MESSAGING_SECRET;
  if (!secret) return jsonError(500, "Server is not configured for chat messaging.");
  if (!secretMatches(request.headers.get(SECRET_HEADER), secret)) {
    return jsonError(401, "Unauthorized.");
  }

  const json = await readIntakeJson(request);
  if (!json.ok) return json.response;
  const body = sendBody.safeParse(json.value);
  if (!body.success) return jsonError(400, "Invalid request body.");
  // Rebuilt field by field rather than passed as body.data: the standalone
  // `npx tsc` in scripts/test-chat-messaging.mjs compiles this module WITHOUT
  // --strict, where zod's inferred members read as optional and will not
  // satisfy ChatSendInput. Same reason as the Parsed<T> shape in
  // orderIntake.server.ts — do not "tidy" this back to a spread.
  const input: ChatSendInput = {
    eventId: body.data.eventId,
    orderNumber: body.data.orderNumber,
    channel: body.data.channel,
    externalChatId: body.data.externalChatId,
    message: toChatMessage(body.data.message),
  };

  // BEFORE the claim, deliberately: a channel the provider cannot serve must
  // not consume the eventId. Burning it would leave a needs_review row that
  // blocks the very replay a human would use once the channel is serviceable.
  // The class comes from the provider — "auth" for a missing credential,
  // "other" for a channel that is not implemented (Instagram today).
  const ready = provider.isConfigured(input.channel);
  if (ready !== true) {
    console.error(
      `CHAT_MESSAGING ${input.orderNumber} event=${input.eventId} channel=${input.channel} skipped=provider_unavailable class=${ready}`,
    );
    return normalized(503, failure(ready));
  }

  const admin = supabaseAdmin("Server is not configured for chat messaging.");
  if (!admin.ok) return admin.response;
  const { base, key } = admin.value;

  const ref = chatRef(input.channel, input.externalChatId, secret);
  const claim = await claimEvent(base, key, input, ref);

  if (claim.kind === "unavailable") {
    // Fail closed. Nothing was claimed and nothing was sent, so the eventId is
    // still free for a later attempt.
    console.error(
      `CHAT_MESSAGING ${input.orderNumber} event=${input.eventId} chat=${ref} status=unavailable`,
    );
    return normalized(503, failure("other"));
  }

  if (claim.kind === "existing") {
    const result = fromExistingRow(claim.row);
    console.log(
      `CHAT_MESSAGING ${input.orderNumber} event=${input.eventId} chat=${ref} status=${result.status} (claimed elsewhere)`,
    );
    return normalized(200, result);
  }

  // Sole owner, proven by the database. This is the ONLY path that may send.
  let result: ChatSendResult;
  try {
    result = await provider.send(input);
  } catch {
    // A throwing adapter is an UNKNOWN outcome: the message may or may not have
    // gone out. Never resend it — record and hand it to a human.
    result = failure("other");
  }

  const persisted = await completeEvent(base, key, input.eventId, result);
  const answer = persisted ? result : failure("other");
  console.log(
    `CHAT_MESSAGING ${input.orderNumber} event=${input.eventId} chat=${ref} channel=${input.channel} status=${answer.status}${persisted ? "" : " completion=unwritten"}`,
  );
  return normalized(200, answer);
}

/** The bound route handler — always the real adapter, never a test double. */
export function postSendChatMessage(request: Request): Promise<Response> {
  return handleSendChatMessage(request, metaProvider);
}

/** Exported for the standalone check (scripts/test-chat-messaging.mjs). */
export const __test = {
  chatRef,
  fromExistingRow,
  classifyGraphError,
  graphMessage,
  MAX_BUTTONS,
  MAX_BUTTON_TEXT_CHARS,
  MAX_BUTTON_TITLE_CHARS,
  POSTBACK_PAYLOAD_PATTERN,
  DISPATCH_STATES,
  SECRET_HEADER,
  ORDER_NUMBER_PATTERN,
  GRAPH_API_VERSION,
  GRAPH_SEND_URL,
  SEND_TIMEOUT_MS,
};
