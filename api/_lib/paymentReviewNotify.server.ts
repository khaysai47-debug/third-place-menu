import { randomUUID } from "node:crypto";
import process from "node:process";

import { waitUntil } from "@vercel/functions";

import { EXTERNAL_CHAT_ID_PATTERN } from "./botSession.server.js";
import { buildOrderEventJwt, type OrderEventBase } from "./orderEventJwt.server.js";
import { sanitizeAutomationReason, supabaseAdmin } from "./orderIntake.server.js";
import { supabaseAuthHeaders } from "./supabaseAuth.js";

// Server-only PAYMENT-REVIEW NOTIFICATION (Wednesday Phase 0 pilot).
//
// After staff approve or reject a payment slip, the customer is waiting in the
// Instagram/Messenger thread — not on any Atlas page. This tells n8n which
// conversation to answer, and nothing more.
//
// SAME BRIDGE AS PHASE 3A, ONE EVENT LATER: HS256 JWT (Authorization: Bearer)
// signed with the existing N8N_AUTOMATION_SECRET, its own webhook URL
// (N8N_PAYMENT_REVIEW_WEBHOOK_URL), subject/eventType "payment.reviewed".
// Both must be set or the notification is skipped silently — unsetting either
// is the emergency off switch, exactly like the order bridge.
//
// THE CHAT IS RESOLVED SERVER-SIDE. platform + external_chat_id come from the
// completed bot_sessions row linked to the reviewed order — never from the
// staff request, never from the browser. No bot session (a counter/QR order)
// means there is no chat to answer, so nothing is sent.
//
// BEST-EFFORT, ALWAYS. It runs after the review RPC already committed, floats
// past the HTTP response on waitUntil, and can never change, delay, or reverse
// what staff saw. DELIVERY IS NOT GUARANTEED: there is no retry and no durable
// outbox, so a lost event is simply lost. From this dispatcher the semantics
// are effectively AT-MOST-ONCE per review attempt — one event is generated and
// one POST is made. n8n must still deduplicate on eventId, because a duplicate
// can still arrive from an external retry, a manual replay, or any retry
// behavior added later.
//
// PAYLOAD/LOGGING RULE: identifiers and the decision only — no proof path, no
// storage key, no signed URL, no Supabase id, no customer name/phone/address,
// no money. Logs additionally never carry the chat id, the JWT, the secret, or
// the webhook URL.

const NOTIFY_TIMEOUT_MS = 5_000;

/** Only chat channels can be notified — mirrors PROOF_CHANNELS on intake. */
const NOTIFY_CHANNELS = ["instagram", "messenger"] as const;
type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

/** The reviewed-order facts the route already holds after a successful RPC. */
export type PaymentReviewResult = {
  orderNumber: string;
  decision: "approve" | "reject";
  /** The exact validated reason sent to the RPC; null on approve. */
  rejectionReason: string | null;
  /** orders.payment_status as the RPC returned it ("Paid" / unpaid value). */
  paymentStatus: string | null;
};

export type PaymentReviewedEvent = OrderEventBase & {
  eventType: "payment.reviewed";
  channel: NotifyChannel;
  externalChatId: string;
  decision: "approved" | "rejected";
  rejectionReason: string | null;
  paymentStatus: "paid" | "unpaid";
};

/** One GET against PostgREST. Rows on success, null on ANY failure. */
async function getRows(
  base: string,
  key: string,
  query: string,
  what: string,
): Promise<Record<string, unknown>[] | null> {
  try {
    const response = await fetch(`${base}/rest/v1/${query}`, {
      method: "GET",
      headers: supabaseAuthHeaders(key),
    });
    if (!response.ok) {
      console.error(`PAYMENT_REVIEW_NOTIFY read failed: ${what} responded ${response.status}`);
      return null;
    }
    const rows: unknown = await response.json().catch(() => null);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : null;
  } catch {
    // Never log the error object — fetch errors can carry the Supabase host.
    console.error(`PAYMENT_REVIEW_NOTIFY read failed: ${what} unreachable`);
    return null;
  }
}

/**
 * order_number → internal order id → the ONE completed bot session linked to
 * it (bot_sessions_order_id_key makes that unique). Returns null whenever the
 * chat cannot be resolved with certainty — a missing order, no bot session, or
 * a platform/chat id that fails the same validation the session route applies.
 * Never guesses, never throws.
 */
