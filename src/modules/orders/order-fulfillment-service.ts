import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BillingService, type ManualBuyerOverride } from "@/modules/billing/billing-service";
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

  async fulfillPaidOrder(orderId: string, options?: { manualBuyerOverride?: ManualBuyerOverride }) {
    let invoiceId: string | null = null;

    // BillingService (y el ArcaAdapter que construye) tira una excepción
    // si falta configuración de ARCA. Se instancia recién acá, dentro de
    // su propio try/catch: para este punto el cobro ya se hizo y el
    // stock ya se descontó, así que un ARCA mal configurado no puede
    // tirar abajo la respuesta del pago.
    try {
      const billingService = new BillingService(this.adminDb);
      invoiceId = await billingService.billOrder(orderId, options?.manualBuyerOverride);
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
      const emailService = new EmailService(this.adminDb);
      await emailService.sendOrderConfirmation(orderId, invoiceId);
      await emailService.notifyInternalNewOrder(orderId);
    } catch (err) {
      console.error(`Error al enviar los emails del pedido ${orderId}:`, err);
    }
  }
}
