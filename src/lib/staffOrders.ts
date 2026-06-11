// Staff order domain: types, status flow, and data access.
// Reads live orders from the n8n Staff Orders API (which talks to Airtable —
// Airtable credentials live in n8n, never here). Status updates are still
// local/mock until the write-back workflow exists.

const STAFF_ORDERS_API_URL = "http://192.168.1.103:5678/webhook/third-place-staff-orders";

export type StaffOrderStatus = "new" | "preparing" | "ready" | "done" | "cancelled";

export type StaffOrderType = "dine_in" | "pickup" | "delivery";

export interface StaffOrderItem {
  /** Menu item id from the API; mock fixtures omit it. */
  id?: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface StaffOrder {
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

export type UpdateStaffOrderResult =
  | { success: true }
  | { success: false; error: string };

/** Shape of one order as returned by the n8n Staff Orders API. */
interface ApiOrder {
  orderId?: unknown;
  orderType?: unknown;
  tableNumber?: unknown;
  notes?: unknown;
  createdAt?: unknown;
  totalPrice?: unknown;
  status?: unknown;
  items?: {
    id?: unknown;
    name?: unknown;
    quantity?: unknown;
    unitPrice?: unknown;
  }[];
}

const STATUSES: StaffOrderStatus[] = ["new", "preparing", "ready", "done", "cancelled"];
const ORDER_TYPES: StaffOrderType[] = ["dine_in", "pickup", "delivery"];

const asString = (v: unknown): string => (typeof v === "string" ? v : "");
const asNumber = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function mapApiOrder(raw: ApiOrder): StaffOrder {
  const status = asString(raw.status).toLowerCase() as StaffOrderStatus;
  const orderType = asString(raw.orderType) as StaffOrderType;
  const createdAt = asString(raw.createdAt);
  return {
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
 * Persist a status change for one order.
 * Mock implementation: logs and reports success; the UI keeps its own local state.
 * Integration phase: POST to the n8n webhook / Airtable update, then return
 * the real outcome so the UI can roll back on failure.
 */
export async function updateStaffOrderStatus(
  orderId: string,
  status: StaffOrderStatus
): Promise<UpdateStaffOrderResult> {
  console.log("STAFF_ORDER_STATUS_UPDATE (mock)", { orderId, status });
  return { success: true };
}
