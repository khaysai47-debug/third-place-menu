// OrderRepository backed by the existing n8n bridge — THE LIVE IMPLEMENTATION.
//
// This adapter is a thin delegation layer: every method calls the exact
// function the UI called before the repository layer existed, so behavior
// (fetch semantics, error contracts, status translation, sorting) is
// byte-identical. All n8n/Airtable knowledge stays in src/lib/staffOrders.ts
// and src/lib/orders.ts.
//
// ── Boundary notes (backend separation) ──────────────────────────────────────
// - n8n is the CURRENT live bridge: the frontend talks only to n8n webhooks;
//   n8n talks to the actual store (Airtable today, Supabase during/after
//   migration). The frontend must never learn Airtable/Supabase details —
//   table names, record ids' meaning, credentials all live inside n8n.
// - THIS ADAPTER'S OUTPUT IS THE REFERENCE CONTRACT. Whatever the Supabase
//   adapter produces must match it field-for-field on the same data (see
//   src/lib/data/dev/adapterParity.ts) BEFORE reads flip. n8n defines
//   correct; Supabase must prove equal.
// - WRITES STAY HERE LONGER THAN READS. Reads migrate first (Phase 2C–2E);
//   status/payment/expense writes stay on n8n until Phase 2G because n8n
//   automations (notifications, bot replies) trigger off them.
// - n8n IS NOT GOING AWAY. After separation it keeps: Instagram/Messenger/
//   LINE/WeChat bot conversations, payment-proof intake (it writes the
//   hasPaymentProof/paymentProofUrl fields the dashboard displays),
//   notifications, and other automation. It stops being the app's query
//   engine; it stays the automation engine.
// - Do not modify webhook slugs/URLs from here — src/lib/n8n.ts is the only
//   module that knows they exist, and they are live production paths.

import {
  getStaffOrders,
  updateOrderPayment,
  updateStaffOrderStatus,
} from "@/lib/staffOrders";
import { submitOrder } from "@/lib/orders";
import type { OrderRepository } from "./types";

export const n8nOrdersAdapter: OrderRepository = {
  listOrders: () => getStaffOrders(),

  updateOrderStatus: (orderKey, status) => updateStaffOrderStatus(orderKey, status),

  // Cancellation is the same status write with the reason attached — matching
  // how staff.tsx has always called it.
  cancelOrder: (orderKey, reason) =>
    updateStaffOrderStatus(orderKey, "cancelled", { cancellationReason: reason }),

  updateOrderPayment: (orderKey, paymentMethod) => updateOrderPayment(orderKey, paymentMethod),

  submitOrder: (payload) => submitOrder(payload),
};
