import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { InvoicePdfService } from "@/modules/billing/invoice-pdf-service";

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

  /**
   * `recipientOverride` es para una venta de mostrador a alguien sin
   * cuenta: el pedido no tiene customer_id, así que el destinatario lo
   * aporta quien registró la venta. Se usa la MISMA plantilla que una
   * compra web, adjunto de la factura incluido.
   */
  async sendOrderConfirmation(
    orderId: string,
    invoiceId: string | null,
    recipientOverride?: { email: string; name: string }
  ) {
    const { data: order } = await this.adminDb
      .from("orders")
      .select("order_number, total, customer_id")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return;

    let customer: { email: string; full_name: string } | null = null;

    if (recipientOverride?.email) {
      customer = { email: recipientOverride.email, full_name: recipientOverride.name };
    } else if (order.customer_id) {
      const { data } = await this.adminDb
        .from("customer_profiles")
        .select("email, full_name")
        .eq("id", order.customer_id)
        .maybeSingle();
      customer = data;
    }

    // Sin destinatario no hay nada que mandar: es el caso de una venta
    // de mostrador a consumidor final que no dejó mail.
    if (!customer?.email) return;

    // Si la factura quedó autorizada, el PDF va adjunto. Si falló, o
    // todavía no se autorizó, el mail sale igual avisando que la
    // factura llega por separado: la venta ya está hecha y el cliente
    // tiene que recibir su confirmación de cualquier manera.
    let invoiceLine = "Tu factura se está procesando y te la enviamos apenas esté lista.";
    let attachments: EmailAttachment[] | undefined;

    if (invoiceId) {
      const { data: invoice } = await this.adminDb
        .from("invoices")
        .select("status, voucher_number, sales_point, cae")
        .eq("id", invoiceId)
        .maybeSingle();

      if (invoice?.status === "authorized") {
        const comprobante = `${String(invoice.sales_point).padStart(4, "0")}-${String(
          invoice.voucher_number
        ).padStart(8, "0")}`;

        const pdf = await this.tryLoadInvoicePdf(invoiceId);
        if (pdf) {
          attachments = [pdf];
          invoiceLine = `Adjuntamos tu factura <strong>${comprobante}</strong> (CAE ${invoice.cae}) en PDF.`;
        } else {
          invoiceLine = `Tu factura es la <strong>${comprobante}</strong> (CAE ${invoice.cae}). Te la enviamos por separado en un rato.`;
        }
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
      attachments,
    });
  }

  /**
   * Reenvía una factura ya autorizada. Lo usa el botón "Reenviar
   * factura" del panel, para cuando el cliente la pierde o dio mal el
   * mail (de ahí que se pueda mandar a otra dirección).
   *
   * A diferencia del mail de confirmación, acá el adjunto ES el motivo
   * del envío: si el PDF no se puede generar, se corta con el error en
   * vez de mandar un mail vacío.
   */
  async sendInvoiceCopy(params: { invoiceId: string; to?: string | null }): Promise<EmailSendResult> {
    const { data: invoice } = await this.adminDb
      .from("invoices")
      .select("id, order_id, status, sales_point, voucher_number, cae, total, customer_name")
      .eq("id", params.invoiceId)
      .maybeSingle();

    if (!invoice) throw new Error("No existe esa factura");
    if (invoice.status !== "authorized") {
      throw new Error(
        `Esta factura no está autorizada (estado: ${invoice.status}), así que no hay comprobante para enviar.`
      );
    }

    const recipient = params.to?.trim() || (await this.resolveInvoiceRecipient(invoice.order_id));
    if (!recipient) {
      throw new Error(
        "Esta factura no tiene un email asociado (venta de mostrador o cliente sin cuenta). Escribí a qué dirección enviarla."
      );
    }

    const file = await new InvoicePdfService(this.adminDb).getOrCreate(params.invoiceId);
    const comprobante = `${String(invoice.sales_point).padStart(4, "0")}-${String(
      invoice.voucher_number
    ).padStart(8, "0")}`;

    return this.send({
      to: recipient,
      template: "invoice_copy",
      referenceType: "invoice",
      referenceId: invoice.id,
      subject: `Casa Periotti — Factura ${comprobante}`,
      html: `
        <p>Hola,</p>
        <p>Adjuntamos la factura <strong>${comprobante}</strong> por un total de
        $ ${Number(invoice.total).toLocaleString("es-AR")} (CAE ${invoice.cae}).</p>
        <p>Casa Periotti — Sunchales, Santa Fe.</p>
      `,
      attachments: [{ filename: file.filename, content: Buffer.from(file.bytes) }],
    });
  }

  private async resolveInvoiceRecipient(orderId: string | null): Promise<string | null> {
    if (!orderId) return null;

    const { data: order } = await this.adminDb
      .from("orders")
      .select("customer_id")
      .eq("id", orderId)
      .maybeSingle();
    if (!order?.customer_id) return null;

    const { data: customer } = await this.adminDb
      .from("customer_profiles")
      .select("email")
      .eq("id", order.customer_id)
      .maybeSingle();

    return customer?.email ?? null;
  }

  /**
   * El PDF de la factura, o null si no se pudo obtener. Nunca tira: un
   * fallo al generar o leer el PDF no puede impedir que salga el mail de
   * confirmación de una venta que ya está cobrada.
   */
  private async tryLoadInvoicePdf(invoiceId: string): Promise<EmailAttachment | null> {
    try {
      const file = await new InvoicePdfService(this.adminDb).getOrCreate(invoiceId);
      return { filename: file.filename, content: Buffer.from(file.bytes) };
    } catch (err) {
      console.error(
        `[EmailService] No se pudo adjuntar el PDF de la factura ${invoiceId} — el mail se manda sin adjunto:`,
        err
      );
      return null;
    }
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

  /**
   * Devuelve si el envío salió o no (nunca tira). Los avisos internos y
   * de confirmación ignoran el resultado — una venta no se revierte
   * porque el mail no salió — pero el reenvío manual desde el panel lo
   * necesita para poder mostrarle el error al empleado.
   */
  private async send(params: {
    to: string;
    template: string;
    referenceType: string | null;
    referenceId: string | null;
    subject: string;
    html: string;
    attachments?: EmailAttachment[];
  }): Promise<EmailSendResult> {
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
      return { sent: false, error: "RESEND_API_KEY no configurada" };
    }

    try {
      await this.resend.emails.send({
        from: FROM_EMAIL,
        to: params.to,
        subject: params.subject,
        html: params.html,
        attachments: params.attachments,
      });
      if (eventRow) {
        await this.adminDb
          .from("email_events")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", eventRow.id);
      }
      return { sent: true };
    } catch (err) {
      console.error(`[EmailService] Error al enviar "${params.template}" a ${params.to}:`, err);
      const message = err instanceof Error ? err.message : String(err);
      if (eventRow) {
        await this.adminDb
          .from("email_events")
          .update({ status: "failed", error_message: message })
          .eq("id", eventRow.id);
      }
      return { sent: false, error: message };
    }
  }
}

/** Adjunto tal como lo espera Resend: el archivo en memoria. */
export interface EmailAttachment {
  filename: string;
  content: Buffer;
}

export interface EmailSendResult {
  sent: boolean;
  error?: string;
}
