import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const INTERNAL_EMAIL = process.env.EMAIL_INTERNAL_TO || "consultas@casaperiotti.com.ar";
const FROM_EMAIL = process.env.EMAIL_FROM || "Casa Periotti <ventas@casaperiotti.com.ar>";

/**
 * Todo lo que manda mail pasa por acá. Si Resend no está configurado
 * (no hay API key todavía) o falla el envío, el error se registra en
 * `email_events` pero NUNCA se propaga hacia arriba — una venta ya
 * confirmada no se puede revertir solo porque el mail no salió.
 */
export class EmailService {
  private readonly resend: Resend | null;

  constructor(private readonly adminDb: SupabaseClient) {
    const apiKey = process.env.RESEND_API_KEY;
    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async sendOrderConfirmation(orderId: string, invoiceId: string | null) {
    const { data: order } = await this.adminDb
      .from("orders")
      .select("order_number, total, customer_id")
      .eq("id", orderId)
      .maybeSingle();
    if (!order?.customer_id) return;

    const { data: customer } = await this.adminDb
      .from("customer_profiles")
      .select("email, full_name")
      .eq("id", order.customer_id)
      .maybeSingle();
    if (!customer) return;

    let invoiceLine = "Tu factura se está procesando y te la enviamos apenas esté lista.";
    if (invoiceId) {
      const { data: invoice } = await this.adminDb
        .from("invoices")
        .select("status, voucher_number, sales_point, cae")
        .eq("id", invoiceId)
        .maybeSingle();
      if (invoice?.status === "authorized") {
        invoiceLine = `Factura ${String(invoice.sales_point).padStart(4, "0")}-${String(
          invoice.voucher_number
        ).padStart(8, "0")} — CAE ${invoice.cae}`;
      }
    }

    await this.send({
      to: customer.email,
      template: "order_confirmation",
      referenceType: "order",
      referenceId: orderId,
      subject: `Casa Periotti — Confirmamos tu pedido #${order.order_number}`,
      html: `
        <p>Hola ${customer.full_name},</p>
        <p>Confirmamos tu pedido <strong>#${order.order_number}</strong> por un total de
        $ ${Number(order.total).toLocaleString("es-AR")}.</p>
        <p>${invoiceLine}</p>
        <p>Gracias por comprar en Casa Periotti — Sunchales, Santa Fe.</p>
      `,
    });
  }

  async notifyInternalNewOrder(orderId: string) {
    const { data: order } = await this.adminDb
      .from("orders")
      .select("order_number, total, fulfillment_method")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return;

    await this.send({
      to: INTERNAL_EMAIL,
      template: "internal_new_order",
      referenceType: "order",
      referenceId: orderId,
      subject: `Nuevo pedido pago #${order.order_number} — $ ${Number(order.total).toLocaleString("es-AR")}`,
      html: `
        <p>Nuevo pedido pagado: #${order.order_number}</p>
        <p>Total: $ ${Number(order.total).toLocaleString("es-AR")}</p>
        <p>Entrega: ${order.fulfillment_method === "pickup" ? "Retiro en local" : "Envío a domicilio"}</p>
        <p>Verlo en el panel: /admin/productos (pedidos próximamente)</p>
      `,
    });
  }

  async notifyInternalError(subject: string, message: string) {
    await this.send({
      to: INTERNAL_EMAIL,
      template: "internal_error",
      referenceType: null,
      referenceId: null,
      subject: `⚠️ ${subject}`,
      html: `<p>${message}</p>`,
    });
  }

  private async send(params: {
    to: string;
    template: string;
    referenceType: string | null;
    referenceId: string | null;
    subject: string;
    html: string;
  }) {
    const { data: eventRow } = await this.adminDb
      .from("email_events")
      .insert({
        recipient: params.to,
        template: params.template,
        reference_type: params.referenceType,
        reference_id: params.referenceId,
        status: "pending",
      })
      .select("id")
      .single();

    if (!this.resend) {
      console.warn(
        `[EmailService] RESEND_API_KEY no configurada. Se registró el email "${params.template}" para ${params.to} sin enviarlo.`
      );
      if (eventRow) {
        await this.adminDb
          .from("email_events")
          .update({ status: "failed", error_message: "RESEND_API_KEY no configurada" })
          .eq("id", eventRow.id);
      }
      return;
    }

    try {
      await this.resend.emails.send({
        from: FROM_EMAIL,
        to: params.to,
        subject: params.subject,
        html: params.html,
      });
      if (eventRow) {
        await this.adminDb
          .from("email_events")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", eventRow.id);
      }
    } catch (err) {
      console.error(`[EmailService] Error al enviar "${params.template}" a ${params.to}:`, err);
      if (eventRow) {
        await this.adminDb
          .from("email_events")
          .update({
            status: "failed",
            error_message: err instanceof Error ? err.message : String(err),
          })
          .eq("id", eventRow.id);
      }
    }
  }
}
