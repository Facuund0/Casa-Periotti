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
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const xSignature = request.headers.get("x-signature");
  const xRequestId = request.headers.get("x-request-id");

  // Se lee como texto (no request.json()) para poder loguear el body
  // crudo tal cual llega, incluso si no es JSON válido — clave para
  // diagnosticar formatos de notificación que no esperábamos.
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

  // Mercado Pago manda type/data.id como query params en el formato
  // clásico de IPN, pero el formato de Webhooks actual los manda en el
  // body como JSON ({ type: "payment", data: { id: "..." } }) y puede
  // no incluir query params en absoluto. Se busca primero en la URL y,
  // si no está, se cae al body.
  const bodyData =
    parsedBody?.data && typeof parsedBody.data === "object"
      ? (parsedBody.data as Record<string, unknown>)
      : null;
  const bodyDataId = bodyData?.id;

  const dataId =
    url.searchParams.get("data.id") ??
    url.searchParams.get("id") ??
    (bodyDataId != null ? String(bodyDataId) : null);
  const type =
    url.searchParams.get("type") ??
    url.searchParams.get("topic") ??
    (typeof parsedBody?.type === "string" ? parsedBody.type : null) ??
    (typeof parsedBody?.topic === "string" ? parsedBody.topic : null);

  if (!isValidSignature(xSignature, xRequestId, dataId)) {
    console.warn("[webhook mercadopago] Firma inválida, se ignora la notificación.");
    return NextResponse.json({ ok: true });
  }

  if (type !== "payment" || !dataId) {
    console.warn(
      `[webhook mercadopago] Notificación descartada: type="${type ?? "(ninguno)"}" (se esperaba "payment"), dataId="${dataId ?? "(ninguno)"}"`
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
  const { data: eventRow, error: insertEventError } = await adminDb
    .from("webhook_events")
    .insert({ provider: "mercadopago", event_id: eventId, payload: { type, dataId, xRequestId } })
    .select("id")
    .single();

  if (insertEventError) {
    if (insertEventError.code === "23505") {
      // Reintento exacto de una entrega que ya vimos: no hay nada más que hacer.
      return NextResponse.json({ ok: true, note: "entrega duplicada, ya procesada" });
    }
    console.error("[webhook mercadopago] Error al registrar el evento:", insertEventError);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  try {
    // Misma lógica que usa el botón manual "Consultar estado del pago"
    // del panel — nunca se duplica el tratamiento de la respuesta de
    // Mercado Pago, solo cambia quién dispara la consulta.
    const result = await new PaymentService(adminDb).reconcilePayment(dataId);

    if (!result) {
      // Puede pasar si el webhook llega antes de que termine de
      // guardarse la respuesta síncrona del pago. No es un error: se
      // ignora y, si hace falta, Mercado Pago va a reintentar.
      await markEventProcessed(adminDb, eventRow.id);
      return NextResponse.json({ ok: true, note: "pago todavía no asociado a un pedido" });
    }

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
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook mercadopago] Error al procesar:", err);
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

  if (!xSignature || !xRequestId || !dataId) return false;

  const parts: Record<string, string> = {};
  for (const piece of xSignature.split(",")) {
    const [key, value] = piece.split("=");
    if (key && value) parts[key.trim()] = value.trim();
  }

  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
  const computed = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(v1));
  } catch {
    return false; // longitudes distintas -> no coincide
  }
}
