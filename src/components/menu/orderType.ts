// Order-type vocabulary, split out of the checkout sheet so the hero rail and
// the sheet can share it without importing each other.

export type OrderType = "dine-in" | "pickup" | "delivery";

export const ORDER_TYPES: readonly OrderType[] = ["dine-in", "pickup", "delivery"];

/** Display labels only — the payload uses its own mapping, so wording here
 *  is free to follow the approved menu ("Pick Up", not "Pickup"). */
export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  "dine-in": "Dine In",
  pickup: "Pick Up",
  delivery: "Delivery",
};

export const ORDER_TYPE_ZH: Record<OrderType, string> = {
  "dine-in": "堂食",
  pickup: "自取",
  delivery: "外送",
};
