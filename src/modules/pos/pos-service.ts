import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OrderService } from "@/modules/orders/order-service";
import { OrderFulfillmentService } from "@/modules/orders/order-fulfillment-service";
import { assertSaleFiscalChoice } from "@/modules/billing/sale-fiscal-guard";
import { fiscalIdDigits } from "@/shared/utils/cuit";
import type { PadronCheckResult } from "@/modules/billing/arca-adapter";
import { saveOrderFiscalChoice } from "@/modules/orders/order-fiscal-choice";
import type { CreatePosSaleInput } from "./schemas";

const ROLES_QUE_PUEDEN_VENDER = ["ventas", "admin", "super_admin"] as const;

export class UnauthorizedError extends Error {
  constructor(message = "Tu rol no tiene permiso para registrar ventas de mostrador") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/** El comprobante elegido no se puede emitir; la venta no se registra. */
export class FacturaABuyerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FacturaABuyerError";
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
 * etc. en mano), así que en vez de esperar a que un empleado verifique
 * el comprobante como en la venta web, se llama a confirm_order_paid
 * inmediatamente después de crear el pedido. Todo lo demás — recálculo
 * de precio según tipo de cliente, descuento de stock, facturación A/B,
 * emails — es exactamente el mismo código que usa la venta web
 * (OrderService, OrderFulfillmentService). Nada de esa lógica se
 * duplica acá.
 */
export class PosService {
  constructor(private readonly adminDb: SupabaseClient) {}

  private assertCanSell(employeeRole: string) {
    if (!ROLES_QUE_PUEDEN_VENDER.includes(employeeRole as never)) {
      throw new UnauthorizedError();
    }
  }

  /**
   * Validación fiscal ANTES de crear el pedido: en el mostrador el cobro y
   * el descuento de stock pasan en el mismo momento, y si recién fallara
   * al facturar quedaría una venta cobrada sin factura. Mismo control que
   * el checkout web (sale-fiscal-guard.ts).
   */
  private async assertFiscalChoice(input: CreatePosSaleInput): Promise<PadronCheckResult | null> {
    const { error, padron } = await assertSaleFiscalChoice(
      this.adminDb,
      input.fiscal.kind === "fiscal_data"
        ? { kind: "fiscal_data", cuit: input.fiscal.cuit ?? null }
        : { kind: "final_consumer", dni: input.fiscal.dni || null },
      { customerId: input.customerId, items: input.items, pricePreference: input.pricePreference }
    );
    if (error) throw new FacturaABuyerError(error);
    return padron;
  }

  async createSale(
    employee: { id: string; role: string },
    input: CreatePosSaleInput
  ): Promise<PosSaleResult> {
    this.assertCanSell(employee.role);

    // Antes de tocar stock: el comprobante tiene que poder emitirse.
    const padron = await this.assertFiscalChoice(input);

    const orderService = new OrderService(this.adminDb);

    // 1. Mismo camino que el checkout web: reserva stock y recalcula el
    //    precio real en el servidor según el tipo del cliente elegido
    //    (o minorista si queda como Consumidor Final / customerId null).
    const order = await orderService.createFromCart({
      customerId: input.customerId,
      items: input.items,
      fulfillmentMethod: "pickup",
      pricePreference: input.pricePreference,
    });

    // 2. El cobro ya ocurrió en el mostrador — se registra como pago ya
    //    aprobado, sin pasar por ninguna verificación posterior.
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

    // La elección fiscal de ESTA venta se guarda junto al pedido (migración
    // 0018), antes de confirmar la venta. La facturación y el envío del
    // comprobante la leen de ahí, también si la emisión falla y la
    // reintenta el cron. No toca stock: si este insert falla, la venta se
    // corta antes de descontarlo, igual que si fallara el pago de arriba.
    await saveOrderFiscalChoice(this.adminDb, {
      orderId: order.id,
      requestedKind: input.fiscal.kind,
      cuit: input.fiscal.kind === "fiscal_data" ? fiscalIdDigits(input.fiscal.cuit) : null,
      dni: input.fiscal.kind === "final_consumer" ? fiscalIdDigits(input.fiscal.dni) || null : null,
      buyerName: input.looseBuyer?.buyerName || null,
      buyerEmail: input.looseBuyer?.buyerEmail || null,
      padron,
      createdBy: employee.id,
    });

    // 3. Mismo RPC que usa la confirmación de una transferencia:
    //    descuenta stock real y pasa el pedido a 'paid'. Idempotente.
    await orderService.confirmPaid(order.id);

    // 4. Misma facturación (A/B según el padrón) + emails que una venta
    //    web — nunca se duplica esta lógica. Lee la elección fiscal y el
    //    mail del comprador de order_fiscal_choices. Si algo de esto
    //    falla, no revierte la venta (ya está cobrada y con stock
    //    descontado): queda registrado y lo reintenta el cron.
    await new OrderFulfillmentService(this.adminDb).fulfillPaidOrder(order.id);

    await this.adminDb.from("audit_logs").insert({
      user_id: employee.id,
      action: "create_pos_sale",
      entity_type: "order",
      entity_id: order.id,
      data_after: {
        customerId: input.customerId,
        looseBuyer: input.looseBuyer,
        paymentMethod: input.paymentMethod,
        pricePreference: input.pricePreference,
        items: input.items,
        total: order.total,
      },
    });

    return { orderId: order.id, orderNumber: order.orderNumber, total: order.total };
  }
}
