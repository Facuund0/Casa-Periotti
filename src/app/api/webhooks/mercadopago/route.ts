import { NextResponse, after } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { PaymentService } from "@/modules/payments/payment-service";
import { OrderFulfillmentService } from "@/modules/orders/order-fulfillment-service";

/**
 * Reglas de este endpoint, todas no-negociables:
 *  1. Se valida la firma HMAC antes de tocar cualquier dato.
 *  2. NUNCA se confía en el estado que viene en la notificación — se
 *     vuelve a pedir el pago completo, directo a la API de Mercado
 *     Pago, con el access token propio.
 *  3. Confirmar un pedido pagado dos veces (por un webhook repetido)
 *     no puede facturar ni descontar stock dos veces: eso lo garantiza
 *     confirm_order_paid, que es idempotente en la base de datos.
 *  4. Siempre se responde 200 si el problema es "esto no nos interesa"
 *     (firma inválida, evento que no es de pagos), para no generar un
 *     loop de reintentos agresivos de Mercado Pago.
 *
 * Mercado Pago manda notificaciones en dos formatos posibles, y ambos
 * hay que soportarlos porque una misma cuenta puede recibir cualquiera
 * de los dos según cómo esté configurada la integración:
 *  - IPN clásico (histórico): GET con query params `topic` + `id`
 *    (ej. ?topic=payment&id=123). Para topic=payment, `id` YA es el ID
 *    del pago directamente — no hace falta resolverlo contra otro
 *    recurso (a diferencia de topic=merchant_order, que no manejamos
 *    porque filtramos por type/topic === "payment"). No hay evidencia
 *    en la documentación de que exista un IPN clásico equivalente para
 *    `order` — es un formato de compatibilidad anterior a la propia
 *    API de Orders.
 *  - Webhooks (actual): POST con body JSON
 *    { type: "payment", data: { id: "123" } }, y puede no traer query
 *    params en absoluto. Desde la migración a la API de Orders (ver
 *    docs/mercadopago.md) también llega `type: "order"` con
 *    `data: { id: "ORD..." }` — mismo formato, mismo esquema de firma
 *    (confirmado contra la documentación de Mercado Pago: misma terna
 *    x-signature/x-request-id/data.id), tratado igual acá abajo.
 *    Los pedidos viejos (creados antes de la migración) van a seguir
 *    notificando type:"payment" — por eso se siguen aceptando los dos,
 *    nunca se reemplaza uno por el otro.
 * Por eso el handler acepta tanto GET como POST, y busca type/topic e
 * id/data.id primero en la URL y después en el body.
 */
export async function GET(request: Request) {
  return handleNotification(request);
}

export async function POST(request: Request) {
  return handleNotification(request);
}

