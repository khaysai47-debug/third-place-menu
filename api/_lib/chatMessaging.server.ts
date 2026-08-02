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
// WHAT THIS IS NOT (yet): there is NO Meta network call in this module. The
// provider adapter below is deliberately hard-disabled (metaProvider
// .isConfigured() returns false) and NOTHING here reaches graph.facebook.com.
// Enabling a real send is a separate, reviewed change that must first answer
// the Meta send-permission and 24-hour-messaging-window questions.
//
// NOT WIRED TO n8n: no automation calls this route yet, and
// N8N_PAYMENT_REVIEW_WEBHOOK_URL stays unset in Production. Adding the route
// changes no existing behaviour — an endpoint nobody calls costs nothing.
//
// TRUST MODEL: server-to-server only, x-chat-messaging-secret
// (CHAT_MESSAGING_SECRET), constant-time compared — its OWN secret, not
// STAFF_WRITE_SECRET (staff-device localStorage), not PAYMENT_PROOF_SECRET
// (proof intake), not BOT_SESSION_SECRET (link minting). Sending a customer a
// message is its own power and rotates on its own schedule. Unset → the
// endpoint refuses every request (fails closed). No CORS headers: a browser has
// no business here.
//
// THE CALLER COMPOSES THE TEXT. This module never builds, translates, or
// decorates a message — it validates, claims, dispatches, and records. That
// keeps reply wording in one place (the caller) instead of two.
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

/** Exactly what a provider needs, and nothing else. No Supabase ids, no money. */
export type ChatSendInput = {
  eventId: string;
  orderNumber: string;
  channel: ChatChannel;
  externalChatId: string;
  message: string;
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
 * A message provider. `isConfigured` is checked BEFORE the claim so that an
 * unconfigured provider never consumes an eventId — see handleSendChatMessage.
 * It is a function, not a constant, because environment reads must happen
 * inside handlers (never at module scope, where a bundler can capture them).
 */
export type ChatProvider = {
  isConfigured: () => boolean;
  send: (input: ChatSendInput) => Promise<ChatSendResult>;
};

const failure = (errorClass: ChatErrorClass): ChatSendResult => ({
  ok: false,
  provider: "meta",
  messageRef: null,
  errorClass,
  status: "needs_review",
});

/**
 * THE META ADAPTER — DELIBERATELY DISABLED.
 *
 * This is where the real Graph API call will live. It is hard-disabled rather
 * than gated on an environment variable on purpose: a missing token is a
 * configuration accident, whereas `return false` is a decision, and enabling it
 * must be a reviewed code change rather than something a variable can switch on
 * by surprise in Production.
 *
 * Before this may be implemented, two questions must be answered outside this
 * repository (neither is knowable from here):
 *   1. Does the Meta credential hold send permission (pages_messaging /
 *      instagram_manage_messages)? Today it is only evidenced for RECEIVING
 *      webhooks and downloading attachments (paymentIntake.server.ts).
 *   2. The 24-hour standard messaging window. A payment review routinely lands
 *      after it closes; outside it a plain send FAILS. The pilot answer is to
 *      map that failure to errorClass "outside_window" and let a human reply —
 *      never to reach for a message tag without review.
 */
export const metaProvider: ChatProvider = {
  isConfigured: () => false,
  send: async () => failure("auth"),
};

/* ── Request validation (trust boundary — do not relax casually) ─────────── */

// .strict() rejects unknown keys outright rather than stripping them: this is a
// server-to-server contract, and a caller sending a field we do not understand
// is a caller we do not understand. Every value is a primitive with a closed
// shape, so a nested object or array fails its own type check first.
const sendBody = z
  .object({
    eventId: z.string().regex(UUID_V4_PATTERN),
    orderNumber: z.string().regex(ORDER_NUMBER_PATTERN),
    channel: z.enum(CHAT_CHANNELS),
    externalChatId: z.string().regex(EXTERNAL_CHAT_ID_PATTERN),
    message: z
      .string()
      .min(1)
      .max(MAX_MESSAGE_CHARS)
      .refine((value) => value.trim().length > 0),
  })
  .strict();

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
 * (currently disabled) metaProvider.
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
    message: body.data.message,
  };

  // BEFORE the claim, deliberately: an unconfigured provider must not consume
  // the eventId. Burning it would leave a needs_review row that blocks the very
  // replay a human would use once the provider is enabled.
  if (!provider.isConfigured()) {
    console.error(
      `CHAT_MESSAGING ${input.orderNumber} event=${input.eventId} skipped=provider_unconfigured`,
    );
    return normalized(503, failure("auth"));
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

/** The bound route handler — always the real, currently disabled, adapter. */
export function postSendChatMessage(request: Request): Promise<Response> {
  return handleSendChatMessage(request, metaProvider);
}

/** Exported for the standalone check (scripts/test-chat-messaging.mjs). */
export const __test = {
  chatRef,
  fromExistingRow,
  DISPATCH_STATES,
  SECRET_HEADER,
  ORDER_NUMBER_PATTERN,
};
