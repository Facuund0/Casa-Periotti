import { NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { OrderFulfillmentService } from "@/modules/orders/order-fulfillment-service";

export const dynamic = "force-dynamic";

// Margen antes de considerar un pedido "sin facturar todavía" en vez de
// "la facturación en background recién está corriendo" — el after()
// de /api/payments/process y el webhook normalmente terminan en
// segundos, esto solo evita pisarles el intento en curso.
const GRACE_PERIOD_MINUTES = 3;

/**
 * Red de seguridad para la facturación en background: /api/payments/process
 * y el webhook de Mercado Pago disparan fulfillPaidOrder() con after()
 * (corre después de responderle al navegador/a MP) para no demorar esa
 * respuesta esperando a ARCA. En serverless eso no tiene garantía
 * absoluta de terminar — si el proceso muere a mitad de camino, el
 * pedido queda pagado pero sin factura autorizada, sin que nadie se
 * entere. Este cron busca esos casos y reintenta, reutilizando
 * fulfillPaidOrder() (la misma función que ya usan el pago síncrono y
 * el webhook) — nunca se duplica la lógica de facturación acá.
 */
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const adminDb = createAdminClient();
  const cutoff = new Date(Date.now() - GRACE_PERIOD_MINUTES * 60 * 1000).toISOString();

  const { data: paidOrders, error } = await adminDb
    .from("orders")
    .select("id")
    .eq("status", "paid")
    .lt("updated_at", cutoff);

  if (error) {
    console.error("[cron bill-unbilled-orders] Error al buscar pedidos pagados:", error);
    return NextResponse.json({ error: "Error al buscar pedidos pagados" }, { status: 500 });
  }

  const unbilled: string[] = [];
  for (const order of paidOrders ?? []) {
    const { data: authorizedInvoice } = await adminDb
      .from("invoices")
      .select("id")
      .eq("order_id", order.id)
      .eq("status", "authorized")
      .maybeSingle();

    if (!authorizedInvoice) unbilled.push(order.id);
  }

  const failures: { orderId: string; error: string }[] = [];
  let billed = 0;

  for (const orderId of unbilled) {
    try {
      // fulfillPaidOrder() nunca tira: si la facturación falla de
      // nuevo, la deja registrada (rejected/retry_pending) y notifica
      // por email interno, igual que en el camino normal.
      await new OrderFulfillmentService(adminDb).fulfillPaidOrder(orderId);
      billed++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failures.push({ orderId, error: message });
      console.error(`[cron bill-unbilled-orders] Error al facturar el pedido ${orderId}:`, err);
    }
  }

  console.log(
    `[cron bill-unbilled-orders] Reintentada la facturación de ${billed} de ${unbilled.length} pedidos pagados sin factura autorizada.`
  );

  return NextResponse.json({
    ok: true,
    checked: unbilled.length,
    billed,
    failed: failures.length,
    ...(failures.length > 0 ? { failures } : {}),
  });
}

/**
 * Mismo esquema que /api/cron/release-stale-reservations: compara
 * "Authorization: Bearer <secreto>" contra CRON_SECRET con
 * timingSafeEqual para no filtrar el secreto por timing.
 */
function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[cron bill-unbilled-orders] CRON_SECRET no configurado.");
    return false;
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}
