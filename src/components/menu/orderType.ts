// Order-type vocabulary, split out of the checkout sheet so the hero rail and
// the sheet can share it without importing each other.

import type { CopyKey } from "@/lib/i18n";

export type OrderType = "dine-in" | "pickup" | "delivery";

export const ORDER_TYPES: readonly OrderType[] = ["dine-in", "pickup", "delivery"];

/** Copy keys for the display labels. The payload uses its own mapping, so
 *  none of this reaches an order — see narrowIntakeBody in ../../lib/orders. */
export const ORDER_TYPE_COPY_KEYS = {
  "dine-in": "orderType.dineIn",
  pickup: "orderType.pickup",
  delivery: "orderType.delivery",
} as const satisfies Record<OrderType, CopyKey>;

/** FUNCTIONAL Chinese: shown under the English label in English mode only. */
export const ORDER_TYPE_ZH: Record<OrderType, string> = {
  "dine-in": "堂食",
  pickup: "自取",
  delivery: "外送",
};
