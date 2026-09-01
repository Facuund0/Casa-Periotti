import { NextResponse, after } from "next/server";
import { createClient } from "@/infrastructure/database/supabase-server";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import {
  PaymentService,
  PaymentAlreadyInProgressError,
  OrderNotPayableError,
} from "@/modules/payments/payment-service";
import { OrderFulfillmentService } from "@/modules/orders/order-fulfillment-service";
import { processCardPaymentSchema } from "@/modules/payments/schemas";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Necesitás iniciar sesión" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = processCardPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos de pago inválidos" }, { status: 400 });
  }

  const adminDb = createAdminClient();

  // El pedido tiene que pertenecer a quien está pagando.
  const { data: order } = await adminDb
    .from("orders")
    .select("id, customer_id")
    .eq("id", parsed.data.orderId)
    .maybeSingle();

  if (!order || order.customer_id !== user.id) {
    return NextResponse.json({ error: "Pedido no encontrado" }, { status: 404 });
  }

  const paymentService = new PaymentService(adminDb);

  try {
    const outcome = await paymentService.processCardPayment({
      orderId: parsed.data.orderId,
      token: parsed.data.token,
      paymentMethodId: parsed.data.paymentMethodId,
      paymentTypeId: parsed.data.paymentTypeId,
      issuerId: parsed.data.issuerId,
      installments: parsed.data.installments,
      payerEmail: user.email!,
      identificationType: parsed.data.identificationType,
      identificationNumber: parsed.data.identificationNumber,
      deviceId: parsed.data.deviceId,
    });

    if (outcome.result === "approved") {
      // El pago ya está aprobado y el stock ya descontado en este punto
      // — facturar y mandar emails no tiene que demorar la respuesta al
      // navegador. after() corre esto DESPUÉS de mandar la respuesta,
      // mientras mantiene viva la función el tiempo necesario (a
      // diferencia de una promesa suelta, que en serverless puede
      // quedar congelada apenas se responde). Si igual muere a mitad de
      // camino, el cron /api/cron/bill-unbilled-orders lo recupera.
      const orderId = parsed.data.orderId;
      after(async () => {
        try {
          await new OrderFulfillmentService(adminDb).fulfillPaidOrder(orderId);
        } catch (err) {
          console.error(`[payments/process] Error en fulfillPaidOrder en background para ${orderId}:`, err);
        }
      });
    }

    return NextResponse.json(outcome);
  } catch (err) {
    if (err instanceof PaymentAlreadyInProgressError || err instanceof OrderNotPayableError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("Error al procesar pago:", err);
    return NextResponse.json(
      { error: "No pudimos procesar el pago. Intentá de nuevo." },
      { status: 500 }
    );
  }
}
