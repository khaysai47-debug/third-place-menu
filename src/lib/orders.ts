// Customer order submission domain: payload contract + submit call.
// The checkout drawer builds an OrderPayload and calls submitOrder — it never
// touches transport details.
//
// TODO(separation): point submitOrder at the Supabase/backend order intake
// (or keep this one webhook if order intake stays an n8n automation) — the
// OrderPayload contract and SubmitResult shape should not change.

import { n8nWebhook } from "./n8n";

export interface OrderPayload {
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

const WEBHOOK_URL = n8nWebhook("third-place-order-test");

export async function submitOrder(payload: OrderPayload): Promise<SubmitResult> {
  console.log("ORDER_DRAFT_PAYLOAD", payload);
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      return { success: false, error: "Failed to submit order. Please try again." };
    }
    return { success: true, orderId: payload.orderId };
  } catch {
    return { success: false, error: "Failed to submit order. Please try again." };
  }
}
