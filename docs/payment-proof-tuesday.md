# Tuesday — Payment Proof & Staff Operations (apply guide, CORRECTED)

The Atlas half of the chat-based payment flow, and the exact order to turn it
on. Nothing here is run by a tool — SQL is pasted manually, the storage bucket
is created by hand.

## The customer journey (frozen)

```
Customer messages on Instagram / Messenger
  → bot sends ONE secure ordering link
  → customer submits the order through that link   (link is now consumed)
  → Atlas creates the order, dispatches order.created to n8n
  → n8n fetches authoritative details from /api/automation/order-details
  → bot sends the ELECTRONIC RECEIPT + static QR in the SAME chat
  → customer sends the payment-slip IMAGE in the SAME chat
  → n8n downloads it with its Meta credential and POSTs it to
    /api/automation/payment-proof                  (trusted, server-to-server)
  → Atlas stores it privately, files a PENDING payment_proofs row
  → staff approve or reject in the dashboard
  → approve → order becomes Paid (Transfer) exactly once
    reject  → bot sends the reason to the SAME chat; customer sends a new slip
```

**There is no second customer payment link. There is no public proof-upload
page.** The ordering link creates exactly one order, stays consumed, and can
never carry payment proof. The chat is the only customer-facing surface after
checkout.

**Meta/n8n workflow implementation is Wednesday.** Tuesday ships only the
protected Atlas intake/review foundation the Wednesday workflow calls.

## What shipped (Atlas side)

- **Frozen order-status vocabulary** — `new, accepted, preparing,
  ready_for_pickup, out_for_delivery, delivered, completed, cancelled`, with an
  authoritative server-side transition guard on `POST /api/staff/update-status`
  (one legal step per order type; cancellation has its own route).
- **Trusted proof intake** — `POST /api/automation/payment-proof`,
  server-to-server only, authenticated with `x-proof-secret`. Resolves the order
  from `bot_sessions` by chat identity; validates image magic bytes; stores
  privately; inserts a `pending` proof.
- **Staff review** — proof summary on the dashboard, full audit history in the
  drawer with short-lived signed previews, Approve, Reject-with-required-reason.
- **Exactly-once paid** — approving flips the order to Paid once inside
  `review_payment_proof`, which sets `payment_method = 'Transfer'`
  **explicitly** (a stale value on an unpaid order does not survive the
  transition) and refuses cancelled, **completed**, and already-paid orders.
- **Completed orders are closed for review** — both Approve and Reject raise
  `PROOF_ORDER_COMPLETED` before any write, so the proof stays pending and
  `payment_status`/`paid_at` cannot move. The route maps it to a 409 with a
  staff-safe message.
- **Cash-only manual payment** — `mark-paid` accepts Cash only (the server
  refuses Transfer); Transfer becomes paid solely via approved proof review.
  Both paid paths go through guarded RPCs (`mark_order_paid_cash`,
  `review_payment_proof`).
- **No permanent proof URLs** — the dashboard poll returns proof metadata with
  no URL field at all, and the history endpoint returns only freshly signed,
  short-lived URLs derived from the private path. The legacy `proof_url`
  column is never selected, so an old permanent public link cannot reach a
  client. Legacy rows show "Legacy proof preview unavailable" (`hasFile:
  false`); migrating those objects into the private bucket is optional and
  manual.
- **System-wide `paid_at` immutability** — a trigger blocks rewriting `paid_at`
  once set (documented admin escape for repairs); no route PATCHes `paid_at`.
- **One pending proof per order** — DB partial unique index; rejected proofs are
  retained for audit and free the slot for the customer's next slip.

## Trusted intake contract (what Wednesday's n8n must send)

`POST /api/automation/payment-proof` · `multipart/form-data` · **never from a
browser**

| Header | Value |
| --- | --- |
| `x-proof-secret` | `PAYMENT_PROOF_SECRET` (constant-time compared; unset → 500, wrong → 401) |

