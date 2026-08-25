import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { getPaymentClient } from "./mercadopago-client";
import { OrderService } from "@/modules/orders/order-service";

export class PaymentAlreadyInProgressError extends Error {
  constructor() {
    super("Ya hay un pago en curso para este pedido. Esperá a que termine antes de reintentar.");
    this.name = "PaymentAlreadyInProgressError";
  }
}

export class OrderNotPayableError extends Error {
  constructor(status: string) {
    super(`Este pedido no se puede pagar (estado actual: ${status})`);
    this.name = "OrderNotPayableError";
  }
}

export interface ProcessCardPaymentInput {
  orderId: string;
  token: string; // token generado por el Card Payment Brick en el navegador, NUNCA el número de tarjeta
  paymentMethodId: string;
  issuerId?: string;
  installments: number;
  payerEmail: string;
  identificationType?: string;
  identificationNumber?: string;
  // Device ID que genera el SDK JS v2 de Mercado Pago en el navegador
  // (window.MP_DEVICE_SESSION_ID) — factor clave para la aprobación de
  // pagos según la herramienta de Calidad de Integración de MP.
  deviceId?: string;
}

// Texto que ve el comprador en el resumen de su tarjeta.
const STATEMENT_DESCRIPTOR = "CASA PERIOTTI";

export type PaymentOutcome =
  | { result: "approved" }
  | { result: "rejected"; reason?: string }
  | { result: "pending" };

/**
 * Orquesta el pago con tarjeta: valida el pedido, llama a la API de
 * Pagos de Mercado Pago con el token que ya generó el navegador (el
 * backend nunca ve el número de tarjeta), y deja todo registrado con
 * idempotencia para que un reintento de red nunca duplique el cobro.
 */
export class PaymentService {
  private readonly orderService: OrderService;

  constructor(private readonly adminDb: SupabaseClient) {
    this.orderService = new OrderService(adminDb);
  }

  async processCardPayment(input: ProcessCardPaymentInput): Promise<PaymentOutcome> {
    const order = await this.orderService.getById(input.orderId);
    if (!order) throw new Error("Pedido no encontrado");

    if (order.status === "payment_failed") {
      // Un intento anterior sobre este mismo pedido fue rechazado — se
      // reintenta re-reservando el stock en vez de obligar al cliente a
      // rehacer el carrito. retry_order_payment() ya protege contra
      // doble cobro (nunca reintenta si hay un pago aprobado) y tira
      // con un mensaje claro si ya no queda stock.
      await this.orderService.retryPayment(input.orderId);
      order.status = "pending_payment";
    }

    if (order.status !== "pending_payment") {
      throw new OrderNotPayableError(order.status);
    }

    // Barrera 1 (aplicación): ¿ya hay un pago no-terminal para este pedido?
    const { data: existing } = await this.adminDb
      .from("payments")
      .select("id")
      .eq("order_id", input.orderId)
      .in("status", ["pending", "processing", "approved"])
      .maybeSingle();
    if (existing) throw new PaymentAlreadyInProgressError();

    const idempotencyKey = randomUUID();

    // Se inserta el registro de pago ANTES de llamar a Mercado Pago.
    // Si algo se corta a mitad de camino (el servidor se reinicia,
    // por ejemplo), queda evidencia de que se intentó, y el índice
    // único de la migración 0007 evita que se dispare un segundo
    // intento en paralelo para el mismo pedido.
    const { data: paymentRow, error: insertError } = await this.adminDb
      .from("payments")
      .insert({
        order_id: input.orderId,
        provider: "mercadopago",
        status: "processing",
        amount: order.total,
        idempotency_key: idempotencyKey,
      })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") throw new PaymentAlreadyInProgressError();
      throw new Error(`No se pudo iniciar el pago: ${insertError.message}`);
    }

    await this.orderService.markProcessing(input.orderId);

