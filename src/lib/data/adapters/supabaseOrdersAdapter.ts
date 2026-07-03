// OrderRepository backed by Supabase / the real backend — PHASE 2 STUB.
//
// NOT USED BY THE LIVE APP. Every method throws AdapterNotImplementedError so
// an accidental switch fails loudly on first use instead of silently breaking.
//
// Phase 2 implementation notes (see docs/backend-separation-map.md):
// - listOrders(): select orders (+ items) → map rows to StaffOrder with the
//   exact required/optional field semantics documented in "Phase 1 Data Shape
//   Findings". Sort newest-first by createdAt, like the n8n bridge does.
// - The UI status vocabulary (new/preparing/ready/out_for_delivery/delivered/
//   done/cancelled) is the contract. If the database keeps Airtable's
//   "completed" naming, translate it HERE (and only here), mirroring
//   API_STATUS_BY_UI / UI_STATUS_BY_API in staffOrders.ts.
// - orderKey: becomes the Supabase row id. StaffOrder.airtableRecordId is the
//   current carrier of this key — keep populating that field (or migrate it to
//   a neutral name in a coordinated rename) so screens keep working.
// - Write methods must keep the never-throw { success, error? } contract; the
//   UIs rely on it for optimistic revert + inline error banners.
// - Payment-proof fields (hasPaymentProof/paymentProofUrl/paymentProofStatus)
//   are written by the n8n bot flow and must still round-trip after reads move.

import type { OrderRepository } from "./types";
import { AdapterNotImplementedError } from "./types";

const notImplemented = (method: string) =>
  new AdapterNotImplementedError("supabaseOrdersAdapter", method);

export const supabaseOrdersAdapter: OrderRepository = {
  listOrders: async () => {
    throw notImplemented("listOrders");
  },
  updateOrderStatus: async () => {
    throw notImplemented("updateOrderStatus");
  },
  cancelOrder: async () => {
    throw notImplemented("cancelOrder");
  },
  updateOrderPayment: async () => {
    throw notImplemented("updateOrderPayment");
  },
  submitOrder: async () => {
    throw notImplemented("submitOrder");
  },
};