| Field | Required | Rule |
| --- | --- | --- |
| `channel` | yes | `instagram` \| `messenger` — anything else is 400 |
| `externalChatId` | yes | the Meta PSID/IGSID, `[A-Za-z0-9._-]{1,128}` |
| `orderNumber` | recommended | the authoritative order number from n8n's conversation state, `[A-Za-z0-9-]{1,32}` |
| `file` | yes | the slip image: JPEG/PNG/WebP, non-empty, ≤ 5 MB, magic bytes must match the declared MIME |

Atlas never trusts a client-supplied order UUID. It resolves
`platform + external_chat_id → bot_sessions.order_id` and only considers orders
that came from **that** conversation. `orderNumber` narrows within that set; it
can never widen it.

**Response** — `200 {"ok":true,"status":"pending","orderNumber":"TP-IG-1"}`.
No storage path, no URL, no chat id, ever.

**Failures** — stable `code` for n8n to branch on:

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 401 | `UNAUTHORIZED` | missing/wrong `x-proof-secret` |
| 400 | `UNSUPPORTED_CHANNEL` / `INVALID_CHAT_ID` / `INVALID_ORDER_NUMBER` / `NO_FILE` / `EMPTY_FILE` / `INVALID_BODY` | malformed submission |
| 413 | `FILE_TOO_LARGE` | > 5 MB |
| 415 | `UNSUPPORTED_CONTENT_TYPE` / `UNSUPPORTED_MEDIA_TYPE` / `NOT_AN_IMAGE` / `MIME_MISMATCH` | not an acceptable image |
| 404 | `NO_ORDER_FOR_CHAT` / `NO_UNPAID_ORDER` | nothing to attach to |
| 409 | `ORDER_CHAT_MISMATCH` | that order is not this conversation's |
| 409 | `AMBIGUOUS_ORDER` | several unpaid orders, no `orderNumber` — **resend with one** |
| 409 | `ORDER_CANCELLED` / `ORDER_COMPLETED` / `ORDER_ALREADY_PAID` | order can no longer take a slip |
| 409 | `PENDING_PROOF_EXISTS` | a slip is already awaiting review — claimed **only** on a PostgreSQL `23505` naming `payment_proofs_one_pending_per_order` |
| 502 | `STORAGE_FAILED` / `INSERT_FAILED` | transient; safe to retry. Every other conflict or integrity failure (a bare 409, a different `23505`, FK/CHECK violations) lands here — never mislabelled as a pending proof |

No raw database message, constraint name, or PostgreSQL code is ever returned to
the caller. When storage succeeded but the insert failed, Atlas deletes the
orphan object; if that cleanup itself fails it logs one line (bucket + HTTP
status only) and **still returns the original error** — cleanup never masks the
real failure.

n8n downloads the Meta attachment with its own private Meta credential and
forwards the **binary** here. It holds no Supabase credential and never writes
storage or the database directly.

## Order ↔ chat correlation

`bot_sessions` already carries `platform`, `external_chat_id`, and the
`order_id` stamped when the session was consumed at checkout — that is the whole
correlation key, so nothing new was needed:

1. `platform` **must** equal the submitted `channel`.
2. `external_chat_id` **must** equal the submitted `externalChatId`.
3. Candidate orders = those linked to that chat. If `orderNumber` was sent, it
   must be in that set (else `ORDER_CHAT_MISMATCH`).
4. Eligible = not cancelled, not completed, not already paid.
5. Exactly one eligible order → attach. Zero → 404. **More than one → refuse
   (`AMBIGUOUS_ORDER`); never guess, never attach to an older order.**

Because n8n knows the order number from the conversation it is receipting,
sending it makes step 5 deterministic even for a repeat customer.

## Electronic-receipt payload

`POST /api/automation/order-details` (existing, JWT-bound to the
`order.created` event) already returns everything the receipt needs — order
number, channel, order type, table number, status, payment status/method, the
line items with quantity/unit price/line total, subtotal, delivery fee, total,
created-at. The only addition is:

- `data.paymentQrUrl` — the static QR image URL from `PAYMENT_QR_URL`, or
  `null` when unset (then n8n supplies its own QR).

Customer name/phone/address stay in that payload because the delivery flow
needs them; the bot must only echo the fields it actually needs for the receipt.

## `payment.reviewed` — outbound review notification (Wednesday Phase 0)

