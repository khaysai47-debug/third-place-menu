// Mock staff order fixtures. Served through src/lib/staffOrders.ts —
// import data via that service, not from here. Deleted once Airtable lands.

import type { StaffOrder } from "@/lib/staffOrders";

export const MOCK_ORDERS: StaffOrder[] = [
  {
    orderId: "TP-1041",
    orderType: "dine_in",
    tableNumber: "5",
    time: "19:42",
    items: [
      { name: "Lamb Skewer", quantity: 6, unitPrice: 50 },
      { name: "Chicken Wing", quantity: 4, unitPrice: 40 },
      { name: "Garlic Eggplant", quantity: 1, unitPrice: 60 },
    ],
    notes: "Chicken wings not spicy 雞翅不要辣",
    totalPrice: 520,
    status: "new",
  },
  {
    orderId: "TP-1040",
    orderType: "pickup",
    tableNumber: null,
    time: "19:38",
    items: [
      { name: "Mala Beef Skewer", quantity: 8, unitPrice: 45 },
      { name: "Egg Fried Rice", quantity: 2, unitPrice: 50 },
    ],
    notes: null,
    totalPrice: 460,
    status: "new",
  },
  {
    orderId: "TP-1039",
    orderType: "dine_in",
    tableNumber: "12",
    time: "19:31",
    items: [
      { name: "Signature BBQ Platter", quantity: 1, unitPrice: 680 },
      { name: "Hot & Sour Soup", quantity: 2, unitPrice: 90 },
      { name: "Tsingtao Beer", quantity: 4, unitPrice: 80 },
    ],
    notes: null,
    totalPrice: 1180,
    status: "new",
  },
  {
    orderId: "TP-1038",
    orderType: "dine_in",
    tableNumber: "3",
    time: "19:24",
    items: [
      { name: "Pork Belly Skewer", quantity: 5, unitPrice: 45 },
      { name: "Grilled Enoki", quantity: 2, unitPrice: 40 },
      { name: "Stir-fried Morning Glory", quantity: 1, unitPrice: 90 },
    ],
    notes: null,
    totalPrice: 395,
    status: "preparing",
  },
  {
    orderId: "TP-1037",
    orderType: "delivery",
    tableNumber: null,
    time: "19:18",
    items: [
      { name: "Chicken Skewer", quantity: 10, unitPrice: 40 },
      { name: "Fried Noodles", quantity: 1, unitPrice: 140 },
    ],
    notes: "Leave at condo lobby, call on arrival",
    totalPrice: 540,
    status: "preparing",
  },
  {
    orderId: "TP-1036",
    orderType: "dine_in",
    tableNumber: "8",
    time: "19:05",
    items: [
      { name: "Mala Chicken Wing", quantity: 6, unitPrice: 40 },
      { name: "Steamed Rice", quantity: 2, unitPrice: 35 },
    ],
    notes: null,
    totalPrice: 310,
    status: "ready",
  },
  {
    orderId: "TP-1035",
    orderType: "pickup",
    tableNumber: null,
    time: "18:51",
    items: [
      { name: "Beef Skewer", quantity: 4, unitPrice: 45 },
      { name: "Hot & Sour Soup", quantity: 1, unitPrice: 100 },
    ],
    notes: null,
    totalPrice: 280,
    status: "done",
  },
  {
    orderId: "TP-1034",
    orderType: "dine_in",
    tableNumber: "9",
    time: "18:40",
    items: [{ name: "Grilled Squid", quantity: 2, unitPrice: 120 }],
    notes: "Customer left before ordering drinks",
    totalPrice: 240,
    status: "cancelled",
  },
];
