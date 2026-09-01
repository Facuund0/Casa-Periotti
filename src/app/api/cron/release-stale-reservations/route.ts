import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { OrderService } from "@/modules/orders/order-service";

export const dynamic = "force-dynamic";

// Atado a la ventana de 40 minutos que Mercado Pago le da al comprador
// para completar el challenge de 3DS (ver docs/mercadopago.md): si este
// umbral fuera menor a esos 40 minutos, el cron podría liberar el stock
// de un pedido con un challenge todavía en curso, aunque el comprador
// fuera a completarlo con éxito.
const STALE_THRESHOLD_MINUTES = 60;

/**
 * Un pedido queda en pending_payment (o payment_processing si llegó a
 * arrancar un intento de pago) con stock RESERVADO pero no descontado.
 * Si el cliente abandona el checkout, esa reserva nunca se liberaba
 * sola — este cron la libera después de STALE_THRESHOLD_MINUTES sin
 * actividad, usando la misma función de Postgres
 * (release_order_reservation) que ya usan el webhook de Mercado Pago y
 * el pago síncrono cuando el pago se rechaza. Se llama con estado
 * "cancelled" porque acá nadie rechazó el pago: el pedido simplemente
 * se abandonó.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const adminDb = createAdminClient();
  const orderService = new OrderService(adminDb);

  let result;
  try {
    result = await orderService.releaseStaleReservations(STALE_THRESHOLD_MINUTES);
  } catch (err) {
    console.error("[cron release-stale-reservations] Error al buscar pedidos abandonados:", err);
    return NextResponse.json({ error: "Error al buscar pedidos abandonados" }, { status: 500 });
  }

  for (const failure of result.failures) {
    console.error(`[cron release-stale-reservations] Error al liberar el pedido ${failure.orderId}:`, failure.error);
  }

  console.log(
    `[cron release-stale-reservations] Liberadas ${result.released} de ${result.checked} reservas abandonadas (más de ${STALE_THRESHOLD_MINUTES} min sin actividad).`
  );

  return NextResponse.json({
    ok: true,
    checked: result.checked,
    released: result.released,
    failed: result.failures.length,
    ...(result.failures.length > 0 ? { failures: result.failures } : {}),
  });
}

/**
 * Compara "Authorization: Bearer <secreto>" contra CRON_SECRET con
 * timingSafeEqual (mismo enfoque que la validación de firma del
 * webhook de Mercado Pago) para no filtrar el secreto por timing.
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[cron release-stale-reservations] CRON_SECRET no configurado.");
    return false;
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}
