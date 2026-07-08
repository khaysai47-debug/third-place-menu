import process from "node:process";

// Server-only helpers for the Phase 2G-D staff order write routes
// (src/routes/api.staff.*.ts). The .server.ts suffix keeps this out of the
// client bundle — SUPABASE_SERVICE_ROLE_KEY and STAFF_WRITE_SECRET are read
// via process.env INSIDE functions only (per config.server.ts rules).
//
// These routes are PREPARED but NOT LIVE: ACTIVE_WRITE_SOURCE stays "n8n"
// (src/lib/data/dataSource.ts) — only the per-device localStorage override in
// orderRepository.ts reaches them. Every patch replicates the n8n workflow
// behavior documented in docs/n8n-workflow-side-effects.md rows 2–3.

/** Uniform JSON error body — never includes stack traces or env values. */
export function jsonError(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}

/**
 * Checks the x-staff-secret header against STAFF_WRITE_SECRET.
 * Returns a Response to send (401/500) or null when authorized.
 */
export function checkStaffSecret(request: Request): Response | null {
  const secret = process.env.STAFF_WRITE_SECRET;
  if (!secret) return jsonError(500, "Server is not configured for staff writes.");
  if (request.headers.get("x-staff-secret") !== secret) {
    return jsonError(401, "Unauthorized.");
  }
  return null;
}

/**
 * PATCHes the `orders` row matched by order_number (the frontend orderId,
 * "TP-…") — NEVER by the row UUID; a client-sent UUID simply matches nothing.
 * Returns the number of rows updated, or a ready-to-send error Response.
 */
export async function patchOrderByNumber(
  orderNumber: string,
  patch: Record<string, unknown>,
): Promise<number | Response> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return jsonError(500, "Server is not configured for staff writes.");
  try {
    const response = await fetch(
      `${url.replace(/\/+$/, "")}/rest/v1/orders?order_number=eq.${encodeURIComponent(orderNumber)}`,
      {
        method: "PATCH",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify(patch),
      },
    );
    if (!response.ok) {
      console.error(`Supabase staff write failed: orders responded ${response.status}`);
      return jsonError(500, "Order update failed.");
    }
    const rows: unknown = await response.json();
    return Array.isArray(rows) ? rows.length : 0;
  } catch (error) {
    console.error("Supabase staff write failed", error);
    return jsonError(500, "Order update failed.");
  }
}

/**
 * Cancellation patch — mirrors the n8n Update Order Status workflow:
 * reason defaults to "Other", cancelled_at is stamped now.
 */
export function cancelledPatch(reason?: string): Record<string, unknown> {
  return {
    status: "cancelled",
    cancellation_reason: reason?.trim() || "Other",
    cancelled_at: new Date().toISOString(),
  };
}
