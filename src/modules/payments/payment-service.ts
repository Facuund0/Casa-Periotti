import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { MPNotFoundError } from "mercadopago";
import { getPaymentClient, getOrderClient } from "./mercadopago-client";
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
  // "credit_card" | "debit_card" — la API de Orders lo exige dentro de
  // payment_method (confirmado contra la API real con credenciales de
  // producción: sin esto, POST /v1/orders responde 400 "missing
  // properties: type"). Si el Brick no lo manda por algún motivo, se
  // cae a "credit_card" — más común que no tener nada, pero no es
  // trivialmente correcto para un pago con débito (ver comentario en
  // el body de la orden más abajo).
  paymentTypeId?: string;
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
const CURRENCY = "ARS";

export type PaymentOutcome =
  | { result: "approved" }
  | { result: "rejected"; reason?: string }
  | { result: "pending" }
  // Nuevo con la API de Orders: la orden quedó en action_required/
  // pending_challenge — hay que mostrarle al comprador un iframe con
  // challengeUrl (transactions.payments[0].payment_method.transaction_security.url)
  // y esperar a que lo complete. TODAVÍA NO CONSUMIDO por
  // /api/payments/process ni por el frontend — falta esa parte.
  | { result: "challenge_required"; challengeUrl: string };

type InternalPaymentStatus = "pending" | "processing" | "approved" | "rejected" | "cancelled" | "refunded";

