// Staff order domain: types, status flow, and data access.
// Reads and writes orders through the n8n APIs (which talk to Airtable —
// Airtable credentials live in n8n, never here).

import { n8nWebhook } from "./n8n";

const STAFF_ORDERS_API_URL = n8nWebhook("third-place-staff-orders");
const UPDATE_STATUS_API_URL = n8nWebhook("third-place-update-order-status");
const UPDATE_PAYMENT_API_URL = n8nWebhook("third-place-update-payment");

export type StaffOrderStatus = "new" | "preparing" | "ready" | "done" | "cancelled";

export type StaffOrderType = "dine_in" | "pickup" | "delivery";

export type StaffPaymentStatus = "unpaid" | "paid";

/** Exact Airtable "Payment Method" select values — sent verbatim to the API. */
export type StaffPaymentMethod = "Cash" | "Transfer";

export interface StaffOrderItem {
  /** Menu item id from the API; mock fixtures omit it. */
  id?: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface StaffOrder {
  /** Airtable record id — required for status updates; mock fixtures omit it. */
  airtableRecordId?: string;
  orderId: string;
  orderType: StaffOrderType;
  tableNumber: string | null;
  /** Wall-clock display time (HH:MM), derived from createdAt for live orders. */
  time: string;
  /** ISO timestamp from the API; mock fixtures omit it. */
  createdAt?: string;
  items: StaffOrderItem[];
  notes: string | null;
  totalPrice: number;
  status: StaffOrderStatus;
  /** Defaults to "unpaid" while the Staff Orders API doesn't map Payment Status. */
  paymentStatus: StaffPaymentStatus;
  paymentMethod?: StaffPaymentMethod;
  /** ISO timestamp written by n8n when payment is recorded. */
  paidAt?: string;
}

/** The only legal forward transitions. Done/cancelled are terminal. */
const NEXT_STATUS: Partial<Record<StaffOrderStatus, StaffOrderStatus>> = {
  new: "preparing",
  preparing: "ready",
  ready: "done",
};

export function nextStaffOrderStatus(status: StaffOrderStatus): StaffOrderStatus | null {
  return NEXT_STATUS[status] ?? null;
}

export type UpdateStaffOrderResult = { success: true } | { success: false; error: string };

/** Shape of one order as returned by the n8n Staff Orders API. */
interface ApiOrder {
  airtableRecordId?: unknown;
  orderId?: unknown;
  orderType?: unknown;
  tableNumber?: unknown;
  notes?: unknown;
  createdAt?: unknown;
  totalPrice?: unknown;
  status?: unknown;
  paymentStatus?: unknown;
  paymentMethod?: unknown;
  paidAt?: unknown;
  items?: {
    id?: unknown;
    name?: unknown;
    quantity?: unknown;
    unitPrice?: unknown;
  }[];
}

const STATUSES: StaffOrderStatus[] = ["new", "preparing", "ready", "done", "cancelled"];
const ORDER_TYPES: StaffOrderType[] = ["dine_in", "pickup", "delivery"];

// Airtable's Status field calls it "completed"; the staff UI calls it "done".
// Translate in both directions at this API boundary only — everything else
// (components, transition map, tabs) keeps using "done".
const API_STATUS_BY_UI: Partial<Record<StaffOrderStatus, string>> = {
  done: "completed",
};
const UI_STATUS_BY_API: Record<string, StaffOrderStatus> = {
  completed: "done",
};

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asNumber = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function mapApiOrder(raw: ApiOrder): StaffOrder {
  const rawStatus = asString(raw.status).toLowerCase();
  const status = UI_STATUS_BY_API[rawStatus] ?? (rawStatus as StaffOrderStatus);
  const orderType = asString(raw.orderType) as StaffOrderType;
  const createdAt = asString(raw.createdAt);
  const rawMethod = asString(raw.paymentMethod);
  return {
    airtableRecordId: asString(raw.airtableRecordId) || undefined,
    orderId: asString(raw.orderId),
    orderType: ORDER_TYPES.includes(orderType) ? orderType : "dine_in",
    tableNumber: asString(raw.tableNumber) || null,
    time: formatTime(createdAt),
    createdAt: createdAt || undefined,
    items: (raw.items ?? []).map((item) => ({
      id: asString(item.id) || undefined,
      name: asString(item.name),
      quantity: asNumber(item.quantity),
      unitPrice: asNumber(item.unitPrice),
    })),
    notes: asString(raw.notes) || null,
    totalPrice: asNumber(raw.totalPrice),
    status: STATUSES.includes(status) ? status : "new",
    paymentStatus: asString(raw.paymentStatus).toLowerCase() === "paid" ? "paid" : "unpaid",
    paymentMethod: rawMethod === "Cash" || rawMethod === "Transfer" ? rawMethod : undefined,
    paidAt: asString(raw.paidAt) || undefined,
  };
}

/**
 * Fetch the staff order board from the n8n Staff Orders API.
 * Throws on network/HTTP/shape errors — the page shows an error state with retry.
 */
export async function getStaffOrders(): Promise<StaffOrder[]> {
  const response = await fetch(STAFF_ORDERS_API_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Staff orders API responded ${response.status}`);
  }
  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error("Staff orders API returned an unexpected shape");
  }
  return (data as ApiOrder[])
    .map(mapApiOrder)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

/**
 * Persist a status change for one order via the n8n Update Order Status API,
 * which writes to the Airtable Status field.
 */
export async function updateStaffOrderStatus(
  airtableRecordId: string,
  status: StaffOrderStatus,
): Promise<UpdateStaffOrderResult> {
  try {
    const response = await fetch(UPDATE_STATUS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ airtableRecordId, status: API_STATUS_BY_UI[status] ?? status }),
    });
    const data = (await response.json().catch(() => null)) as { success?: boolean } | null;
    if (!response.ok || data?.success !== true) {
      return { success: false, error: "更新失敗 · Update failed. Try again." };
    }
    return { success: true };
  } catch {
    return { success: false, error: "無法連接伺服器 · Can't reach order server." };
  }
}

/**
 * Record a payment for one order via the n8n Update Payment API, which writes
 * Airtable's Payment Status / Payment Method (and Paid At, set by n8n).
 * Keyed by airtableRecordId — never the human order id.
 */
export async function updateOrderPayment(
  airtableRecordId: string,
  paymentMethod: StaffPaymentMethod,
): Promise<UpdateStaffOrderResult> {
  try {
    const response = await fetch(UPDATE_PAYMENT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ airtableRecordId, paymentStatus: "Paid", paymentMethod }),
    });
    const data = (await response.json().catch(() => null)) as { success?: boolean } | null;
    if (!response.ok || data?.success !== true) {
      return { success: false, error: "付款更新失敗 · Payment update failed. Try again." };
    }
    return { success: true };
  } catch {
    return { success: false, error: "無法連接伺服器 · Can't reach order server." };
  }
}
