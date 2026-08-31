import { NextResponse, after } from "next/server";
import { createClient } from "@/infrastructure/database/supabase-server";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { PaymentService } from "@/modules/payments/payment-service";
import { OrderFulfillmentService } from "@/modules/orders/order-fulfillment-service";
import { confirm3dsSchema } from "@/modules/payments/schemas";

/**
 * Lo llama el frontend después de que el iframe del challenge 3DS
 * manda postMessage({status: "COMPLETE"}) — ese evento solo dice que el
 * desafío TERMINÓ, no el resultado real (puede haber sido aprobado o
 * rechazado por el banco). Este endpoint reutiliza
 * PaymentService.reconcilePayment(), la misma consulta directa contra
 * la API de Mercado Pago que usa el webhook y el botón de admin — nunca
 * se confía en el postMessage del iframe para decidir el resultado.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = confirm3dsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }

  const adminDb = createAdminClient();

  // El pedido tiene que pertenecer a quien está consultando — mismo
  // chequeo que hace /api/payments/process antes de tocar cualquier dato.
  const { data: order } = await adminDb
    .from("orders")
    .select("id, customer_id")
    .eq("id", parsed.data.orderId)
    .maybeSingle();

  if (!order || order.customer_id !== user.id) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  const { data: payment } = await adminDb
    .from("payments")
    .select("provider_payment_id")
    .eq("order_id", order.id)
    .eq("provider", "mercadopago")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!payment?.provider_payment_id) {
    return NextResponse.json(
      { error: "Este pedido no tiene un pago de Mercado Pago para consultar" },
      { status: 409 }
    );
  }

  try {
    const result = await new PaymentService(adminDb).reconcilePayment(payment.provider_payment_id);

    if (!result) {
      // Puede pasar si se consulta antes de que termine de guardarse la
      // respuesta síncrona de processCardPayment() — no es un error,
      // el frontend reintenta.
      return NextResponse.json({ status: "pending", statusDetail: null });
    }

    if (result.status === "approved") {
      // Mismo criterio que /api/payments/process y el webhook: facturar
      // y mandar emails no tiene que demorar la respuesta.
      const orderId = result.orderId;
      after(async () => {
        try {
          await new OrderFulfillmentService(adminDb).fulfillPaidOrder(orderId);
        } catch (err) {
          console.error(`[confirm-3ds] Error en fulfillPaidOrder en background para ${orderId}:`, err);
        }
      });
    }

    return NextResponse.json({ status: result.status, statusDetail: result.statusDetail });
  } catch (err) {
    console.error(`[confirm-3ds] Error al reconciliar el pedido ${order.id}:`, err);
    return NextResponse.json(
      { error: "No pudimos confirmar el resultado del pago. Probá de nuevo." },
      { status: 500 }
    );
  }
}
