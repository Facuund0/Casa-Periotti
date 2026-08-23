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
}

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
          payer: {
            email: input.payerEmail,
            identification: input.identificationType
              ? { type: input.identificationType, number: input.identificationNumber }
              : undefined,
          },
        },
        requestOptions: { idempotencyKey },
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
   * termine de guardarse la respuesta síncrona).
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

    if (!paymentRow) return null;

    const orderId = paymentRow.order_id as string;
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
