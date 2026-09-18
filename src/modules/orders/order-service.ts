import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CheckoutItem, FulfillmentMethod, OrderStatus } from "./types";
import type { PricePreference } from "@/modules/products/wholesale-pricing";

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
  // Momento en que se creó el pedido. Es el punto desde el que se mide
  // el plazo para pagar por transferencia — el mismo que usa el cron
  // que libera las reservas vencidas, para que el reloj del cliente y
  // el del servidor no puedan desincronizarse.
  createdAt: string;
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
    /**
     * Tipo de precio que eligió un mayorista aprobado. Es solo una
     * preferencia: create_order decide el precio leyendo el tipo de
     * cliente de la base y el mínimo de cada producto.
     */
    pricePreference?: PricePreference;
  }): Promise<OrderSummary> {
    const { data: orderId, error } = await this.adminDb.rpc("create_order", {
      p_customer_id: params.customerId,
      p_fulfillment_method: params.fulfillmentMethod,
      p_items: params.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
      p_shipping_address_street: params.shippingStreet ?? null,
      p_shipping_address_city: params.shippingCity ?? null,
      p_notes: params.notes ?? null,
      p_price_preference: params.pricePreference ?? "mayorista",
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
      .select("id, order_number, status, total, subtotal, vat_amount, created_at")
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
      createdAt: data.created_at,
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
   * Libera la reserva de stock de los pedidos cuyo plazo de pago venció
   * sin que llegara el pago. La usan tanto el cron
   * /api/cron/release-stale-reservations como el botón manual "Liberar
   * reservas vencidas" de /admin/productos — un solo lugar, nunca
   * duplicado.
   *
   * Dos reglas propias del pago por transferencia:
   *
   * 1. El plazo se mide sobre created_at, no updated_at: es el mismo
   *    momento desde el que el cliente vio correr el reloj en el
   *    checkout. (Con Mercado Pago se usaba updated_at porque un pedido
   *    que acababa de pasar a payment_processing no estaba abandonado;
   *    ahora los payment_processing quedan excluidos por la regla 2.)
   *
   * 2. NUNCA se cancela un pedido que ya tiene un comprobante subido,
   *    por más vencido que esté: el cliente pagó, aunque se haya pasado
   *    del plazo. Esos casos los tiene que resolver un empleado a mano
   *    desde /admin/pedidos (confirmando o rechazando el comprobante).
   *    La condición se evalúa mirando payment_receipts, no el estado del
   *    pedido: si por algún camino inesperado un pedido con comprobante
   *    quedara en pending_payment, tampoco se cancela.
   */
  async releaseStaleReservations(staleThresholdMinutes: number): Promise<{
    checked: number;
    released: number;
    skippedWithReceipt: number;
    skippedWithOpenPointCharge: number;
    failures: { orderId: string; error: string }[];
  }> {
    const cutoff = new Date(Date.now() - staleThresholdMinutes * 60 * 1000).toISOString();

    const { data: staleOrders, error } = await this.adminDb
      .from("orders")
      .select("id")
      .in("status", ["pending_payment", "payment_processing"])
      .lt("created_at", cutoff);

    if (error) throw new Error(`Error al buscar pedidos vencidos: ${error.message}`);

    const candidateIds = (staleOrders ?? []).map((o) => o.id);

    // Pedidos vencidos que SÍ tienen comprobante: quedan afuera del
    // cancelado automático y esperan revisión humana.
    const { data: receipts, error: receiptsError } = candidateIds.length
      ? await this.adminDb
          .from("payment_receipts")
          .select("order_id")
          .in("order_id", candidateIds)
      : { data: [] as { order_id: string }[], error: null };

    if (receiptsError) {
      throw new Error(`Error al buscar comprobantes de pago: ${receiptsError.message}`);
    }

    // Pedidos con un cobro con Point todavía abierto: tampoco se cancelan
    // acá. Puede que la tarjeta ya se haya cobrado y nadie lo haya leído
    // todavía, y cancelar eso sería perder la venta con la plata cobrada.
    // Los resuelve PointSaleService.resolveStale(), que primero le
    // pregunta a Mercado Pago (ver point-sale-service.ts).
    const { data: pointIntents, error: pointError } = candidateIds.length
      ? await this.adminDb
          .from("point_payment_intents")
          .select("order_id")
          .eq("settled", false)
          .in("order_id", candidateIds)
      : { data: [] as { order_id: string }[], error: null };

    if (pointError) {
      throw new Error(`Error al buscar cobros con Point: ${pointError.message}`);
    }

    const withReceipt = new Set((receipts ?? []).map((r) => r.order_id));
    const withOpenPointCharge = new Set((pointIntents ?? []).map((r) => r.order_id));
    const toRelease = candidateIds.filter(
      (id) => !withReceipt.has(id) && !withOpenPointCharge.has(id)
    );

    const failures: { orderId: string; error: string }[] = [];
    let released = 0;

    for (const orderId of toRelease) {
      try {
        await this.releaseReservation(orderId, "cancelled");
        released++;
      } catch (err) {
        failures.push({ orderId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return {
      checked: candidateIds.length,
      released,
      skippedWithReceipt: withReceipt.size,
      skippedWithOpenPointCharge: withOpenPointCharge.size,
      failures,
    };
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
