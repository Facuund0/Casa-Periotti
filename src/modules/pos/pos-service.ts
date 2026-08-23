import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrderService } from "@/modules/orders/order-service";
import { OrderFulfillmentService } from "@/modules/orders/order-fulfillment-service";
import type { ManualBuyerOverride } from "@/modules/billing/billing-service";
import type { CreatePosSaleInput } from "./schemas";

const ROLES_QUE_PUEDEN_VENDER = ["ventas", "admin", "super_admin"] as const;

export class UnauthorizedError extends Error {
  constructor(message = "Tu rol no tiene permiso para registrar ventas de mostrador") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export interface PosSaleResult {
  orderId: string;
  orderNumber: number;
  total: number;
}

/**
 * Venta de mostrador: pasa por las MISMAS funciones de Postgres que una
 * venta web (create_order, confirm_order_paid) — la única diferencia es
 * que acá el cobro ya se hizo en el momento (efectivo, transferencia,
 * etc. en mano), así que en vez de esperar la confirmación asincrónica
 * de Mercado Pago, se llama a confirm_order_paid inmediatamente después
 * de crear el pedido. Todo lo demás — recálculo de precio según tipo de
 * cliente, descuento de stock, facturación A/B, emails — es exactamente
 * el mismo código que usa la venta web (OrderService,
 * OrderFulfillmentService). Nada de esa lógica se duplica acá.
 */
export class PosService {
  constructor(private readonly adminDb: SupabaseClient) {}

  private assertCanSell(employeeRole: string) {
    if (!ROLES_QUE_PUEDEN_VENDER.includes(employeeRole as never)) {
      throw new UnauthorizedError();
    }
  }

  async createSale(
    employee: { id: string; role: string },
    input: CreatePosSaleInput
  ): Promise<PosSaleResult> {
    this.assertCanSell(employee.role);

    const orderService = new OrderService(this.adminDb);

    // 1. Mismo camino que el checkout web: reserva stock y recalcula el
    //    precio real en el servidor según el tipo del cliente elegido
    //    (o minorista si queda como Consumidor Final / customerId null).
    const order = await orderService.createFromCart({
      customerId: input.customerId,
      items: input.items,
      fulfillmentMethod: "pickup",
    });

    // 2. El cobro ya ocurrió en el mostrador — se registra como pago ya
    //    aprobado, sin pasar por Mercado Pago.
    const { error: paymentError } = await this.adminDb.from("payments").insert({
      order_id: order.id,
      provider: "pos",
      status: "approved",
      amount: order.total,
      idempotency_key: `pos-${order.id}`,
      payment_method_id: input.paymentMethod,
    });
    if (paymentError) {
      throw new Error(`No se pudo registrar el pago: ${paymentError.message}`);
    }

    // 3. Mismo RPC que usa el webhook / el pago con tarjeta sincrónico:
    //    descuenta stock real y pasa el pedido a 'paid'. Idempotente.
    await orderService.confirmPaid(order.id);

    // Si cargaron datos fiscales sueltos (comprador sin cuenta que pide
    // Factura A, por ejemplo), tienen prioridad sobre el customer_id del
    // pedido — nunca crean ni tocan un cliente, van directo a la factura.
    const manualBuyerOverride: ManualBuyerOverride | undefined = input.looseBuyer
      ? {
          buyerName: input.looseBuyer.buyerName,
          buyerCuitDni: input.looseBuyer.buyerCuitDni || null,
          buyerIvaCondition: input.looseBuyer.buyerIvaCondition,
        }
      : undefined;

    // 4. Misma facturación (A/B según condición de IVA) + emails que una
    //    venta web — nunca se duplica esta lógica. Si algo de esto
    //    falla, no revierte la venta (ya está cobrada y con stock
    //    descontado): queda registrado para resolverlo desde /admin/facturacion.
    await new OrderFulfillmentService(this.adminDb).fulfillPaidOrder(order.id, { manualBuyerOverride });

    await this.adminDb.from("audit_logs").insert({
      user_id: employee.id,
      action: "create_pos_sale",
      entity_type: "order",
      entity_id: order.id,
      data_after: {
        customerId: input.customerId,
        looseBuyer: input.looseBuyer,
        paymentMethod: input.paymentMethod,
        items: input.items,
        total: order.total,
      },
    });

    return { orderId: order.id, orderNumber: order.orderNumber, total: order.total };
  }
}