/**
 * Orquesta el pago con tarjeta: valida el pedido, llama a la API de
 * Orders de Mercado Pago (necesaria para poder pedir 3DS 2.0 — la API
 * de Payments, que se usaba antes, no lo soporta) con el token que ya
 * generó el navegador (el backend nunca ve el número de tarjeta), y deja
 * todo registrado con idempotencia para que un reintento de red nunca
 * duplique el cobro.
 *
 * Ver docs/mercadopago.md para el estado anterior a esta migración
 * (API de Payments) y por qué se migró.
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
      total_amount: order.total,
      installments: input.installments,
      payment_method_id: input.paymentMethodId,
      payment_type_id: input.paymentTypeId ?? "AUSENTE (se usa 'credit_card' por defecto)",
      issuer_id: input.issuerId ?? null,
      has_identification: Boolean(input.identificationType),
    };

    const extras = await this.buildApprovalExtras(input.orderId);

    // Verificación explícita de que el Device ID viaja del navegador al
    // backend (no se loguea el valor completo, alcanza con confirmar
    // que llegó algo y cuánto mide, para diagnosticar sin acumular el
    // identificador de dispositivo en los logs).
    console.log(
      `[PaymentService] Device ID (meliSessionId) para orderId=${input.orderId}: ${
        input.deviceId ? `presente (largo=${input.deviceId.length}, empieza "${input.deviceId.slice(0, 8)}...")` : "AUSENTE (undefined o vacío)"
      }`
    );

    // Confirmación de qué se arma realmente en buildApprovalExtras() antes
    // de mandarlo — sin esto no se puede distinguir "no llegó a Mercado
    // Pago" de "nunca se armó" cuando algún dato sale null del lado de MP.
    // No se loguea el email completo ni la calle exacta (domicilio),
    // alcanza con confirmar presencia para diagnosticar.
    console.log(
      `[PaymentService] buildApprovalExtras() para orderId=${input.orderId}:`,
      {
        payerEmail: input.payerEmail ? `presente (largo=${input.payerEmail.length})` : "AUSENTE",
        payerFirstName: extras.payerFirstName ?? "AUSENTE",
        payerLastName: extras.payerLastName ?? "AUSENTE",
        hasIdentification: Boolean(input.identificationType),
        addressPresent: Boolean(extras.address),
        itemTitles: extras.items.map((it) => it.title),
      }
    );

    // NOTA — issuer_id, diferencia confirmada respecto a la API de
    // Payments: input.issuerId se recibe del Brick y se loguea arriba
    // (para diagnóstico) pero NO se manda en el body. Se verificó
    // contra dos fuentes independientes que la API de Orders no tiene
    // dónde mandarlo: (1) el tipo PaymentMethodRequest del SDK
    // (node_modules/mercadopago/dist/clients/order/create/types.d.ts)
    // no lo expone, y (2) el ejemplo oficial de la documentación de MP
    // para pagos con tarjeta + 3DS vía Orders muestra payment_method
    // con solo id/type/token/installments, sin ningún campo relacionado
    // al banco emisor. No es una omisión nuestra: MP recomienda
    // issuer_id como campo de la API de Payments, pero no lo
    // contempla en el body de creación de una Order.
    try {
      const mpOrder = await getOrderClient().create({
        body: {
          type: "online",
          external_reference: input.orderId,
          currency: CURRENCY,
          total_amount: order.total.toFixed(2),
          // processing_mode/capture_mode: "automatic" — tal cual el
          // ejemplo oficial de la documentación de MP para 3DS vía
          // Orders (no "automatic_async": ese valor viene de un
          // comentario suelto del SDK, no de la documentación).
          processing_mode: "automatic",
          capture_mode: "automatic",
          description: `Pedido Casa Periotti #${order.orderNumber}`,
          items: extras.items.length ? extras.items : undefined,
          payer: {
            email: input.payerEmail,
            first_name: extras.payerFirstName,
            last_name: extras.payerLastName,
            identification: input.identificationType
              ? { type: input.identificationType, number: input.identificationNumber }
              : undefined,
            address: extras.address,
          },
          transactions: {
            payments: [
              {
                amount: order.total.toFixed(2),
                payment_method: {
                  id: input.paymentMethodId,
                  // Confirmado contra la API real (con credenciales de
                  // producción): sin este campo, POST /v1/orders
                  // responde 400 "missing properties: type" — a
                  // diferencia de la API de Payments, acá es
                  // obligatorio. input.paymentTypeId sale del formData
                  // del Brick (payment_type_id); si por lo que sea no
                  // llega, se cae a "credit_card" antes que mandar el
                  // campo vacío y que la orden ni se cree — no es
                  // trivialmente correcto para débito, pero es mejor
                  // que un 400 seguro.
                  type: input.paymentTypeId ?? "credit_card",
                  token: input.token,
                  installments: input.installments,
                  statement_descriptor: STATEMENT_DESCRIPTOR,
                },
              },
            ],
          },
          config: {
            online: {
              // notification_url se llamaba en la API de Payments — acá
              // es callback_url, mismo propósito (webhook de cambios de
              // estado). buildWebhookNotificationUrl() se omite igual
              // que antes si no hay APP_BASE_URL configurado (local).
              callback_url: buildWebhookNotificationUrl(),
              transaction_security: {
                validation: "on_fraud_risk",
                liability_shift: "required",
              },
            },
          },
        },
        // meliSessionId es el Device ID (MP_DEVICE_SESSION_ID) que genera
        // el SDK JS v2 en el navegador — el SDK de Node lo manda como
        // header X-Meli-Session-Id, igual que con Payment.create() (es un
        // mecanismo genérico de requestOptions, no específico de un
        // endpoint). Mercado Pago lo usa para evaluar el dispositivo del
        // comprador; es uno de los factores de mayor peso en la
        // aprobación de pagos.
        requestOptions: { idempotencyKey, meliSessionId: input.deviceId },
      });

      const paymentTx = mpOrder.transactions?.payments?.[0];
      const status = mapMercadoPagoOrderStatus(input.orderId, mpOrder.status, mpOrder.status_detail);
      // El status_detail que se guarda es el del pago individual (más
      // granular, ej. "cc_rejected_high_risk") si está disponible, y si
      // no el de la orden — mismo criterio que reconcileOrder() más abajo.
      const statusDetailToStore = paymentTx?.status_detail ?? mpOrder.status_detail ?? null;

      await this.adminDb
        .from("payments")
        .update({
          provider_payment_id: mpOrder.id != null ? String(mpOrder.id) : null,
          status,
          payment_method_id: paymentTx?.payment_method?.id ?? null,
          installments: paymentTx?.payment_method?.installments ?? null,
          status_detail: statusDetailToStore,
          raw_response: mpOrder,
        })
        .eq("id", paymentRow.id);

      if (status === "approved") {
        await this.orderService.confirmPaid(input.orderId);
        return { result: "approved" };
      }

      if (status === "rejected" || status === "cancelled") {
        await this.orderService.releaseReservation(
          input.orderId,
          status === "cancelled" ? "cancelled" : "payment_failed"
        );
        return { result: "rejected", reason: statusDetailToStore ?? undefined };
      }

      // status === "processing" | "pending": todavía no hay nada
      // resuelto, el stock sigue reservado. Si además es un challenge
      // 3DS pendiente con URL, se lo devolvemos al frontend para el
      // iframe; si no, es el mismo "queda esperando el webhook" de
      // siempre.
      const challengeUrl = paymentTx?.payment_method?.transaction_security?.url;
      if (mpOrder.status_detail === "pending_challenge" && challengeUrl) {
        return { result: "challenge_required", challengeUrl };
      }
      return { result: "pending" };
    } catch (err) {
      // El SDK de Mercado Pago (MercadoPagoError y subclases como
      // MPServerError) expone status/error/causes con el detalle real
      // que devolvió la API — nunca solo "algo falló". Se guarda en
      // raw_response para poder diagnosticar sin tener que reproducir
      // el pago de nuevo.
      const errorDetail = serializeMercadoPagoError(err);
      console.error(
        `[PaymentService] Error al crear la orden de pago en Mercado Pago para el pedido ${input.orderId}. Payload:`,
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
   *
   * Devuelve los ítems ya en el formato que espera `items` de la API de
   * Orders (unit_price como string, sin campo `id`).
   *
   * NO se manda external_code con el product_id: confirmado contra la
   * API real que ese campo tiene un límite de 30 caracteres
   * ('$.items[0].external_code' - length must be <= 30) y un UUID mide
   * 36 — mandarlo tal cual rompe la creación de la orden con 400. No
   * hay un código corto de producto en el schema (no hay SKU) para
   * usar en su lugar, así que se omite: es un campo opcional.
   */
  private async buildApprovalExtras(orderId: string): Promise<{
    payerFirstName?: string;
    payerLastName?: string;
    items: Array<{
      title: string;
      description?: string;
      quantity: number;
      unit_price: string;
    }>;
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
          title: it.product_name_snapshot as string,
          description: productDescription ?? (it.product_name_snapshot as string),
          quantity: it.quantity as number,
          unit_price: Number(it.unit_price).toFixed(2),
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
   * Firma sin cambios (un solo id como string) a propósito, para no
   * romper a sus dos callers actuales en este mismo commit: se intenta
   * primero como Order (el camino nuevo, mayoritario de acá en más) y
   * si Mercado Pago responde 404 ahí, se reintenta como Payment legacy
   * (pagos creados antes de esta migración). Evita tener que adivinar
   * de antemano, o guardar en la fila local, cuál API generó cada id.
   *
   * PENDIENTE: /api/webhooks/mercadopago todavía filtra
   * `type !== "payment"` y descarta cualquier notificación
   * `type: "order"` antes de llegar acá — hace falta ese ajuste (fuera
   * del alcance de este cambio, que es solo payment-service.ts) para
   * que la reconciliación por webhook funcione con pagos nuevos.
   *
   * Devuelve null si ese id todavía no tiene un pago nuestro asociado
   * (puede pasar si el webhook llega antes de que termine de guardarse
   * la respuesta síncrona) y tampoco se pudo resolver por
   * external_reference (ver más abajo).
   */
  async reconcilePayment(providerPaymentId: string): Promise<{
    orderId: string;
    status: InternalPaymentStatus;
    statusDetail: string | null;
  } | null> {
    try {
      return await this.reconcileOrder(providerPaymentId);
    } catch (err) {
      if (!(err instanceof MPNotFoundError)) throw err;
      return await this.reconcileLegacyPayment(providerPaymentId);
    }
  }

  private async reconcileOrder(orderId: string): Promise<{
    orderId: string;
    status: InternalPaymentStatus;
    statusDetail: string | null;
  } | null> {
    const mpOrder = await getOrderClient().get({ id: orderId });

    const { data: paymentRow } = await this.adminDb
      .from("payments")
      .select("order_id")
      .eq("provider_payment_id", String(mpOrder.id))
      .maybeSingle();

    let localOrderId = paymentRow?.order_id as string | undefined;

    if (!localOrderId && mpOrder.external_reference) {
      // Camino de respaldo: processCardPayment manda external_reference
      // = order_id en TODA orden que crea, así que si el pago propio por
      // algún motivo se quedó sin provider_payment_id (ej. el proceso se
      // cortó justo después de crear la orden en Mercado Pago y antes de
      // guardar la respuesta síncrona), se lo encuentra igual por acá y
      // se completa provider_payment_id para que quede consistente de
      // ahora en más.
      const { data: fallbackRow } = await this.adminDb
        .from("payments")
        .select("id, order_id")
        .eq("order_id", mpOrder.external_reference)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fallbackRow) {
        localOrderId = fallbackRow.order_id as string;
        await this.adminDb
          .from("payments")
          .update({ provider_payment_id: String(mpOrder.id) })
          .eq("id", fallbackRow.id);
      }
    }

    if (!localOrderId) return null;

    const paymentTx = mpOrder.transactions?.payments?.[0];
    const status = mapMercadoPagoOrderStatus(localOrderId, mpOrder.status, mpOrder.status_detail);
    const statusDetail = paymentTx?.status_detail ?? mpOrder.status_detail ?? null;

    await this.adminDb
      .from("payments")
      .update({ status, status_detail: statusDetail, raw_response: mpOrder })
      .eq("order_id", localOrderId);

    if (status === "approved") {
      await this.orderService.confirmPaid(localOrderId); // idempotente
    } else if (status === "rejected") {
      await this.orderService.releaseReservation(localOrderId, "payment_failed"); // idempotente
    } else if (status === "cancelled") {
      await this.orderService.releaseReservation(localOrderId, "cancelled"); // idempotente
    }

    return { orderId: localOrderId, status, statusDetail };
  }

  /**
   * Reconciliación legacy contra la API de Payments — se mantiene sin
   * tocar (misma lógica de siempre) para los pagos creados antes de la
   * migración a Orders. Nunca se llama para pagos nuevos: reconcilePayment()
   * solo cae acá si Mercado Pago responde 404 al intentarlo como Order.
   */
  private async reconcileLegacyPayment(providerPaymentId: string): Promise<{
    orderId: string;
    status: InternalPaymentStatus;
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

/**
 * Traduce el status/status_detail de una Order de la API de Orders (la
 * usada desde esta migración para poder pedir 3DS 2.0) a nuestro estado
 * interno. Distinta de mapMercadoPagoStatus() (API de Payments, legacy,
 * se mantiene abajo sin tocar para reconcileLegacyPayment) porque los
 * valores y su significado no son los mismos — ver docs/mercadopago.md
 * y la tabla de mapeo revisada antes de este cambio.
 *
 * Reglas no negociables:
 *  - SOLO "processed" + "accredited" aprueba la venta. Es el único
 *    camino que descuenta stock real y dispara facturación — ante
 *    cualquier otro status_detail bajo "processed" (no debería pasar,
 *    pero si pasa) NUNCA se asume aprobado: se loguea como emergencia y
 *    se trata como "pending" (no resuelto, no se toca nada).
 *  - "action_required" + "pending_challenge" reutiliza el estado
 *    interno "processing" — no hay estado nuevo en el enum de Postgres.
 *    Se distingue de un "processing" común por status_detail =
 *    "pending_challenge", que usa /admin/pedidos para mostrar una
 *    etiqueta distinta ("esperando al comprador" vs "esperando a MP").
 *  - "failed" (cualquier status_detail, sea el challenge fallido u otro
 *    rechazo) y "canceled" liberan stock — la única diferencia entre
 *    "rejected" y "cancelled" es la etiqueta en el panel, no el
 *    comportamiento (ambos se resuelven con releaseReservation()).
 */
export function mapMercadoPagoOrderStatus(
  contextId: string,
  orderStatus: string | undefined,
  orderStatusDetail: string | undefined
): InternalPaymentStatus {
  if (orderStatus === "processed") {
    if (orderStatusDetail === "accredited") return "approved";
    console.error(
      `[PaymentService] PELIGRO: Mercado Pago devolvió status="processed" con status_detail="${orderStatusDetail}" (≠"accredited") para "${contextId}" — NO se confirma la venta ni se descuenta stock. Solo "processed"+"accredited" aprueba. Revisar manualmente en el panel de Mercado Pago.`
    );
    return "pending";
  }

  if (orderStatus === "action_required") {
    if (orderStatusDetail !== "pending_challenge") {
      console.warn(
        `[PaymentService] status="action_required" con status_detail="${orderStatusDetail}" (se esperaba "pending_challenge") para "${contextId}" — se trata igual como no resuelto, sin liberar stock ni confirmar.`
      );
    }
    return "processing";
  }

  if (orderStatus === "failed") return "rejected";
  if (orderStatus === "canceled") return "cancelled";
  if (orderStatus === "created") return "pending";

  console.warn(
    `[PaymentService] status="${orderStatus}" no reconocido para "${contextId}" (status_detail="${orderStatusDetail}") — se trata como "pending", sin tocar stock ni facturación.`
  );
  return "pending";
}

/**
 * Legacy — API de Payments. Se mantiene sin tocar para
 * reconcileLegacyPayment() (pagos creados antes de la migración a
 * Orders). No se usa para pagos nuevos.
 */
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
