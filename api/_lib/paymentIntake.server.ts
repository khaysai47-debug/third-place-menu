import { randomUUID } from "node:crypto";
import process from "node:process";

import { supabaseAdmin } from "./orderIntake.server.js";
import { jsonError, secretMatches } from "./staffOrderWrites.server.js";
import { supabaseAuthHeaders } from "./supabaseAuth.js";

// Server-only TRUSTED PAYMENT-PROOF INTAKE — the ONLY way a payment slip
// enters Atlas.
//
// THE FLOW THIS SERVES: the customer sends the slip image INSIDE Instagram or
// Messenger. n8n receives the Meta webhook, downloads the attachment with its
// own private Meta credential, and POSTs the raw bytes here. There is NO
// customer-facing upload page and NO second payment link — the ordering link
// creates exactly one order and can never carry proof.
//
// TRUST MODEL: server-to-server only, x-proof-secret (PAYMENT_PROOF_SECRET),
// constant-time compared — the same shape as x-bot-secret on the bot-session
// route, with its own secret so proof intake and ordering-link minting rotate
// independently. Fails closed when the secret is unset. No CORS headers: a
// browser has no business here.
//
// THE ORDER IS NEVER TAKEN FROM THE CALLER'S WORD. n8n sends the trusted chat
// identity (channel + externalChatId) and, normally, the order number from its
// conversation state. Atlas resolves the order through bot_sessions —
// platform + external_chat_id → order_id — so a proof can only ever attach to
// an order that DID come from that exact chat. An order number not linked to
// the chat is refused, and an ambiguous match is refused rather than guessed.
//
// LOGGING: never log file bytes, the secret, the chat id, or storage keys.
// Logs carry order number / channel / outcome only.

/* ── Limits + vocabulary ─────────────────────────────────────────────────── */

const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_FIELD_BYTES = 200;

/** Meta PSID/IGSID charset — mirrors EXTERNAL_CHAT_ID_PATTERN in botSession. */
const EXTERNAL_CHAT_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

/** order_number charset — mirrors the intake formats (TP-/TP-S-/TP-IG-/TP-MS-). */
const ORDER_NUMBER_PATTERN = /^[A-Za-z0-9-]{1,32}$/;

/** Only chat channels can carry proof; customer/staff orders never do. */
const PROOF_CHANNELS = ["instagram", "messenger"] as const;

/** Order states that can no longer receive a payment slip. */
const CLOSED_STATUSES = ["cancelled", "completed"] as const;

/** Accepted image types + the extension used for the storage key. */
const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const bucketName = (): string => process.env.PAYMENT_PROOFS_BUCKET || "payment-proofs";

/**
 * Machine-readable failure for n8n plus a human message. n8n branches on
 * `code`; these codes are part of the Wednesday contract (see
 * docs/payment-proof-tuesday.md) and must stay stable.
 */
const intakeError = (status: number, code: string, error: string): Response =>
  Response.json({ ok: false, code, error }, { status, headers: { "Cache-Control": "no-store" } });

/* ── File signature validation (magic bytes — never trust Blob.type alone) ─ */

/** Returns the MIME the bytes ACTUALLY are, or null if unrecognized/too short. */
export function detectImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // WebP: "RIFF" (0-3) .... "WEBP" (8-11)
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/* ── Trusted-caller authentication ───────────────────────────────────────── */

/**
 * Checks x-proof-secret against PAYMENT_PROOF_SECRET in constant time.
 * DELIBERATELY NOT STAFF_WRITE_SECRET (it lives in staff-device localStorage)
 * and NOT BOT_SESSION_SECRET (minting ordering links is a different power).
 */
function checkProofSecret(request: Request): Response | null {
  const secret = process.env.PAYMENT_PROOF_SECRET;
  if (!secret) return jsonError(500, "Server is not configured for payment-proof intake.");
  if (!secretMatches(request.headers.get("x-proof-secret"), secret)) {
    return intakeError(401, "UNAUTHORIZED", "Unauthorized.");
  }
  return null;
}