After staff approve or reject a slip, the customer is waiting in the chat, not
on any Atlas page. Atlas sends **one** event to n8n so the bot can answer that
thread. Implemented in `api/_lib/paymentReviewNotify.server.ts`, fired from the
review route.

**Contract** — `POST $N8N_PAYMENT_REVIEW_WEBHOOK_URL`

```json
{
  "eventId": "<uuid v4>",
  "eventType": "payment.reviewed",
  "occurredAt": "<ISO-8601>",
  "orderNumber": "TP-IG-…",
  "channel": "instagram | messenger",
  "externalChatId": "<PSID/IGSID>",
  "decision": "approved | rejected",
  "rejectionReason": "<exact staff reason> | null",
  "paymentStatus": "paid | unpaid"
}
```

Headers: `Authorization: Bearer <JWT>`, `Content-Type: application/json`,
`x-atlas-event-id: <eventId>`.

**Authentication.** The same short-lived HS256 JWT as the `order.created`
bridge — issuer `atlas-order-bridge`, audience `n8n-order-automation`, 120 s
lifetime, 5 s `nbf` backdate, `jti` = `eventId` — with `sub` and `eventType`
both `payment.reviewed`. For the pilot it is signed with the **existing**
`N8N_AUTOMATION_SECRET`, so the receiving webhook uses the same n8n JWT
credential as the order bridge. n8n must check the JWT **and** that
`sub` is `payment.reviewed` before acting.

**Retry / idempotency.** Atlas delivery is **best-effort and not guaranteed**.
There is no retry and no durable outbox: Atlas generates one event and makes
one POST attempt (5 s timeout), so from the dispatcher the semantics are
effectively **at-most-once per review attempt** — a lost event is lost, not
redelivered. `eventId` is nonetheless the deduplication key and is bound three
ways — the body field, the JWT `jti`, and the `x-atlas-event-id` header. **n8n
must still deduplicate on `eventId`**, because a duplicate can still arrive
from an external retry, a manual replay, or any retry behavior added later; a
duplicate must never message the customer twice.

**Best-effort, by design.** The event is built *after* `review_payment_proof`
committed and is delivered on `waitUntil`, outside the staff response. A
missing webhook URL, a missing secret, an unresolvable chat, a non-2xx, a
timeout, or a network failure are all logged and otherwise ignored — none of
them changes, delays, or reverses what staff saw. A lost notification means a
customer waits for a human, never a wrong order state. Only a real state change
notifies (`changed = true`); idempotent replays and failed reviews send nothing.

**The chat is resolved server-side.** `order_number` → internal `order_id` →
the single completed `bot_sessions` row for that order supplies `channel` and
`externalChatId`. Neither is ever taken from the staff request. Counter/QR
orders have no bot session, so nothing is sent.

**No PII, no proof URL.** The payload carries identifiers and the decision
only. It never contains `proof_file_path`, a storage bucket or object path, a
signed or permanent proof URL, any Supabase id, customer name/phone/address, or
money. Logs additionally never carry the chat id, the JWT, the secret, or the
webhook URL; a non-2xx body is reduced to a redacted ≤120-char reason.

## `POST /api/automation/send-chat-message` — the app-owned sender (2026-08-02)

**Atlas now owns the shared customer-messaging endpoint.** It is the future
single place any automation goes to speak to a customer, and it exists so the
*idempotency decision* lives in PostgreSQL instead of in n8n.

**Why it moved into Atlas.** n8n Cloud on this account cannot cap a workflow at
concurrency 1, and an n8n Data Table offers no confirmed unique constraint and
no atomic claim. "Look up, then insert" there can elect **two** owners for one
`eventId` — which is how a customer gets told twice that their payment was
rejected. A single `INSERT` against a `UNIQUE event_id` settles it: one row
wins, everyone else gets SQLSTATE 23505 and sends nothing.

**Status — the Messenger send is LIVE in code (2026-08-04):**

- The **Messenger adapter is real.** `metaProvider.send` makes one Graph API
  call to `POST https://graph.facebook.com/<pinned version>/me/messages`
  whenever `META_PAGE_ACCESS_TOKEN` is set. Unsetting that variable is the
  emergency send-off switch: every send then answers a safe `needs_review`
  (`auth`) and consumes **no** `eventId`.
