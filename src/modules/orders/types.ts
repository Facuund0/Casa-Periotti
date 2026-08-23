export type OrderStatus =
  | "created"
  | "pending_payment"
  | "payment_processing"
  | "paid"
  | "payment_failed"
  | "preparing"
  | "ready_for_pickup"
  | "shipped"
  | "completed"
  | "cancelled";

export type FulfillmentMethod = "pickup" | "delivery";

/**
 * Máquina de estados: qué transiciones son válidas. Cualquier cambio
 * que no esté en esta tabla se rechaza. Por ejemplo, un pedido
 * "completed" nunca puede volver a "pending_payment".
 */
export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  created: ["pending_payment", "cancelled"],
  pending_payment: ["payment_processing", "paid", "payment_failed", "cancelled"],
  payment_processing: ["paid", "payment_failed", "cancelled"],
  paid: ["preparing", "cancelled"],
  payment_failed: ["pending_payment", "cancelled"],
  preparing: ["ready_for_pickup", "shipped", "cancelled"],
  ready_for_pickup: ["completed", "cancelled"],
  shipped: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface CheckoutItem {
  productId: string;
  quantity: number;
}
