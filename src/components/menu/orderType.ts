// Order-type vocabulary, split out of the checkout sheet so the hero rail and
// the sheet can share it without importing each other.

export type OrderType = "dine-in" | "pickup" | "delivery";

export const ORDER_TYPES: readonly OrderType[] = ["dine-in", "pickup", "delivery"];

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  "dine-in": "Dine In",
  pickup: "Pickup",
  delivery: "Delivery",
};

export const ORDER_TYPE_ZH: Record<OrderType, string> = {
  "dine-in": "堂食",
  pickup: "自取",
  delivery: "外送",
};
