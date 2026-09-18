import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertSaleFiscalChoice } from "@/modules/billing/sale-fiscal-guard";
import { OrderService } from "@/modules/orders/order-service";
import { OrderFulfillmentService } from "@/modules/orders/order-fulfillment-service";
import { saveOrderFiscalChoice } from "@/modules/orders/order-fiscal-choice";
import { fiscalIdDigits } from "@/shared/utils/cuit";
import { FacturaABuyerError } from "./pos-service";
import type { CreatePosSaleInput } from "./schemas";
import {
  cancelIntent,
  createIntent,
  getIntent,
  isDead,
  isPaid,
  PointNotConfiguredError,
  waitingLabel,
  type PointIntent,
} from "./point-client";

/**
 * Venta de mostrador cobrada con la terminal Point.
 *
 * Es la MISMA venta que una en efectivo — mismos create_order,
 * confirm_order_paid, misma facturación A/B y mismos emails — con una
 * sola diferencia: el cobro pasa en el medio, porque hay que esperar a
 * que el cliente pase la tarjeta.
 *
 *   empezar()    reserva stock (create_order) y le manda el monto a la
 *                terminal. Todavía no hay venta cobrada.
 *   revisar()    pregunta cómo salió. Si se cobró, registra el pago y
 *                confirma la venta (stock + factura). Si se rechazó o se
 *                canceló, libera la reserva.
 *   cancelar()   saca el monto de la terminal y libera la reserva.
 *
 * Por qué NO se toca PosService: ahí el cobro ya ocurrió antes de
 * empezar, así que el orden de los pasos es distinto. Los pasos en sí
 * son los mismos servicios, nunca una copia de su lógica.
 *
 * Si la pantalla se cierra en el medio, el cobro NO se pierde: el estado
 * vive en la base (migración 0029), así que al volver a abrir la venta
 * revisar() lo encuentra. Y si nadie vuelve, resolveStale() —que corre
 * con el cron de reservas vencidas— le pregunta a Mercado Pago y cierra
 * la venta si la tarjeta se cobró, o libera el stock si no. Ese cron
 * nunca cancela por su cuenta un pedido con un cobro Point abierto.
 */

/**
 * Quién queda registrado cuando el que resuelve el cobro es el cron y no
 * una persona. audit_logs acepta null en user_id, así que se usa eso.
 */
const SYSTEM_USER = null as unknown as string;

export interface PointSaleStart {
  orderId: string;
  orderNumber: number;
  total: number;
  intentId: string;
}

export type PointSaleStatus =
  | { status: "esperando"; state: string; label: string }
  | { status: "cobrado"; orderId: string; orderNumber: number; total: number }
  | { status: "no_cobrado"; reason: string };

export class PointSaleService {
  constructor(private readonly adminDb: SupabaseClient) {}

  /** La terminal configurada, o un error que explica qué falta. */
  private async deviceId(): Promise<string> {
    const { data, error } = await this.adminDb
      .from("payment_settings")
      .select("point_enabled, point_device_id")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(`No se pudo leer la configuración de pago: ${error.message}`);
    if (!data?.point_enabled || !data.point_device_id) {
      throw new PointNotConfiguredError(
        "El cobro con Point no está configurado. Elegí la terminal en Configuración de pago, o cobrá de otra forma."
      );
    }
    return data.point_device_id as string;
  }