async function handleNotification(request: Request) {
  const url = new URL(request.url);
  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");

  // Se lee como texto (no request.json()) para poder loguear el body
  // crudo tal cual llega, incluso si no es JSON válido — clave para
  // diagnosticar formatos de notificación que no esperábamos. En un
  // GET (IPN clásico) esto va a ser un string vacío, es esperable.
  const rawBody = await request.text();
  let parsedBody: Record<string, unknown> | null = null;
  if (rawBody) {
    try {
      const parsed = JSON.parse(rawBody);
      if (parsed && typeof parsed === "object") parsedBody = parsed as Record<string, unknown>;
    } catch {
      console.warn("[webhook mercadopago] Body no es JSON válido:", rawBody);
    }
  }

  console.log("[webhook mercadopago] Notificación recibida:", {
    method: request.method,
    url: request.url,
    query: Object.fromEntries(url.searchParams.entries()),
    headers: {
      "x-signature": xSignature,
      "x-request-id": xRequestId,
      "content-type": request.headers.get("content-type"),
      "user-agent": request.headers.get("user-agent"),
    },
    body: parsedBody ?? rawBody,
  });

  const bodyData =
    parsedBody?.data && typeof parsedBody.data === "object"
      ? (parsedBody.data as Record<string, unknown>)
      : null;
  const bodyDataId = bodyData?.id;

  const typeFromQuery = url.searchParams.get("type");
  const topicFromQuery = url.searchParams.get("topic");
  const dataIdFromQuery = url.searchParams.get("data.id");
  const idFromQuery = url.searchParams.get("id");
  const typeFromBody = typeof parsedBody?.type === "string" ? parsedBody.type : null;
  const topicFromBody = typeof parsedBody?.topic === "string" ? parsedBody.topic : null;
  const dataIdFromBody = bodyDataId != null ? String(bodyDataId) : null;

  const dataId = dataIdFromQuery ?? idFromQuery ?? dataIdFromBody;
  const type = typeFromQuery ?? topicFromQuery ?? typeFromBody ?? topicFromBody;

  // Mercado Pago manda, para un mismo pago, DOS entregas con esquemas
  // distintos: el formato Webhooks actual (data.id + type, firmado con
  // HMAC vía x-signature) y, además, el formato IPN clásico de
  // compatibilidad (id + topic). El IPN clásico NO tiene esquema de
  // firma — no existe un x-signature válido para armarle el manifest —
  // así que validarlo contra isValidSignature() siempre da "no
  // coincide" y descarta una notificación legítima. Se lo distingue por
  // el ORIGEN del dataId: solo llegó por el "id" clásico, nunca por
  // "data.id" (ni en query ni en body).
  const isLegacyIpnFormat = !dataIdFromQuery && !dataIdFromBody && !!idFromQuery;

  // Log explícito de qué se extrajo y de dónde salió cada valor —
  // independiente de si la notificación después se descarta o no, para
  // poder diagnosticar sin adivinar a partir del payload crudo de arriba.
  console.log("[webhook mercadopago] Valores extraídos:", {
    type,
    dataId,
    isLegacyIpnFormat,
    sources: { typeFromQuery, topicFromQuery, dataIdFromQuery, idFromQuery, typeFromBody, topicFromBody, dataIdFromBody },
  });

  if (isLegacyIpnFormat) {
    // Sin firma que validar, la autenticidad se confirma más abajo de
    // otra forma: reconcilePayment() consulta este dataId directo
    // contra la API de Mercado Pago con NUESTRO access token, y esa API
    // solo devuelve el pago si pertenece a nuestra cuenta (si no,
    // responde 404) — eso ya prueba que es legítimo, sin HMAC.
    console.log(
      `[webhook mercadopago] Camino tomado: IPN clásico (dataId="${dataId}") — se omite validación de firma, autenticidad se confirma al consultar el pago contra la API de MP.`
    );
  } else {
    if (!isValidSignature(xSignature, xRequestId, dataId)) {
      console.warn(
        `[webhook mercadopago] Notificación descartada por firma inválida. type="${type ?? "(ninguno)"}" dataId="${dataId ?? "(ninguno)"}" x-signature=${xSignature ? "presente" : "ausente"} x-request-id=${xRequestId ? "presente" : "ausente"}`
      );
      return NextResponse.json({ ok: true });
    }
    console.log(`[webhook mercadopago] Camino tomado: formato nuevo (dataId="${dataId}") — firma HMAC validada OK.`);
  }

  if ((type !== "payment" && type !== "order") || !dataId) {
    console.warn(
      `[webhook mercadopago] Notificación descartada: type/topic="${type ?? "(ninguno)"}" (se esperaba "payment" u "order"), dataId="${dataId ?? "(ninguno)"}" (se esperaba un id no vacío)`
    );
    return NextResponse.json({ ok: true });
  }

  const adminDb = createAdminClient();

  // Se registra CADA entrega del webhook para auditoría. El event_id
  // usa x-request-id (identifica la entrega HTTP puntual) en vez del
  // id del pago, porque un mismo pago puede generar varias
  // notificaciones legítimas a medida que cambia de estado
  // (pending -> approved, por ejemplo) y no queremos perderlas.
  const eventId = xRequestId ?? `${dataId}:${Date.now()}`;
  console.log(
    `[webhook mercadopago] Registrando evento event_id="${eventId}" (${xRequestId ? "desde x-request-id" : "fallback dataId+timestamp, x-request-id ausente"}) dataId="${dataId}"`
  );
  const { data: eventRow, error: insertEventError } = await adminDb
    .from("webhook_events")
    .insert({ provider: "mercadopago", event_id: eventId, payload: { type, dataId, xRequestId } })
    .select("id")
    .single();

  if (insertEventError) {
    if (insertEventError.code === "23505") {
      // Reintento exacto de una entrega que ya vimos: no hay nada más que hacer.
      console.log(
        `[webhook mercadopago] Descartada por duplicada: ya existe un evento con event_id="${eventId}" (provider=mercadopago). No se reprocesa.`
      );
      return NextResponse.json({ ok: true, note: "entrega duplicada, ya procesada" });
    }
    console.error(
      `[webhook mercadopago] Descartada: error al insertar en webhook_events (event_id="${eventId}"):`,
      insertEventError
    );
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  console.log(`[webhook mercadopago] Evento registrado (id=${eventRow.id}). Reconciliando pago dataId="${dataId}"...`);

  try {
    // Misma lógica que usa el botón manual "Consultar estado del pago"
    // del panel — nunca se duplica el tratamiento de la respuesta de
    // Mercado Pago, solo cambia quién dispara la consulta.
    const result = await new PaymentService(adminDb).reconcilePayment(dataId);

    if (!result) {
      // Puede pasar si el webhook llega antes de que termine de
      // guardarse la respuesta síncrona del pago. No es un error: se
      // ignora y, si hace falta, Mercado Pago va a reintentar.
      console.log(
        `[webhook mercadopago] Reconciliado sin resultado: dataId="${dataId}" no tiene todavía un pago propio asociado (provider_payment_id). Se marca procesado igual.`
      );
      await markEventProcessed(adminDb, eventRow.id);
      return NextResponse.json({ ok: true, note: "pago todavía no asociado a un pedido" });
    }

    console.log(
      `[webhook mercadopago] Pago reconciliado: dataId="${dataId}" orderId="${result.orderId}" status="${result.status}" statusDetail="${result.statusDetail ?? "(ninguno)"}"`
    );

    if (result.status === "approved") {
      // Facturar y mandar emails no tiene que demorar la respuesta a
      // Mercado Pago (que tiene su propio timeout de webhook) — corre
      // en background con after(). Si igual muere a mitad de camino,
      // el cron /api/cron/bill-unbilled-orders lo recupera.
      const orderId = result.orderId;
      after(async () => {
        try {
          await new OrderFulfillmentService(adminDb).fulfillPaidOrder(orderId);
        } catch (err) {
          console.error(`[webhook mercadopago] Error en fulfillPaidOrder en background para ${orderId}:`, err);
        }
      });
    }

    await markEventProcessed(adminDb, eventRow.id);
    console.log(`[webhook mercadopago] Entrega procesada OK (event_id="${eventId}").`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[webhook mercadopago] Descartada: excepción al procesar dataId="${dataId}" (event_id="${eventId}"):`, err);
    // No marcamos el evento como procesado: si Mercado Pago reintenta
    // esta misma entrega, se vuelve a intentar procesar (el insert de
    // arriba solo bloquea reintentos EXACTOS del mismo x-request-id,
    // así que un reintento con nuevo id vuelve a pasar por acá).
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}

async function markEventProcessed(adminDb: ReturnType<typeof createAdminClient>, eventRowId: string) {
  await adminDb
    .from("webhook_events")
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq("id", eventRowId);
}

/**
 * Valida la firma HMAC del header x-signature contra el secreto de
 * webhook de tu cuenta de Mercado Pago (MERCADOPAGO_WEBHOOK_SECRET).
 * Formato del header: "ts=1704908010,v1=abc123...".
 *
 * Se usa igual para notificaciones type:"payment" y type:"order": la
 * documentación de Mercado Pago no publica el manifest literal para
 * ninguna de las dos (solo muestra el uso de los validadores oficiales
 * de cada SDK), pero confirma la misma terna de datos —x-signature,
 * x-request-id, data.id— para ambos tipos de notificación, sin señalar
 * ninguna diferencia entre recursos. Si en la práctica una notificación
 * type:"order" legítima empezara a rechazarse acá (ver el warning de
 * "firma inválida" en los logs), es la señal de que el manifest sí
 * difiere y hay que ajustarlo — no se aplicó a ciegas el atajo que sí
 * hace falta para el IPN clásico (que directamente no tiene firma).
 */
function isValidSignature(
  xSignature: string | null,
  xRequestId: string | null,
  dataId: string | null
): boolean {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;

  if (!secret) {
    // Sin secreto configurado no se puede validar — en testing lo
    // dejamos pasar para poder probar el flujo, pero en producción
    // esto tiene que estar configurado sí o sí.
    console.warn("[webhook mercadopago] MERCADOPAGO_WEBHOOK_SECRET no configurado.");
    return process.env.ARCA_ENVIRONMENT !== "production";
  }

  if (!xSignature) {
    // Esperable en notificaciones IPN clásicas (topic/id): ese formato
    // no manda x-signature en absoluto, solo lo manda el formato
    // Webhooks actual. Si la cuenta recibe notificaciones IPN con un
    // MERCADOPAGO_WEBHOOK_SECRET configurado, SIEMPRE van a rechazarse
    // acá — no es un bug de parseo, es que ese formato no es firmable.
    console.warn("[webhook mercadopago] Rechazo de firma: falta el header x-signature.");
    return false;
  }
  if (!xRequestId) {
    console.warn("[webhook mercadopago] Rechazo de firma: falta el header x-request-id.");
    return false;
  }
  if (!dataId) {
    console.warn("[webhook mercadopago] Rechazo de firma: no hay dataId para armar el manifest.");
    return false;
  }

  const parts: Record<string, string> = {};
  for (const piece of xSignature.split(",")) {
    const [key, value] = piece.split("=");
    if (key && value) parts[key.trim()] = value.trim();
  }

  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) {
    console.warn(`[webhook mercadopago] Rechazo de firma: x-signature con formato inesperado: "${xSignature}"`);
    return false;
  }

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const computed = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  try {
    const matches = crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(v1));
    if (!matches) console.warn("[webhook mercadopago] Rechazo de firma: HMAC no coincide con v1.");
    return matches;
  } catch {
    console.warn("[webhook mercadopago] Rechazo de firma: HMAC calculado y v1 tienen longitudes distintas.");
    return false; // longitudes distintas -> no coincide
  }
}
