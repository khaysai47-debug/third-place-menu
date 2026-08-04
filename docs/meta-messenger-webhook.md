# Meta Messenger callback — `/api/automation/meta-messenger-webhook`

App-owned receive-only endpoint for Meta Messenger webhooks.

**Status: receiving is configured.** The callback is verified and the Test Page
*Northfield Table Lab* is subscribed to `messages`, `messaging_postbacks`,
`message_deliveries` and `message_reads`. The n8n workflow *Atlas Messenger
Webhook Receiver (STAGING)* (`5BKEgw3dcsEJoA3X`) is still inactive and
untouched.

This endpoint is still **receive-only**. Sending now lives in
`chatMessaging.server.ts`, whose Messenger adapter is live — see
`docs/payment-proof-tuesday.md` § the app-owned sender. Nothing connects the
two: an inbound event does not trigger a reply.

## Why it exists

Meta subscribes **one** callback URL and uses it for both:

| Verb | Purpose                                         |
| ---- | ----------------------------------------------- |
| GET  | the one-time verification handshake             |
| POST | every event delivery afterwards                 |

n8n Cloud minted a **different public URL per HTTP method** for the same
workflow, so there was no single value that could be typed into Meta's callback
field. An app-owned route has one URL by construction.

## Files

| File                                              | Role                                              |
| ------------------------------------------------- | ------------------------------------------------- |
| `api/_lib/metaMessengerWebhook.server.ts`         | the only implementation                           |
| `api/router.ts`                                   | production dispatch (`automation/meta-messenger-webhook`) |
| `src/routes/api.automation.meta-messenger-webhook.ts` | the `npm run dev` twin                        |
| `scripts/test-meta-messenger-webhook.mjs`         | `npm run test:meta-messenger-webhook`             |

Same shape as every other endpoint here: one shared handler, two thin routing
surfaces, dev/production parity. No CORS headers — a browser has no business
here.

## Environment

All three are **server-only**. Never prefix with `VITE_` (those are inlined into
the client bundle). Read inside the handlers, never at module scope.

| Variable                           | Required | Unset behaviour                                     |
| ---------------------------------- | -------- | --------------------------------------------------- |
| `META_MESSENGER_VERIFY_TOKEN`      | for GET  | **every GET is 403** — Meta cannot subscribe        |
| `META_APP_SECRET`                  | for POST | **every POST is 500** — no event is processed       |
| `N8N_MESSENGER_EVENTS_WEBHOOK_URL` | no       | validate, answer 200, make **no** external request  |

Both secret checks use the repository's constant-time `secretMatches`
(`staffOrderWrites.server.ts`).

## GET contract

Reads `hub.mode`, `hub.verify_token`, `hub.challenge` from the query string.

**200** with `hub.challenge` echoed **verbatim** as
`text/plain; charset=utf-8` — and only — when:

- `hub.mode === "subscribe"`, **and**
- `hub.verify_token` matches `META_MESSENGER_VERIFY_TOKEN` in constant time, **and**
- `hub.challenge` is present and non-empty.

Plain text is not cosmetic: Meta compares the echoed body byte for byte, so a
JSON-quoted `"1158201444"` fails the handshake.

Everything else — unset token, wrong token, wrong mode, absent challenge — is
the **same generic `403 Forbidden`**. The refusal never says which check failed
and never echoes the challenge.

> The query survives the production rewrite: `vercel.json` sends `/api/:path*`
> to `/api/router?path=:path*` and Vercel **merges** the incoming query string
> into the destination, so the `hub.*` values arrive alongside the router's own
> `path` parameter.

## POST contract

Checks run in this order, and nothing downstream of a failure executes:

1. `META_APP_SECRET` present → else **500** (fails closed).
2. `x-hub-signature-256` present and matching `sha256=<64 lowercase hex>` →
   else **403** (missing / malformed).
3. Raw request **bytes** read via `arrayBuffer()` — before any parsing, and
   without a decode/re-encode round trip that could alter them.
