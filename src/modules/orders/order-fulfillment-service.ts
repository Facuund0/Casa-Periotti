import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { BillingService } from "@/modules/billing/billing-service";
import { getOrderFiscalChoice } from "./order-fiscal-choice";
import { EmailService } from "@/modules/emails/email-service";

/**
 * Se llama una sola vez que un pedido pasa a 'paid' (desde el pago
 * síncrono o desde el webhook). Factura y manda emails, pero si
 * cualquiera de los dos falla, NO revierte la venta ni el stock — el
 * cliente ya pagó, eso ya es un hecho. Lo que hace es dejar todo
 * registrado para que un empleado de facturación lo resuelva a mano
 * desde el panel si hace falta.
 */
export class OrderFulfillmentService {
  constructor(private readonly adminDb: SupabaseClient) {}

  /**
   * Factura y manda los mails DESPUÉS de responder (after() de Next; en
   * Vercel usa waitUntil). Para quien confirma un pago o registra una
   * venta: ARCA tarda 2 a 5 segundos y no tiene sentido hacerlo esperar.
   *
   * No cambia nada de lo que pasa, solo cuándo: el pedido ya está pagado y
   * con el stock descontado antes de llamar a esto. Si ARCA rechaza la
   * factura, queda igual que antes: la venta no se revierte (el cliente
   * ya pagó), la factura queda "Rechazada" en Facturación con aviso en el
   * panel y por mail interno, y el cron bill-unbilled-orders la reintenta.
   *
   * Solo se puede llamar dentro de un pedido HTTP (Server Action o Route
   * Handler). El cron usa fulfillPaidOrder() directo.
   */
  scheduleFulfillment(orderId: string): void {
    after(() => this.fulfillPaidOrder(orderId));
  }

  /**
   * La elección fiscal y el mail de un comprador de mostrador sin cuenta
   * se leen de order_fiscal_choices (migración 0018), no se reciben por
   * parámetro: así un reintento del cron factura y envía igual que el
   * primer intento.
   */
  async fulfillPaidOrder(orderId: string) {
    let invoiceId: string | null = null;

    // BillingService (y el ArcaAdapter que construye) tira una excepción
    // si falta configuración de ARCA. Se instancia recién acá, dentro de
    // su propio try/catch: para este punto el cobro ya se hizo y el
    // stock ya se descontó, así que un ARCA mal configurado no puede
    // tirar abajo la respuesta del pago.
    try {
      const billingService = new BillingService(this.adminDb);
      invoiceId = await billingService.billOrder(orderId);
    } catch (err) {
      console.error(`Error al facturar pedido ${orderId}:`, err);
      try {
        const emailService = new EmailService(this.adminDb);
        await emailService.notifyInternalError(
          "Error de facturación",
          `No se pudo facturar automáticamente el pedido ${orderId}. Revisar en /admin/facturacion. Detalle: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      } catch (notifyErr) {
        console.error(`Error al notificar el fallo de facturación del pedido ${orderId}:`, notifyErr);
      }
    }

    // El email nunca bloquea ni revierte la venta — es una operación
    // desacoplada. Si falla (o si EmailService no puede instanciarse),
    // se registra pero el pedido sigue su curso normal.
    try {
      // Una venta de mostrador a alguien sin cuenta no tiene customer_id:
      // si el empleado cargó un mail, el comprobante va ahí.
      // Si no se puede leer, se registra y el envío sigue como para
      // cualquier pedido: no se deja sin mail a un cliente registrado.
      const storedChoice = await getOrderFiscalChoice(this.adminDb, orderId).catch((readErr) => {
        console.error(`No se pudo leer el destinatario guardado del pedido ${orderId}:`, readErr);
        return null;
      });
      const notifyRecipient = storedChoice?.buyerEmail
        ? { email: storedChoice.buyerEmail, name: storedChoice.buyerName || "Cliente" }
        : undefined;

      const emailService = new EmailService(this.adminDb);
      await emailService.sendOrderConfirmation(orderId, invoiceId, notifyRecipient);
      // El aviso interno de pedido nuevo ya no sale acá: se manda cuando el
      // cliente sube el comprobante (ver notifyInternalOrderToConfirm).
    } catch (err) {
      console.error(`Error al enviar los emails del pedido ${orderId}:`, err);
    }
  }
}