/* ── Supabase reads ──────────────────────────────────────────────────────── */

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
      console.error(`PAYMENT_PROOF_INTAKE read failed: ${what} responded ${response.status}`);
      return null;
    }
    const rows: unknown = await response.json().catch(() => null);
    return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : null;
  } catch {
    // Never log the error object — fetch errors can carry the Supabase host.
    console.error(`PAYMENT_PROOF_INTAKE read failed: ${what} unreachable`);
    return null;
  }
}

type Candidate = { id: string; orderNumber: string; status: string; paymentStatus: string };

/**
 * Resolves (channel, externalChatId, optional orderNumber) → the ONE order the
 * proof may attach to, or a ready-to-send error Response.
 *
 * Step 1 is the security boundary: the only orders considered are those whose
 * bot_sessions row carries this exact platform + external_chat_id. A caller
 * cannot name an arbitrary order UUID, or an order number from another chat.
 * Step 2 narrows by the caller's order number when it sent one (the normal
 * case — n8n knows it from its conversation state). Step 3 requires exactly
 * one eligible order: zero and many are BOTH refused, never guessed.
 */
async function resolveOrder(
  base: string,
  key: string,
  channel: string,
  externalChatId: string,
  orderNumber: string | null,
): Promise<Candidate | Response> {
  const sessions = await getRows(
    base,
    key,
    `bot_sessions?platform=eq.${encodeURIComponent(channel)}` +
      `&external_chat_id=eq.${encodeURIComponent(externalChatId)}` +
      `&order_id=not.is.null&select=order_id`,
    "bot_sessions",
  );
  if (sessions === null) return jsonError(502, "Order lookup failed.");

  const orderIds = [
    ...new Set(sessions.map((s) => s.order_id).filter((v): v is string => typeof v === "string")),
  ];
  if (orderIds.length === 0) {
    return intakeError(404, "NO_ORDER_FOR_CHAT", "No order is linked to this conversation.");
  }

  const rows = await getRows(
    base,
    key,
    `orders?id=in.(${orderIds.map(encodeURIComponent).join(",")})` +
      `&select=id,order_number,status,payment_status`,
    "orders",
  );
  if (rows === null) return jsonError(502, "Order lookup failed.");

  let candidates: Candidate[] = rows
    .filter((r) => typeof r.id === "string" && typeof r.order_number === "string")
    .map((r) => ({
      id: r.id as string,
      orderNumber: r.order_number as string,
      status: typeof r.status === "string" ? r.status : "",
      paymentStatus: typeof r.payment_status === "string" ? r.payment_status : "",
    }));

  // The caller named an order: it must belong to THIS chat. Narrow first, so a
  // linked-but-closed order reports WHY instead of "not linked".
  if (orderNumber) {
    candidates = candidates.filter((c) => c.orderNumber === orderNumber);
    if (candidates.length === 0) {
      return intakeError(
        409,
        "ORDER_CHAT_MISMATCH",
        "That order does not belong to this conversation.",
      );
    }
  }

  const eligible = candidates.filter(
    (c) =>
      !(CLOSED_STATUSES as readonly string[]).includes(c.status) &&
      c.paymentStatus.toLowerCase() !== "paid",
  );

  if (eligible.length === 1) return eligible[0];

  if (eligible.length === 0) {
    // Exactly one candidate that is closed → report the precise reason.
    const only = candidates.length === 1 ? candidates[0] : null;
    if (only?.status === "cancelled") {
      return intakeError(409, "ORDER_CANCELLED", "This order was cancelled.");
    }
    if (only && only.paymentStatus.toLowerCase() === "paid") {
      return intakeError(409, "ORDER_ALREADY_PAID", "This order is already paid.");
    }
    if (only?.status === "completed") {
      return intakeError(409, "ORDER_COMPLETED", "This order is already completed.");
    }
    return intakeError(404, "NO_UNPAID_ORDER", "This conversation has no unpaid order.");
  }

  // Several unpaid orders in one chat and no order number to disambiguate.
  // Refuse — attaching to the wrong order is worse than asking n8n to resend
  // with the authoritative order number from its conversation state.
  return intakeError(
    409,
    "AMBIGUOUS_ORDER",
    "Several unpaid orders match this conversation — include orderNumber.",
  );
}