  async start(
    employee: { id: string; role: string },
    input: CreatePosSaleInput
  ): Promise<PointSaleStart> {
    const device = await this.deviceId();

    // Antes de tocar stock: el comprobante tiene que poder emitirse.
    // Mismo guard que usa la venta en efectivo.
    const { error: fiscalError, padron } = await assertSaleFiscalChoice(
      this.adminDb,
      input.fiscal.kind === "fiscal_data"
        ? { kind: "fiscal_data", cuit: input.fiscal.cuit ?? null }
        : { kind: "final_consumer", dni: input.fiscal.dni || null },
      { customerId: input.customerId, items: input.items, pricePreference: input.pricePreference }
    );
    if (fiscalError) throw new FacturaABuyerError(fiscalError);

    const orderService = new OrderService(this.adminDb);

    // 1. Mismo camino que el checkout web y que la venta en efectivo:
    //    reserva stock y calcula el precio real en el servidor.
    const order = await orderService.createFromCart({
      customerId: input.customerId,
      items: input.items,
      fulfillmentMethod: "pickup",
      pricePreference: input.pricePreference,
    });

    // 2. La elección fiscal de ESTA venta, antes de cobrar: si falla, la
    //    venta se corta sin haberle mandado nada a la terminal.
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

    // 3. Recién ahora se le manda el monto a la terminal.
    let intent: PointIntent;
    try {
      intent = await createIntent({
        deviceId: device,
        amount: order.total,
        description: `Casa Periotti venta ${order.orderNumber}`,
        orderId: order.id,
        ticketNumber: String(order.orderNumber),
      });
    } catch (err) {
      // No se pudo ni pedir el cobro: se devuelve el stock en el acto,
      // sin esperar al cron.
      await orderService.releaseReservation(order.id, "payment_failed").catch(() => {});
      throw err;
    }

    const { error: saveError } = await this.adminDb.from("point_payment_intents").insert({
      order_id: order.id,
      intent_id: intent.id,
      device_id: device,
      amount: order.total,
      state: intent.state,
      created_by: employee.id,
    });
    if (saveError) {
      // Si no se puede dejar registrado el cobro, no se sigue: un pago
      // aprobado que nadie puede rastrear es peor que una venta cortada.
      await cancelIntent(device, intent.id).catch(() => {});
      await orderService.releaseReservation(order.id, "payment_failed").catch(() => {});
      throw new Error(`No se pudo registrar el cobro con Point: ${saveError.message}`);
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      total: order.total,
      intentId: intent.id,
    };
  }

  /**
   * Pregunta a Mercado Pago cómo salió el cobro y actúa en consecuencia.
   * Es idempotente: se puede llamar todas las veces que haga falta.
   */
  async check(employee: { id: string }, orderId: string): Promise<PointSaleStatus> {
    const { data: row, error } = await this.adminDb
      .from("point_payment_intents")
      .select("intent_id, device_id, amount, state, settled, payment_id")
      .eq("order_id", orderId)
      .maybeSingle();
    if (error) throw new Error(`No se pudo leer el cobro: ${error.message}`);
    if (!row) throw new Error("Esa venta no tiene un cobro con Point");

    const order = await new OrderService(this.adminDb).getById(orderId);
    if (!order) throw new Error("El pedido ya no existe");

    // Ya cobrada y confirmada: no se vuelve a tocar nada.
    if (row.settled) {
      return {
        status: "cobrado",
        orderId,
        orderNumber: order.orderNumber,
        total: Number(row.amount),
      };
    }

    const intent = await getIntent(row.intent_id as string);
    await this.adminDb
      .from("point_payment_intents")
      .update({
        state: intent.state,
        payment_id: intent.paymentId,
        payment_type: intent.paymentType,
        installments: intent.installments,
        last_checked_at: new Date().toISOString(),
      })
      .eq("order_id", orderId);

    if (isPaid(intent)) {
      await this.settle(employee, orderId, intent);
      return { status: "cobrado", orderId, orderNumber: order.orderNumber, total: Number(row.amount) };
    }

    if (isDead(intent)) {
      await this.giveUp(orderId);
      return {
        status: "no_cobrado",
        reason:
          intent.state === "canceled"
            ? "El cobro se canceló en la terminal."
            : intent.state === "expired"
              ? "El cobro venció sin que se pase la tarjeta."
              : intent.state === "refunded"
                ? "Ese cobro fue devuelto."
                : `La terminal rechazó el cobro${intent.statusDetail ? ` (${intent.statusDetail})` : ""}.`,
      };
    }

    return { status: "esperando", state: intent.state, label: waitingLabel(intent.state) };
  }

  /** Cancela el cobro pedido y devuelve el stock reservado. */
  async cancel(orderId: string): Promise<void> {
    const { data: row } = await this.adminDb
      .from("point_payment_intents")
      .select("intent_id, device_id, settled")
      .eq("order_id", orderId)
      .maybeSingle();
    if (!row) throw new Error("Esa venta no tiene un cobro con Point");
    if (row.settled) throw new Error("Esa venta ya se cobró: no se puede cancelar desde acá");

    // Si la terminal ya no acepta la cancelación (porque justo se cobró),
    // no se fuerza nada: el próximo check() lo resuelve.
    await cancelIntent(row.device_id as string, row.intent_id as string);
    await this.giveUp(orderId);
  }

