// Customer order submission domain: payload contract + submit call.
// The checkout drawer and staff manual-order form build an OrderPayload and
// call submitOrder — they never touch transport details.
//
// SPLIT SOURCE (Phase 2G-I): submitOrder follows ORDER_INTAKE_SOURCE
// (src/lib/data/dataSource.ts):
// - "supabase": POSTs a NARROW body (item codes + quantities + order-type
//   details — never client money) to the app's secure server routes:
//   /api/order/submit (customer, public) or /api/staff/add-order
//   (x-staff-secret). The server recomputes every price/total from
//   menu_items and returns the authoritative server-generated order number,
//   which the UI displays. payload.orderId is IGNORED on this path.
// - "n8n": the original webhook bridge, kept UNTOUCHED as the one-line
//   rollback path (n8n does its own inserts from the full payload).

import { ORDER_INTAKE_SOURCE } from "./data/dataSource";
import { getStaffWriteSecret } from "./staffWriteSecret";
import { n8nWebhook } from "./n8n";

export interface OrderPayload {
  /** Idempotency key — ONE per intended order (crypto.randomUUID), reused on
   * retries so a network retry / double tap can never create a duplicate. */
  requestId: string;
  /** Client-generated display id — authoritative ONLY on the n8n path; the
   * Supabase path ignores it and returns the server-generated number. */
  orderId: string;
  createdAt: string;
  customer: {
    name: string | null;
    phone: string | null;
  };
  orderType: "dine_in" | "pickup" | "delivery";
  tableNumber: string | null;
  deliveryAddress: string | null;
  notes: string | null;
  items: {
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }[];
  totalItems: number;
  subtotalPrice: number;
  deliveryFee: number;
  totalPrice: number;
  status: "draft";
}

export type SubmitResult = { success: true; orderId: string } | { success: false; error: string };

/** Which intake surface to use — staff goes through the protected route. */
export type IntakeChannel = "customer" | "staff";

/* ── Supabase source (Phase 2G-I) ───────────────────────────────────────── */

const GENERIC_ERROR = "Failed to submit order. Please try again.";

async function submitOrderViaSupabase(
  payload: OrderPayload,
  channel: IntakeChannel,
): Promise<SubmitResult> {
  // Narrow trust boundary: codes + quantities only. Names/prices/totals in
  // the payload are display-only and deliberately not sent.
  const body = {
    requestId: payload.requestId,
    orderType: payload.orderType,
    tableNumber: payload.tableNumber,
    customerName: payload.customer.name,
    customerPhone: payload.customer.phone,
    customerAddress: payload.deliveryAddress,
    notes: payload.notes,
    items: payload.items.map((item) => ({ itemCode: item.id, quantity: item.quantity })),
  };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  let path = "/api/order/submit";
  if (channel === "staff") {
    const secret = getStaffWriteSecret();
    if (!secret) {
      return {
        success: false,
        error: "未設定員工密碼 · Staff secret not set — tap the key button in the header.",
      };
    }
    headers["x-staff-secret"] = secret;
    path = "/api/staff/add-order";
  }

  try {
    const response = await fetch(path, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => null)) as {
      ok?: boolean;
      orderNumber?: string;
      error?: string;
    } | null;
    if (!response.ok || data?.ok !== true || typeof data.orderNumber !== "string") {
      return { success: false, error: data?.error ?? GENERIC_ERROR };
    }
    return { success: true, orderId: data.orderNumber };
  } catch {
    return { success: false, error: GENERIC_ERROR };
  }
}

/* ── n8n source (original bridge — rollback path, do not modify) ────────── */

const WEBHOOK_URL = n8nWebhook("third-place-order-test");

async function submitOrderViaN8n(payload: OrderPayload): Promise<SubmitResult> {
  console.log("ORDER_DRAFT_PAYLOAD", payload);
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      return { success: false, error: GENERIC_ERROR };
    }
    return { success: true, orderId: payload.orderId };
  } catch {
    return { success: false, error: GENERIC_ERROR };
  }
}

/* ── Public API ─────────────────────────────────────────────────────────── */

export async function submitOrder(
  payload: OrderPayload,
  channel: IntakeChannel = "customer",
): Promise<SubmitResult> {
  return ORDER_INTAKE_SOURCE === "supabase"
    ? submitOrderViaSupabase(payload, channel)
    : submitOrderViaN8n(payload);
}