/* ── POST /api/automation/payment-proof (trusted-server-only) ────────────── */

/**
 * Accepts one payment slip from n8n and files it as a PENDING proof for staff
 * review. Auth → fields → file validation → order resolution → private storage
 * → payment_proofs insert. Any insert failure deletes the just-stored object,
 * so storage never keeps a file no row points at. The response never contains
 * a storage path or a URL of any kind.
 */
export async function postAutomationPaymentProof(request: Request): Promise<Response> {
  const denied = checkProofSecret(request);
  if (denied) return denied;

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROOF_BYTES + 4096) {
    return intakeError(413, "FILE_TOO_LARGE", "File too large.");
  }
  const mediaType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mediaType !== "multipart/form-data") {
    return intakeError(415, "UNSUPPORTED_CONTENT_TYPE", "Unsupported content type.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return intakeError(400, "INVALID_BODY", "Invalid upload.");
  }

  const field = (name: string): string | null => {
    const value = form.get(name);
    return typeof value === "string" && value.length <= MAX_FIELD_BYTES ? value : null;
  };

  const channel = field("channel");
  if (!channel || !(PROOF_CHANNELS as readonly string[]).includes(channel)) {
    return intakeError(400, "UNSUPPORTED_CHANNEL", "Unsupported channel.");
  }
  const externalChatId = field("externalChatId");
  if (!externalChatId || !EXTERNAL_CHAT_ID_PATTERN.test(externalChatId)) {
    return intakeError(400, "INVALID_CHAT_ID", "Invalid chat id.");
  }
  const orderNumberField = field("orderNumber");
  if (orderNumberField !== null && !ORDER_NUMBER_PATTERN.test(orderNumberField)) {
    return intakeError(400, "INVALID_ORDER_NUMBER", "Invalid order number.");
  }

  const fileField = form.get("file");
  if (!(fileField instanceof Blob)) return intakeError(400, "NO_FILE", "No file uploaded.");
  if (fileField.size === 0) return intakeError(400, "EMPTY_FILE", "The uploaded file is empty.");
  if (fileField.size > MAX_PROOF_BYTES) return intakeError(413, "FILE_TOO_LARGE", "File too large.");
  const declaredType = fileField.type;
  if (!ALLOWED_IMAGE_TYPES[declaredType]) {
    return intakeError(415, "UNSUPPORTED_MEDIA_TYPE", "Only JPEG, PNG, or WebP is accepted.");
  }

  // Read the bytes ONCE — used for both signature validation and the upload.
  const buffer = await fileField.arrayBuffer();
  const detected = detectImageType(new Uint8Array(buffer));
  if (!detected) {
    return intakeError(415, "NOT_AN_IMAGE", "That file is not a valid image.");
  }
  if (detected !== declaredType) {
    // Declared MIME lies about the real bytes — reject (defeats a renamed file).
    return intakeError(415, "MIME_MISMATCH", "The file type does not match its contents.");
  }
  const ext = ALLOWED_IMAGE_TYPES[detected];

  const admin = supabaseAdmin("Server is not configured for payment proofs.");
  if (!admin.ok) return admin.response;
  const { base, key } = admin.value;

  const order = await resolveOrder(base, key, channel, externalChatId, orderNumberField);
  if (order instanceof Response) return order;

  // Unguessable private key — never the sender's filename, never predictable.
  const objectKey = `${order.id}/${randomUUID()}.${ext}`;
  const bucket = bucketName();
  if (!(await storagePut(base, key, bucket, objectKey, buffer, detected))) {
    console.error(`PAYMENT_PROOF_INTAKE storage failed for ${order.orderNumber}`);
    return intakeError(502, "STORAGE_FAILED", "Proof could not be stored.");
  }

  const insert = await insertPendingProof(base, key, order.id, objectKey, channel);
  if (insert !== "ok") {
    await storageDelete(base, key, bucket, objectKey);
    return insert === "conflict"
      ? intakeError(409, "PENDING_PROOF_EXISTS", "A payment slip is already awaiting review.")
      : intakeError(502, "INSERT_FAILED", "Proof could not be recorded.");
  }

  console.log(`PAYMENT_PROOF_INTAKE ${order.orderNumber} channel=${channel} status=pending`);
  return Response.json(
    { ok: true, status: "pending", orderNumber: order.orderNumber },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/* ── Storage + insert helpers ────────────────────────────────────────────── */

async function storagePut(
  base: string,
  key: string,
  bucket: string,
  objectKey: string,
  body: ArrayBuffer,
  contentType: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${base}/storage/v1/object/${bucket}/${encodeURI(objectKey)}`, {
      method: "POST",
      headers: supabaseAuthHeaders(key, {
        "Content-Type": contentType,
        "x-upsert": "false",
        "Cache-Control": "no-store",
      }),
      body,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Best-effort removal of an object whose payment_proofs row failed to insert.
 *
 * NEVER throws and never changes what the caller answers: the client already
 * has its real failure (INSERT_FAILED / PENDING_PROOF_EXISTS), and an orphaned
 * object must not turn that into something else. A failed cleanup emits ONE
 * operational line so orphans are noticeable — bucket name and HTTP status
 * only, never the object path, order number, chat id, customer data, or key.
 */
async function storageDelete(
  base: string,
  key: string,
  bucket: string,
  objectKey: string,
): Promise<void> {
  try {
    const response = await fetch(`${base}/storage/v1/object/${bucket}/${encodeURI(objectKey)}`, {
      method: "DELETE",
      headers: supabaseAuthHeaders(key),
    });
    if (!response.ok) {
      console.error(
        `PAYMENT_PROOF_INTAKE orphan cleanup failed: bucket=${bucket} responded ${response.status}`,
      );
    }
  } catch {
    // Never log the error object — a fetch error can carry the Supabase host.
    console.error(`PAYMENT_PROOF_INTAKE orphan cleanup failed: bucket=${bucket} unreachable`);
  }
}

/** THE one-pending-proof index (§ 3 of the migration) — the only 23505 that
 *  means "this order already has a slip awaiting review". */
const ONE_PENDING_INDEX = "payment_proofs_one_pending_per_order";

async function insertPendingProof(
  base: string,
  key: string,
  orderId: string,
  objectKey: string,
  channel: string,
): Promise<"ok" | "conflict" | "error"> {
  try {
    const response = await fetch(`${base}/rest/v1/payment_proofs`, {
      method: "POST",
      headers: supabaseAuthHeaders(key, {
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      }),
      body: JSON.stringify({
        order_id: orderId,
        proof_file_path: objectKey,
        source: `bot_${channel}`,
        status: "pending",
        received_at: new Date().toISOString(),
      }),
    });
    if (response.ok) return "ok";

    // "conflict" is claimed ONLY on PROOF of the expected one-pending index
    // violation: PostgreSQL 23505 (unique_violation) naming that exact index.
    // A bare 409, a different 23505 (another unique constraint), a foreign-key
    // or check violation are all real integrity failures and must surface as
    // INSERT_FAILED — telling the customer "a slip is already pending" when
    // something else broke would be a lie that stalls the order.
    const err = (await response.json().catch(() => null)) as {
      code?: string;
      message?: string;
      details?: string;
      constraint?: string;
    } | null;
    const namesIndex = [err?.message, err?.details, err?.constraint].some(
      (field) => typeof field === "string" && field.includes(ONE_PENDING_INDEX),
    );
    if (err?.code === "23505" && namesIndex) return "conflict";

    // Log the PostgREST code only — never the message, details, or body, which
    // can carry row values.
    console.error(
      `PAYMENT_PROOF_INTAKE insert failed: responded ${response.status} code=${err?.code ?? "?"}`,
    );
    return "error";
  } catch {
    console.error("PAYMENT_PROOF_INTAKE insert failed: unreachable");
    return "error";
  }
}