    // Nunca se loguea el token (de un solo uso, pero igual sensible) ni
    // el email completo del pagador — el resto del payload es seguro de
    // ver en logs/DB para poder diagnosticar sin exponer datos de pago.
    const redactedPayload = {
      transaction_amount: order.total,
      installments: input.installments,
      payment_method_id: input.paymentMethodId,
      issuer_id: input.issuerId ?? null,
      has_identification: Boolean(input.identificationType),
    };

    const extras = await this.buildApprovalExtras(input.orderId);

    try {
      const mpPayment = await getPaymentClient().create({
        body: {
          transaction_amount: order.total,
          token: input.token,
          description: `Pedido Casa Periotti #${order.orderNumber}`,
          installments: input.installments,
          payment_method_id: input.paymentMethodId,
          issuer_id: input.issuerId ? Number(input.issuerId) : undefined,
          // OJO: binary_mode=true se sacó a propósito. Fuerza a Mercado
          // Pago a resolver siempre a approved/rejected, pero eso
          // incluye convertir en rechazo directo cualquier pago que
          // hubiera quedado "in_process" en revisión (ej. status_detail
          // "pending_contingency") — o sea, rechaza de entrada pagos
          // legítimos que solo necesitaban revisión unos segundos/minutos.
          // Sin binary_mode, esos pagos quedan "in_process" (mapMercadoPagoStatus
          // los traduce a "processing") y se resuelven después solo:
          // notification_url de abajo dispara el webhook cuando MP
          // decide, y si nunca llega el cron release-stale-reservations
          // libera la reserva de stock a los 30 minutos.
          notification_url: buildWebhookNotificationUrl(),
          // external_reference: nuestro order_id — permite correlacionar
          // el pago del lado de Mercado Pago con el pedido, y es la vía
          // de respaldo que usa reconcilePayment() más abajo si por lo
          // que sea provider_payment_id no quedó guardado.
          external_reference: input.orderId,
          statement_descriptor: STATEMENT_DESCRIPTOR,
          payer: {
            email: input.payerEmail,
            first_name: extras.payerFirstName,
            last_name: extras.payerLastName,
            identification: input.identificationType
              ? { type: input.identificationType, number: input.identificationNumber }
              : undefined,
            address: extras.address,
          },
          additional_info: extras.items.length ? { items: extras.items } : undefined,
        },
        // meliSessionId es el Device ID (MP_DEVICE_SESSION_ID) que genera
        // el SDK JS v2 en el navegador — el SDK de Node lo manda como
        // header X-Meli-Session-Id. Mercado Pago lo usa para evaluar el
        // dispositivo del comprador; es uno de los factores de mayor
        // peso en la aprobación de pagos.
        requestOptions: { idempotencyKey, meliSessionId: input.deviceId },
      });

      await this.adminDb
        .from("payments")
        .update({
          provider_payment_id: String(mpPayment.id),
          status: mapMercadoPagoStatus(mpPayment.status),
          payment_method_id: mpPayment.payment_method_id,
          installments: mpPayment.installments,
          status_detail: mpPayment.status_detail,
          raw_response: mpPayment,
        })
        .eq("id", paymentRow.id);

      if (mpPayment.status === "approved") {
        await this.orderService.confirmPaid(input.orderId);
        return { result: "approved" };
      }

      if (mpPayment.status === "rejected") {
        await this.orderService.releaseReservation(input.orderId, "payment_failed");
        return { result: "rejected", reason: mpPayment.status_detail ?? undefined };
      }

      // in_process / pending: queda esperando la confirmación del webhook.
      // El stock sigue reservado (no se libera y no se descuenta todavía).
      return { result: "pending" };
    } catch (err) {
      // El SDK de Mercado Pago (MercadoPagoError y subclases como
      // MPServerError) expone status/error/causes con el detalle real
      // que devolvió la API — nunca solo "algo falló". Se guarda en
      // raw_response para poder diagnosticar sin tener que reproducir
      // el pago de nuevo.
      const errorDetail = serializeMercadoPagoError(err);
      console.error(
        `[PaymentService] Error al crear el pago en Mercado Pago para el pedido ${input.orderId}. Payload:`,
        redactedPayload,
        "Error:",
        errorDetail
      );

      // Si Mercado Pago no respondió, dejamos el pago como rechazado
      // en vez de "processing" colgado para siempre, y liberamos la
      // reserva de stock para que el producto vuelva a estar disponible.
      await this.adminDb
        .from("payments")
        .update({
          status: "rejected",
          status_detail: "provider_error",
          raw_response: { request: redactedPayload, error: errorDetail },
        })
        .eq("id", paymentRow.id);
      await this.orderService.releaseReservation(input.orderId, "payment_failed");
      throw err;
    }
  }

  /**
   * Datos opcionales que la herramienta de Calidad de Integración de
   * Mercado Pago recomienda mandar para mejorar la aprobación de pagos
   * (nombre del pagador, ítems del pedido, dirección de envío). Ninguno
   * de estos es indispensable para cobrar — si esta consulta falla, se
   * loguea y el pago sigue su curso sin ellos en vez de bloquearse.
   */
  private async buildApprovalExtras(orderId: string): Promise<{
    payerFirstName?: string;
    payerLastName?: string;
    items: Array<{ id: string; title: string; description?: string; quantity: number; unit_price: number }>;
    address?: { street_name?: string; city?: string };
  }> {
    try {
      const [{ data: orderRow }, { data: itemRows }] = await Promise.all([
        this.adminDb
          .from("orders")
          .select("customer_id, fulfillment_method, shipping_address_street, shipping_address_city")
          .eq("id", orderId)
          .maybeSingle(),
        this.adminDb
          .from("order_items")
          .select("product_id, product_name_snapshot, quantity, unit_price, products(description)")
          .eq("order_id", orderId),
      ]);

      let payerFirstName: string | undefined;
      let payerLastName: string | undefined;
      if (orderRow?.customer_id) {
        const { data: customerRow } = await this.adminDb
          .from("customer_profiles")
          .select("full_name")
          .eq("id", orderRow.customer_id)
          .maybeSingle();
        const fullName = (customerRow?.full_name as string | undefined)?.trim();
        if (fullName) {
          const [firstName, ...rest] = fullName.split(/\s+/);
          payerFirstName = firstName;
          payerLastName = rest.length ? rest.join(" ") : undefined;
        }
      }

      const items = (itemRows ?? []).map((it) => {
        // Sin tipos generados de Supabase, la relación embebida
        // products(description) puede inferirse como objeto o como
        // array de un elemento según la consulta — se contemplan los dos.
        const productsRel = it.products as unknown as
          | { description: string | null }
          | { description: string | null }[]
          | null;
        const productDescription = Array.isArray(productsRel)
          ? productsRel[0]?.description
          : productsRel?.description;
        return {
          id: it.product_id as string,
          title: it.product_name_snapshot as string,
          description: productDescription ?? (it.product_name_snapshot as string),
          quantity: it.quantity as number,
          unit_price: Number(it.unit_price),
        };
      });

      const address =
        orderRow?.fulfillment_method === "delivery" && orderRow?.shipping_address_street
          ? {
              street_name: orderRow.shipping_address_street as string,
              city: (orderRow.shipping_address_city as string | null) ?? undefined,
            }
          : undefined;

      return { payerFirstName, payerLastName, items, address };
    } catch (err) {
      console.error(`[PaymentService] No se pudieron armar los datos adicionales para Mercado Pago (orderId=${orderId}):`, err);
      return { items: [] };
    }
  }

  /**
   * Vuelve a consultar el estado real de un pago directo contra la API
   * de Mercado Pago (nunca confía en nada que no sea esa respuesta) y
   * aplica el mismo tratamiento en los dos lugares que lo necesitan: el
   * webhook (cuando llega la notificación) y el botón manual de
   * "Consultar estado del pago" del panel (cuando el webhook no llega,
   * típicamente en desarrollo local, o se perdió). Es la única fuente
   * de verdad de este tratamiento — no se duplica en ningún otro lado.
   *
   * Devuelve null si ese provider_payment_id todavía no tiene un pago
   * nuestro asociado (puede pasar si el webhook llega antes de que
   * termine de guardarse la respuesta síncrona) y tampoco se pudo
   * resolver por external_reference (ver más abajo).
   */
  async reconcilePayment(providerPaymentId: string): Promise<{
    orderId: string;
    status: ReturnType<typeof mapMercadoPagoStatus>;
    statusDetail: string | null;
  } | null> {
    const mpPayment = await getPaymentClient().get({ id: providerPaymentId });

    const { data: paymentRow } = await this.adminDb
      .from("payments")
      .select("order_id")
      .eq("provider_payment_id", String(mpPayment.id))
      .maybeSingle();

    let orderId = paymentRow?.order_id as string | undefined;

    if (!orderId && mpPayment.external_reference) {
      // Camino de respaldo: processCardPayment manda external_reference
      // = order_id en TODO pago que crea, así que si el pago propio por
      // algún motivo se quedó sin provider_payment_id (ej. el proceso
      // se cortó justo después de crear el pago en Mercado Pago y antes
      // de guardar la respuesta síncrona), se lo encuentra igual por acá
      // y se completa provider_payment_id para que quede consistente de
      // ahora en más.
      const { data: fallbackRow } = await this.adminDb
        .from("payments")
        .select("id, order_id")
        .eq("order_id", mpPayment.external_reference)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fallbackRow) {
        orderId = fallbackRow.order_id as string;
        await this.adminDb
          .from("payments")
          .update({ provider_payment_id: String(mpPayment.id) })
          .eq("id", fallbackRow.id);
      }
    }

    if (!orderId) return null;
    const status = mapMercadoPagoStatus(mpPayment.status);

    await this.adminDb
      .from("payments")
      .update({
        status,
        status_detail: mpPayment.status_detail,
        raw_response: mpPayment,
      })
      .eq("order_id", orderId);

    if (mpPayment.status === "approved") {
      await this.orderService.confirmPaid(orderId); // idempotente
    } else if (mpPayment.status === "rejected" || mpPayment.status === "cancelled") {
      await this.orderService.releaseReservation(orderId, "payment_failed"); // idempotente
    }

    return { orderId, status, statusDetail: mpPayment.status_detail ?? null };
  }
}

