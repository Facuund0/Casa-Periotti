import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { OrderService } from "@/modules/orders/order-service";
import { getTransferWindowMinutes } from "@/modules/payments/transfer-config";

export const dynamic = "force-dynamic";

/**
 * Un pedido esperando pago por transferencia tiene el stock RESERVADO
 * pero no descontado. Si el cliente nunca transfiere, esa reserva no se
 * libera sola — este endpoint la libera cuando venció el plazo, usando
 * la misma función de Postgres (release_order_reservation) que usa el
 * rechazo manual de un comprobante. Se llama con estado "cancelled"
 * porque acá nadie rechazó nada: el pedido simplemente no se pagó.
 *
 * El plazo NO se define acá: sale de getTransferWindowMinutes()
 * (PAYMENT_TRANSFER_WINDOW_MINUTES, default 30), el mismo valor que usa
 * el reloj que ve el cliente en el checkout. Si estuviera duplicado, el
 * reloj y el cancelado podrían decir cosas distintas.
 *
 * Los pedidos que YA tienen comprobante subido nunca se cancelan acá,
 * por más vencidos que estén — ver releaseStaleReservations().
 *
 * Frecuencia: el cron de Vercel (vercel.json) corre una vez por día
 * como red de respaldo. El disparador real es externo, cada 10 minutos
 * — ver README (sección "Cancelación de pedidos vencidos").
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const adminDb = createAdminClient();
  const orderService = new OrderService(adminDb);
  const windowMinutes = getTransferWindowMinutes();

  let result;
  try {
    result = await orderService.releaseStaleReservations(windowMinutes);
  } catch (err) {
    console.error("[cron release-stale-reservations] Error al buscar pedidos vencidos:", err);
    return NextResponse.json({ error: "Error al buscar pedidos vencidos" }, { status: 500 });
  }

  for (const failure of result.failures) {
    console.error(`[cron release-stale-reservations] Error al liberar el pedido ${failure.orderId}:`, failure.error);
  }

  console.log(
    `[cron release-stale-reservations] Liberadas ${result.released} de ${result.checked} reservas vencidas (plazo de ${windowMinutes} min). ${result.skippedWithReceipt} pedido(s) vencido(s) con comprobante subido quedaron esperando revisión manual en /admin/pedidos.`
  );

  return NextResponse.json({
    ok: true,
    windowMinutes,
    checked: result.checked,
    released: result.released,
    skippedWithReceipt: result.skippedWithReceipt,
    failed: result.failures.length,
    ...(result.failures.length > 0 ? { failures: result.failures } : {}),
  });
}

/**
 * Compara "Authorization: Bearer <secreto>" contra CRON_SECRET con
 * timingSafeEqual (mismo enfoque que la validación de firma del
 * cron de facturación) para no filtrar el secreto por timing.
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