  /**
   * Cobros que quedaron colgados: el empleado empezó el cobro y nadie
   * volvió a mirar la pantalla (se cerró el navegador, se cortó la luz).
   *
   * Es lo que evita el peor caso posible: que la tarjeta se haya cobrado
   * y el cron de reservas vencidas cancele el pedido igual. Acá se le
   * pregunta a Mercado Pago por cada uno:
   *   cobrado  → se confirma la venta, como si alguien hubiera mirado;
   *   no cobrado → se libera el stock;
   *   todavía esperando → se saca el monto de la terminal y se libera.
   *
   * Si no se puede hablar con Mercado Pago, el cobro NO se toca: queda
   * para el próximo intento. Un pedido reservado de más es un problema
   * chico; cancelar una venta ya cobrada, no.
   */
  async resolveStale(
    minutes: number,
    employee: { id: string } = { id: SYSTEM_USER }
  ): Promise<{ checked: number; settled: number; released: number; failed: number }> {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    const { data: rows, error } = await this.adminDb
      .from("point_payment_intents")
      .select("order_id, intent_id, device_id")
      .eq("settled", false)
      .lt("created_at", cutoff);
    if (error) throw new Error(`No se pudieron leer los cobros colgados: ${error.message}`);

    let settled = 0;
    let released = 0;
    let failed = 0;

    for (const row of rows ?? []) {
      const orderId = row.order_id as string;
      try {
        const intent = await getIntent(row.intent_id as string);

        if (isPaid(intent)) {
          await this.settle(employee, orderId, intent);
          settled += 1;
          continue;
        }

        if (!isDead(intent)) {
          // Seguía esperando al cliente: se saca de la terminal.
          await cancelIntent(row.device_id as string, row.intent_id as string).catch(() => {});
        }
        await this.adminDb
          .from("point_payment_intents")
          .update({ state: intent.state, last_checked_at: new Date().toISOString() })
          .eq("order_id", orderId);
        await this.giveUp(orderId);
        released += 1;
      } catch (err) {
        failed += 1;
        console.error(`[point resolveStale] pedido ${orderId}:`, err);
      }
    }

    return { checked: (rows ?? []).length, settled, released, failed };
  }

  /**
   * El cobro salió bien: de acá en adelante es exactamente lo que hace
   * una venta en efectivo.
   */
  private async settle(
    employee: { id: string },
    orderId: string,
    intent: PointIntent
  ): Promise<void> {
    const orderService = new OrderService(this.adminDb);
    const order = await orderService.getById(orderId);
    if (!order) throw new Error("El pedido ya no existe");

    // provider 'pos' a propósito: para los reportes, el cierre de caja y
    // el ticket esto es una venta de mostrador como cualquier otra. El
    // medio de pago 'point' es lo que la distingue.
    const { error: paymentError } = await this.adminDb.from("payments").insert({
      order_id: orderId,
      provider: "pos",
      status: "approved",
      amount: order.total,
      idempotency_key: `pos-${orderId}`,
      payment_method_id: "point",
      provider_payment_id: intent.paymentId,
      raw_response: {
        intent_id: intent.id,
        state: intent.state,
        payment_type: intent.paymentType,
        installments: intent.installments,
      },
    });
    // El insert puede fallar por la clave de idempotencia si ya se
    // registró en un intento anterior: eso no es un problema, se sigue.
    if (paymentError && !paymentError.message.includes("duplicate")) {
      throw new Error(`No se pudo registrar el pago: ${paymentError.message}`);
    }

    // Marcar antes de confirmar: si algo falla después, el pago ya quedó
    // asentado y confirm_order_paid es idempotente.
    await this.adminDb
      .from("point_payment_intents")
      .update({ settled: true, state: intent.state, payment_id: intent.paymentId })
      .eq("order_id", orderId);

    // Descuenta stock y pasa el pedido a 'paid'. Idempotente.
    await orderService.confirmPaid(orderId);

    // Misma facturación y mismos emails que el resto de las ventas.
    new OrderFulfillmentService(this.adminDb).scheduleFulfillment(orderId);

    await this.adminDb.from("audit_logs").insert({
      user_id: employee.id,
      action: "create_pos_sale_point",
      entity_type: "order",
      entity_id: orderId,
      data_after: {
        total: order.total,
        paymentMethod: "point",
        pointPaymentId: intent.paymentId,
        paymentType: intent.paymentType,
        installments: intent.installments,
      },
    });
  }

  /** No se cobró: el stock vuelve con la misma función que un pago rechazado. */
  private async giveUp(orderId: string): Promise<void> {
    await new OrderService(this.adminDb).releaseReservation(orderId, "payment_failed");
  }
}