4. Body ≤ 256 KiB → else **413**.
5. `HMAC-SHA256(META_APP_SECRET, raw bytes)` compared constant-time against the
   header digest → else **403**.
6. `JSON.parse` → else **400**.
7. `object === "page"` → else **400**. No other object type is accepted.

Then **200 `EVENT_RECEIVED`**, immediately. Forwarding happens on `waitUntil`
after the response, because Meta retries — and eventually unsubscribes the app —
if the 200 is slow.

## Sanitization

A Messenger payload is customer data: message text, attachments, the sender
PSID, the recipient Page ID. **None of it is logged, persisted, or forwarded.**
The raw body lives only long enough to verify its signature and count its
structure.

The only shape that leaves the module:

```jsonc
{
  "eventId": "3f2a…",              // 32 hex chars, see below
  "object": "page",
  "entryCount": 2,
  "messagingEventCount": 3,
  "events": [                       // one record per messaging event, in order
    { "category": "message",  "timestamp": 1754300000001 },
    { "category": "postback", "timestamp": 1754300000002 },
    { "category": "delivery", "timestamp": null }
  ],
  "receivedAt": "2026-08-04T09:00:00.000Z"
}
```

- **category** — `message | postback | delivery | read | other`, chosen by the
  discriminating key Meta puts on the event. Unrecognised or malformed →
  `other`, never a guess.
- **timestamp** — `event.timestamp` only when it is a finite number, else
  `null`. Never `entry.time`, never derived.
- **eventId** — `HMAC-SHA256(META_APP_SECRET, "atlas.metaevent.v1" ‖ 0x1F ‖
  body-digest)`, first 32 hex chars. **Deterministic**: Meta retries the
  identical body, so the identical id comes back and n8n can deduplicate on it.
  Keyed, so it discloses nothing about the payload; domain-separated, so it is
  never equal to the signature Meta sent.

The sanitizer reads only array lengths, the four discriminating keys, and one
numeric field. It never touches `sender`, `recipient`, `message`, or
`attachments`, so no identifier or content can reach the output even by
accident. Below the object check it is deliberately tolerant — a missing or
malformed `entry` / `messaging` array counts as zero rather than throwing,
because the signature already proved the sender.

Log lines carry `event=<eventId> entries=<n> events=<n>` and a forward status.
Never the body, a header, an identifier, a secret, or a `fetch` error message
(those can carry the webhook hostname — only `error.name` is logged).

## Forwarding

Only when `N8N_MESSENGER_EVENTS_WEBHOOK_URL` is set.

- POSTs the sanitized object above, and nothing else.
- `Content-Type: application/json`, plus `x-atlas-event-id` bound to `eventId`.
- 5 s timeout.
- **No retry.** Meta already retries the delivery and n8n deduplicates on
  `eventId`; retrying here would only multiply the same event.
- The response body is never read.
- A failure — refused connection, timeout, non-2xx — **never** changes the 200
  Meta receives.

Unset → a single `forwarding=disabled` log line and **zero** external requests.
Unsetting it is the emergency forward-off switch, exactly like the order bridge
and the payment-review notification.

⚠️ The forward is **unauthenticated** (see the `ponytail:` note in the module).
The n8n webhook URL's secrecy plus whatever auth is configured on the n8n node
is the trust boundary. Add a signed JWT — the `N8N_AUTOMATION_SECRET` pattern in
`paymentReviewNotify.server.ts` — before forwarding anything an injected event
could act on.

## What this endpoint cannot do

No Graph API call, no Page access token, no Supabase write, no customer message.
It receives. Sending is a separate module (`chatMessaging.server.ts`) behind a
separate endpoint, a separate secret, and a separate token — this file cannot
reach it and nothing routes an inbound event into a reply.

## Remaining work (not done here, deliberately)

1. Set the three variables in Vercel (Preview and Production).
2. Enter the URL and verify token in the Meta app and subscribe the Page.
3. Point `N8N_MESSENGER_EVENTS_WEBHOOK_URL` at a **new** n8n webhook and make it
   deduplicate on `eventId`.
4. Decide whether the forward needs its own signed auth.