export function mapMercadoPagoStatus(
  status: string | undefined
): "pending" | "processing" | "approved" | "rejected" | "cancelled" | "refunded" {
  switch (status) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    case "refunded":
    case "charged_back":
      return "refunded";
    case "in_process":
    case "authorized":
      return "processing";
    default:
      return "pending";
  }
}

/**
 * URL pública a la que Mercado Pago llama cuando un pago cambia de
 * estado (ver POST /api/webhooks/mercadopago). Se arma desde
 * APP_BASE_URL (variable propia, no la inyectada por Vercel, para que
 * funcione igual con dominio custom). Si no está configurada —caso
 * típico de desarrollo local, donde Mercado Pago no puede llegar a un
 * localhost— se omite el campo en vez de mandar una URL inválida.
 */
function buildWebhookNotificationUrl(): string | undefined {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) return undefined;
  return `${baseUrl.replace(/\/+$/, "")}/api/webhooks/mercadopago`;
}

/**
 * El SDK de Mercado Pago (mercadopago-js v3) tira subclases de
 * MercadoPagoError (MPServerError, MPBadRequestError, etc.) que
 * exponen `status` (HTTP), `error` (código corto, ej: "internal_error")
 * y `causes` (array de {code, description} con el detalle real que
 * devolvió la API) — nunca hay que quedarse solo con `.message`.
 */
function serializeMercadoPagoError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const withMpFields = err as Error & {
      status?: number;
      error?: string;
      causes?: unknown;
    };
    return {
      name: withMpFields.name,
      message: withMpFields.message,
      status: withMpFields.status ?? null,
      error: withMpFields.error ?? null,
      causes: withMpFields.causes ?? null,
    };
  }
  return { message: String(err) };
}