- **Instagram is NOT implemented.** `channel: "instagram"` is refused *before*
  the claim with `needs_review` / `other`, reaches no network, and stays
  replayable under the same `eventId` once it is implemented.
- **n8n has not been connected.** The Atlas Chat Sender nodes are disabled and
  disconnected; no workflow calls this route.
- **No real message has been sent.**
- The migration **has been applied**, so the `UNIQUE event_id` claim is real.

⚠️ Anyone holding `CHAT_MESSAGING_SECRET` can now make the app message a real
customer. Treat this endpoint as a live send path.

### The Messenger provider contract

| | |
| --- | --- |
| Request | `POST https://graph.facebook.com/<GRAPH_API_VERSION>/me/messages` |
| Headers | `Authorization: Bearer <META_PAGE_ACCESS_TOKEN>`, `Content-Type: application/json` — nothing else |
| Body | `{ "recipient": { "id": externalChatId }, "messaging_type": "RESPONSE", "message": { "text": message } }` |
| Timeout | 10 000 ms |
| Retry | **none, ever** |
| Success | HTTP 2xx **and** a non-empty string `message_id` → `messageRef` |

The API version is pinned in one constant (`GRAPH_API_VERSION`) because Meta
dates every version and drops it about two years later. Confirm it against the
App Dashboard before the first real send.

Graph error → the closed `errorClass` vocabulary. Unrecognised errors map to
`other` on purpose — a human reads it, rather than a guess hiding an expired
token behind a "rate limited" label:

| Graph signal | class |
| --- | --- |
| HTTP 429, code 4 / 32 / 613 | `rate_limited` |
| subcode 2018278 (24-hour window closed) | `outside_window` |
| subcode 2018001, code 551 / 230 | `invalid_recipient` |
| HTTP 401, code 190 / 102 / 10 / 200 / 3 | `auth` |
| timeout, transport failure, 2xx with no usable `message_id`, malformed body, anything else | `other` |

Subcode 2018278 is checked **before** the code-10 permission mapping: they share
a code and differ only by subcode. A 2xx without a usable `message_id` is
*ambiguous* — Meta may or may not have delivered it — so it is `needs_review`
and never a resend.

**Never logged, never persisted:** the Page token, the `Authorization` header,
the raw `externalChatId`, the message text, the Graph response body, and the
full Graph error body (Meta quotes the offending request back in it). The one
adapter log line carries the event id, the HTTP status, the numeric Graph
code/subcode and the mapped class — nothing else.

**Request** (server-to-server, `x-chat-messaging-secret`):

```json
{
  "eventId": "<uuid v4>",
  "orderNumber": "TP-IG-…",
  "channel": "instagram | messenger",
  "externalChatId": "<PSID/IGSID>",
  "message": { "type": "text", "text": "<already-composed customer-safe text>" }
}
```

Exact keys only; unknown keys are refused, not stripped. The caller composes the
message — this endpoint never writes, translates, or decorates one.

⚠️ **`message` is an object, not a string** (2026-08-04). It is a strict
discriminated union on `type`; the untagged string form is gone. Nothing calls
this route yet, so no caller had to change.

### `message.type: "buttons"` — the Messenger button template

The second variant. **Messenger only** — a buttons message on any other channel
is a `400`, refused before the claim.

```json
{
  "type": "buttons",
  "text": "Hi! Welcome to The Third Place 👋\nHow can we help you today?",
  "buttons": [
    { "type": "postback", "title": "Location",       "payload": "SHOW_LOCATION" },
    { "type": "postback", "title": "Opening Hours",  "payload": "SHOW_OPENING_HOURS" },
    { "type": "web_url",  "title": "Place an Order", "url": "<secure Atlas order link>" }
  ]
}
```

