// Mock orders for the staff board (Phase 3A — UI foundation only).
// Not wired to Airtable/n8n; replaced by live data in a later phase.

export type StaffOrderStatus = "new" | "preparing" | "ready" | "done" | "cancelled";

export type StaffOrderType = "dine_in" | "pickup" | "delivery";

export interface StaffOrderItem {
  name: string;
  quantity: number;
}

export interface StaffOrder {
  orderId: string;
  orderType: StaffOrderType;
  tableNumber: string | null;
  /** Display time only (mock data) — avoids SSR/client clock mismatch. */
  time: string;
  items: StaffOrderItem[];
  totalPrice: number;
  status: StaffOrderStatus;
}

export const MOCK_ORDERS: StaffOrder[] = [
  {
    orderId: "TP-1041",
    orderType: "dine_in",
    tableNumber: "5",
    time: "19:42",
    items: [
      { name: "Lamb Skewer", quantity: 6 },
      { name: "Chicken Wing", quantity: 4 },
      { name: "Garlic Eggplant", quantity: 1 },
    ],
    totalPrice: 520,
    status: "new",
  },
  {
    orderId: "TP-1040",
    orderType: "pickup",
    tableNumber: null,
    time: "19:38",
    items: [
      { name: "Mala Beef Skewer", quantity: 8 },
      { name: "Egg Fried Rice", quantity: 2 },
    ],
    totalPrice: 460,
    status: "new",
  },
  {
    orderId: "TP-1039",
    orderType: "dine_in",
    tableNumber: "12",
    time: "19:31",
    items: [
      { name: "Signature BBQ Platter", quantity: 1 },
      { name: "Hot & Sour Soup", quantity: 2 },
      { name: "Tsingtao Beer", quantity: 4 },
    ],
    totalPrice: 1180,
    status: "new",
  },
  {
    orderId: "TP-1038",
    orderType: "dine_in",
    tableNumber: "3",
    time: "19:24",
    items: [
      { name: "Pork Belly Skewer", quantity: 5 },
      { name: "Grilled Enoki", quantity: 2 },
      { name: "Stir-fried Morning Glory", quantity: 1 },
    ],
    totalPrice: 395,
    status: "preparing",
  },
  {
    orderId: "TP-1037",
    orderType: "delivery",
    tableNumber: null,
    time: "19:18",
    items: [
      { name: "Chicken Skewer", quantity: 10 },
      { name: "Fried Noodles", quantity: 1 },
    ],
    totalPrice: 540,
    status: "preparing",
  },
  {
    orderId: "TP-1036",
    orderType: "dine_in",
    tableNumber: "8",
    time: "19:05",
    items: [
      { name: "Mala Chicken Wing", quantity: 6 },
      { name: "Steamed Rice", quantity: 2 },
    ],
    totalPrice: 310,
    status: "ready",
  },
  {
    orderId: "TP-1035",
    orderType: "pickup",
    tableNumber: null,
    time: "18:51",
    items: [
      { name: "Beef Skewer", quantity: 4 },
      { name: "Hot & Sour Soup", quantity: 1 },
    ],
    totalPrice: 280,
    status: "done",
  },
  {
    orderId: "TP-1034",
    orderType: "dine_in",
    tableNumber: "9",
    time: "18:40",
    items: [{ name: "Grilled Squid", quantity: 2 }],
    totalPrice: 240,
    status: "cancelled",
  },
];
