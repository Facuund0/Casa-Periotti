import { NextResponse } from "next/server";
import { createClient } from "@/infrastructure/database/supabase-server";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { OrderService, OrderCreationError } from "@/modules/orders/order-service";
import { checkoutSchema } from "@/modules/orders/schemas";

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