| Field | Rule |
| --- | --- |
| `text` | 1–640 chars, non-blank (Meta's button-template limit, tighter than the 1 000 for plain text) |
| `buttons` | **1–3** entries (Meta's limit), in caller order |
| `title` | 1–20 chars, non-blank |
| `payload` | `^[A-Z0-9_]{1,100}$` — Atlas vocabulary, not free text |
| `url` | **HTTPS only**, ≤ 2 000 chars, a valid URL |

Both button shapes are `.strict()`: a `payload` on a `web_url` button, or a
`url` on a `postback`, is refused rather than stripped — a stripped `url` would
ship a button that goes nowhere.

Sent to Meta as:

```json
{ "recipient": { "id": "<psid>" }, "messaging_type": "RESPONSE",
  "message": { "attachment": { "type": "template", "payload": {
    "template_type": "button", "text": "…", "buttons": [ … ] } } } }
```

**Transport only.** This endpoint does not interpret a postback payload and no
button does anything yet — handling the returned postbacks is a separate
change. The caller supplies every title, payload and URL; nothing is composed
here. Titles, payloads and URLs are never logged and never persisted, exactly
like message text.

**Normalized response** — one shape for every dispatch outcome:

```json
{ "ok": true,  "provider": "meta", "messageRef": "<ref>", "errorClass": null, "status": "sent" }
{ "ok": true,  "provider": "meta", "messageRef": "<ref|null>", "errorClass": null, "status": "duplicate" }
{ "ok": true,  "provider": "meta", "messageRef": null, "errorClass": null, "status": "in_progress" }
{ "ok": false, "provider": "meta", "messageRef": null, "errorClass": "rate_limited|outside_window|invalid_recipient|auth|other", "status": "needs_review" }
```

`401`/`400`/`500` are transport-level refusals with the usual generic error body
(the request never became a dispatch). `503` carries the normalized shape when
nothing was attempted because a dependency was down.

**Idempotency.** `eventId` is the key. The insert *is* the claim; only the
caller whose insert wins may invoke the provider. A duplicate reads the stored
row and answers `duplicate` (already sent), `in_progress` (claim held), or
`needs_review` (already parked for a human) — and sends nothing.

**Outside-window and provider failures route to `needs_review`, and there is NO
automatic retry.** A failed, throwing, or unknown-outcome send is recorded and
handed to a human. If the send succeeded but the completion write did not, the
row stays `processing`, so every later duplicate reads `in_progress` and the
message can never go out twice — a lost completion write can only suppress a
future send, never cause one. Manual staff messaging remains the fallback.

**Privacy.** The dispatch row never holds the raw `externalChatId`, the message
text, an Authorization header, a JWT, a secret, or a provider response body. It
stores a **keyed** one-way `chat_ref` (HMAC over channel + chat id, keyed with
`CHAT_MESSAGING_SECRET`, 16 hex chars) whose format CHECK makes writing a raw
PSID impossible. Logs carry order number / event id / channel / `chat_ref` /
state only.

## Environment variables

| Name | Scope | Purpose |
| --- | --- | --- |
| `PAYMENT_PROOF_SECRET` | server only | `x-proof-secret` for trusted intake. Fails closed when unset. |
| `CHAT_MESSAGING_SECRET` | server only | `x-chat-messaging-secret` for the app-owned sender; also keys `chat_ref`. Fails closed when unset. Not set anywhere yet. |
| `PAYMENT_PROOFS_BUCKET` | server only | Private storage bucket. Defaults to `payment-proofs`. |
| `PAYMENT_QR_URL` | server only | Static QR image URL returned to n8n for the chat receipt. Public image link, optional. |
| `N8N_PAYMENT_REVIEW_WEBHOOK_URL` | server only | Webhook receiving `payment.reviewed`. Unset → notification skipped, review unaffected. |
| `N8N_AUTOMATION_SECRET` | server only | Existing order-bridge secret, **reused** to sign `payment.reviewed` for the pilot. |

Never prefix any of these with `VITE_` — no browser code reads them.

## Deployment sequence (forward)

1. **Create the private storage bucket** (once — see below).
2. **Run the migration** `docs/sql/2026-07-27-payment-proof-review.sql` section
   by section, starting with the read-only `§ 0` pre-check. Do not run `§ 1+`
   until `§ 0` shows no unclassified legacy proof/order statuses.
3. **Set env vars** in Vercel (`PAYMENT_PROOF_SECRET` at minimum).
4. **Deploy the app** (this branch). Until the migration runs, the intake and
   review routes fail safe (500) and no data is touched.
5. Hard-refresh the staff/owner devices.

SQL must precede the deploy (the RPCs, the one-pending index, the status CHECK,
and the `paid_at` trigger must exist first). Rollback is the reverse — revert
and redeploy the app, then run the migration's `§ 9`.

⛔ **Keep the legacy n8n "Add Payment Proof" workflow DISABLED.** It inserts the
old `received` status (now rejected by the `payment_proofs_status_check`), writes
no `proof_file_path`, and satisfies none of the trusted-intake contract above.

## Manual Supabase storage bucket setup

Create the bucket by hand (never from code):

1. Supabase → **Storage** → **New bucket**.
2. Name: **`payment-proofs`** (or match `PAYMENT_PROOFS_BUCKET`).
3. **Public: OFF**.
4. Optional hardening: allowed MIME `image/jpeg,image/png,image/webp`, max size
   **5 MB** (mirrors the server route).
5. **No public policies.** The server uses the service-role key; staff preview
   uses short-lived **signed URLs** (10-min TTL) generated server-side.

## Verification

- `npm run typecheck`
- `npm run test:status-transitions` (transition guard + Cash-only mark-paid + idempotency)
- `npm run test:payment-intake` (auth, chat↔order binding, ambiguity refusal, magic bytes, cleanup)
- `npm run test:payment-proof` (review mapping incl. cancelled / already-paid)
- `npm run test:order-details` (receipt payload contract)
- `npm run test:dashboard` / `test:dashboard-parity` (no signing on poll; on-demand signed history; no storage path leaks)
- `npm run build`
- In-database: the migration's `§ 8` (schema) and `§ 8b` (**staging only**:
  pending-status default + legacy-value rejection, Cash idempotency, `paid_at`
  immutability trigger, approve-once, reject-then-resubmit, cancelled-order
  refusal, **completed-order refusal for both decisions (T7b)**, already-paid
  refusal, **stale-method → Transfer and replay stability (T7c)**, one-pending
  guard).

## Payment rules (operational summary)

- Manual mark-paid is **Cash only**. The Transfer button does not exist and the
  server rejects a Transfer request outright.
- **Transfer requires an approved payment proof** — that is the only path that
  writes `payment_method = 'Transfer'`, and it sets it explicitly rather than
  preserving whatever was there.
- **Completed orders cannot have proofs approved or rejected**; cancelled orders
  cannot either. Neither the proof nor the payment fields change.
- `paid_at` is stamped once and is immutable (DB trigger, documented admin
  escape for repairs).
- The legacy n8n **Add Payment Proof** workflow must remain **disabled**.
- Legacy permanent `proof_url` values are **not returned by any active staff
  API**.

## Manual test checklist (after deploy, on a staging/test order)

1. Place an order via a secure bot-session link; the confirmation shows the
   order number only — no QR, no upload control, no second link.
2. `curl` the intake endpoint without `x-proof-secret` → 401.
3. Submit a slip for that chat with the correct `channel`/`externalChatId` →
   `pending`; the staff dashboard shows the proof.
4. Submit a second slip immediately → `PENDING_PROOF_EXISTS`.
5. Staff drawer → **Reject** with a reason → order stays unpaid; submit a new
   slip → accepted as a new pending proof; the rejected one stays in history.
6. **Approve** → order flips to **Paid (Transfer)** once; approving again does
   not move `paid_at`.
7. Confirm the drawer's **Paid Cash** button is the only manual payment option
   and a manual Transfer is impossible.
8. Advance the order to **completed**, then try to approve and to reject a
   pending slip → both refused; the proof stays pending and the order stays
   unpaid.
9. Advance an order through its type's flow; illegal jumps are refused.

## Rollback

Revert/redeploy the app commit FIRST, then run the migration's `§ 9` (drop the
RPCs, the `paid_at` trigger, the proof constraints). If you roll the app back to
the pre-Tuesday vocabulary you MUST drop `orders_status_check` (`§ 9.4`) or the
old app cannot write `ready`/`done`. Stored slip images are retained; delete the
bucket manually only if no proof is needed for audit.
