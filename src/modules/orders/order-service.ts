import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckoutItem, FulfillmentMethod, OrderStatus } from "./types";

export class OrderNotFoundError extends Error {
  constructor(orderId: string) {
    super(`El pedido ${orderId} no existe`);
    this.name = "OrderNotFoundError";
  }
}

export class OrderCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderCreationError";
  }
}

export interface OrderSummary {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  total: number;
  subtotal: number;
  vatAmount: number;
}

/**
 * Envuelve las funciones de Postgres que hacen el trabajo pesado
 * (create_order, confirm_order_paid, release_order_reservation).
 * Este service no reimplementa esa lógica en JavaScript a propósito:
 * todo lo que toca dinero + stock al mismo tiempo tiene que ser una
 * sola transacción atómica, y eso vive mejor en la base de datos que
 * orquestado con múltiples llamadas desde Node.
 */
export class OrderService {
  constructor(private readonly adminDb: SupabaseClient) {}

  async createFromCart(params: {
    customerId: string | null;
    items: CheckoutItem[];
    fulfillmentMethod: FulfillmentMethod;
    shippingStreet?: string;
    shippingCity?: string;
    notes?: string;
  }): Promise<OrderSummary> {
    const { data: orderId, error } = await this.adminDb.rpc("create_order", {
      p_customer_id: params.customerId,
      p_fulfillment_method: params.fulfillmentMethod,
      p_items: params.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
      p_shipping_address_street: params.shippingStreet ?? null,
      p_shipping_address_city: params.shippingCity ?? null,
      p_notes: params.notes ?? null,
    });

    if (error) {
      throw new OrderCreationError(error.message);
    }

    const order = await this.getById(orderId as string);
    if (!order) throw new OrderCreationError("El pedido se creó pero no se pudo leer de vuelta");
    return order;
  }

  async getById(orderId: string): Promise<OrderSummary | null> {
    const { data, error } = await this.adminDb
      .from("orders")
      .select("id, order_number, status, total, subtotal, vat_amount")
      .eq("id", orderId)
      .maybeSingle();

    if (error) throw new Error(`Error al buscar pedido: ${error.message}`);
    if (!data) return null;

    return {
      id: data.id,
      orderNumber: data.order_number,
      status: data.status,
      total: Number(data.total),
      subtotal: Number(data.subtotal),
      vatAmount: Number(data.vat_amount),
    };
  }

  /** Confirma el pago: descuenta stock real y pasa el pedido a 'paid'. Idempotente. */
  async confirmPaid(orderId: string) {
    const { error } = await this.adminDb.rpc("confirm_order_paid", { p_order_id: orderId });
    if (error) throw new Error(`Error al confirmar pedido pagado: ${error.message}`);
  }

  /** Libera la reserva de stock sin vender: pago rechazado/cancelado/expirado. Idempotente. */
  async releaseReservation(orderId: string, newStatus: "payment_failed" | "cancelled") {
    const { error } = await this.adminDb.rpc("release_order_reservation", {
      p_order_id: orderId,
      p_new_status: newStatus,
    });
    if (error) throw new Error(`Error al liberar reserva de stock: ${error.message}`);
  }

  async markProcessing(orderId: string) {
    const { error } = await this.adminDb
      .from("orders")
      .update({ status: "payment_processing" })
      .eq("id", orderId)
      .eq("status", "pending_payment"); // solo si sigue en el estado esperado
    if (error) throw new Error(`Error al actualizar pedido: ${error.message}`);
  }

  /**
   * Libera la reserva de stock de todos los pedidos abandonados (más de
   * staleThresholdMinutes sin actividad en pending_payment o
   * payment_processing). La usan tanto el cron
   * /api/cron/release-stale-reservations como el botón manual "Liberar
   * reservas vencidas" de /admin/productos — un solo lugar, nunca
   * duplicado.
   */
  async releaseStaleReservations(staleThresholdMinutes: number): Promise<{
    checked: number;
    released: number;
    failures: { orderId: string; error: string }[];
  }> {
    const cutoff = new Date(Date.now() - staleThresholdMinutes * 60 * 1000).toISOString();

    // updated_at (no created_at): un pedido que pasó a payment_processing
    // hace 5 minutos no está "abandonado" solo porque se creó hace 40.
    const { data: staleOrders, error } = await this.adminDb
      .from("orders")
      .select("id")
      .in("status", ["pending_payment", "payment_processing"])
      .lt("updated_at", cutoff);

    if (error) throw new Error(`Error al buscar pedidos abandonados: ${error.message}`);

    const failures: { orderId: string; error: string }[] = [];
    let released = 0;

    for (const order of staleOrders ?? []) {
      try {
        await this.releaseReservation(order.id, "cancelled");
        released++;
      } catch (err) {
        failures.push({ orderId: order.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { checked: (staleOrders ?? []).length, released, failures };
  }

  /**
   * Reintenta el pago de un pedido que quedó en payment_failed:
   * re-reserva el stock de sus items (si sigue disponible) y lo vuelve
   * a pending_payment. Tira si ya no hay stock suficiente, si el pedido
   * no está en payment_failed, o si ya tiene un pago aprobado (nunca
   * reintenta un pedido ya cobrado).
   */
  async retryPayment(orderId: string) {
    const { error } = await this.adminDb.rpc("retry_order_payment", { p_order_id: orderId });
    if (error) throw new Error(`No se pudo reintentar el pago: ${error.message}`);
  }
}
