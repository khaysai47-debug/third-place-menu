import { z } from "zod";

import { supabaseAdmin } from "./orderIntake.server.js";
import { firePaymentReviewNotification } from "./paymentReviewNotify.server.js";
import { checkStaffSecret, jsonError } from "./staffOrderWrites.server.js";
import { supabaseAuthHeaders } from "./supabaseAuth.js";

// Server-only STAFF PAYMENT-PROOF REVIEW (revised Tuesday).
//
// Proofs ARRIVE from the chat via paymentIntake.server.ts (trusted n8n
// intake); there is no customer upload path. This module is staff-only:
// approve/reject.
//
// The exactly-once paid transition, the cancelled-order and already-paid
// guards, and the Transfer write ALL live in the review_payment_proof RPC —
// this route only authenticates, validates, calls it, and maps errors. Never log the secret/key — logs carry order number /
// decision / proof status only.

const reviewBody = z
  .object({
    proofId: z.string().uuid(),
    decision: z.enum(["approve", "reject"]),
    reviewer: z.string().max(80).optional(),
    reason: z.string().max(300).optional(),
  })
  .strict();

// review_payment_proof's machine-readable failures → safe staff messages.
const REVIEW_ERRORS: Record<string, { status: number; message: string }> = {
  PROOF_NOT_FOUND: { status: 404, message: "That payment slip no longer exists." },
  PROOF_ORDER_MISSING: { status: 409, message: "That slip's order no longer exists." },
  PROOF_ORDER_CANCELLED: { status: 409, message: "This order was cancelled — it can't be reviewed." },
  PROOF_ORDER_COMPLETED: {
    status: 409,
    message: "This order is already completed — its slip can't be reviewed.",
  },
  ORDER_ALREADY_PAID: {
    status: 409,
    message: "This order is already paid — reject the slip instead of approving it.",
  },
  PROOF_BAD_DECISION: { status: 400, message: "Invalid request body." },
  PROOF_REASON_REQUIRED: { status: 400, message: "A rejection reason is required." },
  PROOF_ALREADY_APPROVED: { status: 409, message: "That slip was already approved." },
  PROOF_ALREADY_REJECTED: { status: 409, message: "That slip was already rejected." },
};

/**
 * POST /api/staff/review-payment-proof — approve or reject a payment proof via
 * the review_payment_proof RPC. Approving flips the order to Paid (Transfer)
 * exactly once; rejecting keeps the order unpaid and frees the one-pending
 * slot, so the customer's next slip in the chat files as a new pending proof.
 */
export async function postReviewPaymentProof(request: Request): Promise<Response> {
  const denied = checkStaffSecret(request);
  if (denied) return denied;

  const body = reviewBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "Invalid request body.");
  const { proofId, decision, reviewer } = body.data;
  if (decision === "reject" && !body.data.reason?.trim()) {
    return jsonError(400, "A rejection reason is required.");
  }
  // The one validated reason string — sent to the RPC AND notified verbatim.
  const reason = body.data.reason?.trim() || null;

  const admin = supabaseAdmin("Server is not configured for payment proofs.");
  if (!admin.ok) return admin.response;
  const { base, key } = admin.value;

  let response: globalThis.Response;
  try {
    response = await fetch(`${base}/rest/v1/rpc/review_payment_proof`, {
      method: "POST",
      headers: supabaseAuthHeaders(key, { "Content-Type": "application/json" }),
      body: JSON.stringify({
        p_proof_id: proofId,
        p_decision: decision,
        p_reviewer: reviewer?.trim() || "Staff",
        p_reason: reason,
      }),
    });
  } catch {
    console.error("PAYMENT_PROOF review RPC unreachable");
    return jsonError(502, "Review could not be saved.");
  }

  if (!response.ok) {
    const err = (await response.json().catch(() => null)) as { message?: string } | null;
    const message = err?.message ?? `HTTP ${response.status}`;
    for (const [code, mapped] of Object.entries(REVIEW_ERRORS)) {
      if (message.includes(code)) return jsonError(mapped.status, mapped.message);
    }
    console.error(`PAYMENT_PROOF review rejected: ${message}`);
    return jsonError(502, "Review could not be saved.");
  }

  const result = (await response.json().catch(() => null)) as {
    proof_status?: string;
    order_number?: string;
    payment_status?: string;
    changed?: boolean;
  } | null;
  if (!result || typeof result.proof_status !== "string") {
    console.error("PAYMENT_PROOF review RPC returned an unexpected shape");
    return jsonError(502, "Review could not be saved.");
  }

  console.log(
    `PAYMENT_PROOF review ${result.order_number ?? "?"} decision=${decision} proof=${result.proof_status} changed=${result.changed === true}`,
  );

  // Tell the chat — best-effort, AFTER the RPC committed, never awaited. Only
  // a real state change notifies: an idempotent replay (changed=false) must
  // not message the customer twice, and a failed review never reaches here.
  if (result.changed === true && typeof result.order_number === "string") {
    firePaymentReviewNotification({
      orderNumber: result.order_number,
      decision,
      rejectionReason: reason,
      paymentStatus: result.payment_status ?? null,
    });
  }

  return Response.json(
    {
      ok: true,
      decision,
      proofStatus: result.proof_status,
      orderNumber: result.order_number ?? null,
      paymentStatus: result.payment_status ?? null,
      changed: result.changed === true,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