async function resolveChat(
  base: string,
  key: string,
  orderNumber: string,
): Promise<{ channel: NotifyChannel; externalChatId: string } | null> {
  const orders = await getRows(
    base,
    key,
    `orders?order_number=eq.${encodeURIComponent(orderNumber)}&select=id&limit=1`,
    "orders",
  );
  const orderId = orders?.[0]?.id;
  if (typeof orderId !== "string") return null;

  const sessions = await getRows(
    base,
    key,
    `bot_sessions?order_id=eq.${encodeURIComponent(orderId)}&status=eq.completed` +
      `&select=platform,external_chat_id&limit=1`,
    "bot_sessions",
  );
  const row = sessions?.[0];
  if (!row) return null;

  const { platform, external_chat_id: chatId } = row;
  if (typeof platform !== "string" || !(NOTIFY_CHANNELS as readonly string[]).includes(platform)) {
    return null;
  }
  if (typeof chatId !== "string" || !EXTERNAL_CHAT_ID_PATTERN.test(chatId)) return null;
  return { channel: platform as NotifyChannel, externalChatId: chatId };
}

/** Resolve → sign → POST. Swallows every failure; only ever logs. */
async function deliver(
  review: PaymentReviewResult,
  hook: string,
  secret: string,
): Promise<void> {
  const admin = supabaseAdmin("Server is not configured for payment-review notifications.");
  if (!admin.ok) return;
  const { base, key } = admin.value;

  const chat = await resolveChat(base, key, review.orderNumber);
  if (!chat) {
    console.log(`PAYMENT_REVIEW_NOTIFY ${review.orderNumber} skipped=no_bot_session`);
    return;
  }

  const event: PaymentReviewedEvent = {
    eventId: randomUUID(),
    eventType: "payment.reviewed",
    occurredAt: new Date().toISOString(),
    orderNumber: review.orderNumber,
    channel: chat.channel,
    externalChatId: chat.externalChatId,
    decision: review.decision === "approve" ? "approved" : "rejected",
    // A reason belongs to a rejection only — an approval always carries null.
    rejectionReason: review.decision === "reject" ? review.rejectionReason : null,
    // Taken from the RPC's authoritative order state, not inferred from the
    // decision, so the bot can never tell a customer "paid" on a row that isn't.
    paymentStatus: (review.paymentStatus ?? "").toLowerCase() === "paid" ? "paid" : "unpaid",
  };

  try {
    const res = await fetch(hook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${buildOrderEventJwt(event, secret)}`,
        "x-atlas-event-id": event.eventId,
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(NOTIFY_TIMEOUT_MS),
    });
    // 2xx never reads the body. Only a non-2xx one is read, and only for a
    // short reason run through the shared redaction.
    let reason = "";
    if (!res.ok) {
      reason = ` reason="${sanitizeAutomationReason(await res.text().catch(() => null))}"`;
    }
    console.log(
      `PAYMENT_REVIEW_NOTIFY ${review.orderNumber} event=${event.eventId} status=${res.status} ${res.ok ? "delivered" : "rejected"}${reason}`,
    );
  } catch (error) {
    // error.name only (TimeoutError/AbortError/TypeError) — fetch error
    // messages and causes can contain the webhook hostname.
    console.error(
      `PAYMENT_REVIEW_NOTIFY ${review.orderNumber} event=${event.eventId} failed: ${error instanceof Error ? error.name : "error"}`,
    );
  }
}

/**
 * Fire-and-forget the payment.reviewed event. Call ONLY after the review RPC
 * reported a real state change. Returns immediately; the staff response is
 * already on its way out and nothing here can alter it.
 */
export function firePaymentReviewNotification(review: PaymentReviewResult): void {
  const hook = process.env.N8N_PAYMENT_REVIEW_WEBHOOK_URL;
  const secret = process.env.N8N_AUTOMATION_SECRET;
  if (!hook || !secret) return;

  // The .catch is the last line of defence: an unhandled rejection inside
  // waitUntil would surface as a process-level error, which is exactly the
  // kind of blast radius a best-effort notification must never have.
  waitUntil(
    deliver(review, hook, secret).catch(() =>
      console.error(`PAYMENT_REVIEW_NOTIFY ${review.orderNumber} failed: unexpected`),
    ),
  );
}
