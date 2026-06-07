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
  totalPrice: number;
  status: "draft";
}

export interface SubmitResult {
  success: boolean;
  error?: string;
}

export function submitOrder(payload: OrderPayload): SubmitResult {
  console.log("ORDER_DRAFT_PAYLOAD", payload);
  return { success: true };
}
