import { NextResponse } from "next/server";
import { createClient } from "@/infrastructure/database/supabase-server";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { OrderService, OrderCreationError } from "@/modules/orders/order-service";
import { checkoutSchema } from "@/modules/orders/schemas";
import { assertSaleFiscalChoice } from "@/modules/billing/sale-fiscal-guard";

export async function POST(request: Request) {
  // 1. Confirmamos quién es el cliente logueado con el cliente de
  // sesión normal (respeta auth), NUNCA confiamos en un customerId
  // que venga en el body del request.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Necesitás iniciar sesión para completar la compra" },
      { status: 401 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Datos de checkout inválidos", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // 2. Recién ahora, con el cliente admin, ejecutamos la creación del
  // pedido — que internamente vuelve a calcular todo desde cero.
  const adminDb = createAdminClient();
  const orderService = new OrderService(adminDb);

  // Validación fiscal ANTES de crear el pedido, que reserva stock: si
  // recién fallara al facturar (después de que un empleado confirme la
  // transferencia), quedaría una venta cobrada sin factura. Con datos
  // fiscales, el CUIT tiene que servir en el padrón; como Consumidor
  // Final, desde el umbral de ARCA hace falta el DNI. Ver sale-fiscal-guard.ts.
  const { data: fiscalProfile } = await adminDb
    .from("customer_profiles")
    .select("cuit_dni, dni, invoice_with_fiscal_data")
    .eq("id", user.id)
    .maybeSingle();

  try {
    const { error: fiscalError } = await assertSaleFiscalChoice(
      adminDb,
      fiscalProfile?.invoice_with_fiscal_data
        ? { kind: "fiscal_data", cuit: fiscalProfile.cuit_dni }
        : { kind: "final_consumer", dni: fiscalProfile?.dni ?? null },
      { customerId: user.id, items: parsed.data.items }
    );
    if (fiscalError) {
      return NextResponse.json({ error: fiscalError }, { status: 422 });
    }
  } catch (err) {
    console.error("Error al validar los datos fiscales del pedido:", err);
    return NextResponse.json(
      { error: "No pudimos validar los datos de facturación. Intentá de nuevo." },
      { status: 500 }
    );
  }

  try {
    const order = await orderService.createFromCart({
      customerId: user.id,
      items: parsed.data.items,
      fulfillmentMethod: parsed.data.fulfillmentMethod,
      shippingStreet: parsed.data.shippingStreet,
      shippingCity: parsed.data.shippingCity,
      notes: parsed.data.notes,
    });

    return NextResponse.json({ order });
  } catch (err) {
    if (err instanceof OrderCreationError) {
      // Mensajes como "sin stock suficiente de X" son seguros de mostrar tal cual.
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("Error inesperado al crear pedido:", err);
    return NextResponse.json(
      { error: "No pudimos procesar tu pedido. Intentá de nuevo." },
      { status: 500 }
    );
  }
}
