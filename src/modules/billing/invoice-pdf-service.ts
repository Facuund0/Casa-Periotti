import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BusinessSettingsService } from "./business-settings-service";
import { buildInvoicePdf, type InvoicePdfItem } from "./invoice-pdf";
import { INVOICE_PDF_BUCKET, invoicePdfFilename, invoiceVoucherTypeCode } from "./invoice-types";
import { buildArcaQrUrl } from "./qr";

export class InvoiceNotFoundError extends Error {
  constructor(invoiceId: string) {
    super(`No existe la factura ${invoiceId}`);
    this.name = "InvoiceNotFoundError";
  }
}

export class InvoiceNotAuthorizedError extends Error {
  constructor(status: string) {
    super(
      `Esta factura todavía no está autorizada por ARCA (estado: ${status}), así que no se puede imprimir. Un comprobante sin CAE no tiene validez.`
    );
    this.name = "InvoiceNotAuthorizedError";
  }
}

export interface InvoicePdfFile {
  bytes: Uint8Array;
  filename: string;
  storagePath: string;
}

/**
 * Genera, guarda y entrega el PDF imprimible de una factura.
 *
 * El PDF se arma una sola vez y queda en el bucket privado 'facturas'
 * (invoices.pdf_path). Si todavía no existe —una factura vieja, o una
 * en la que falló la generación— se arma al pedirlo, así que no hay que
 * migrar nada hacia atrás.
 *
 * Solo se genera para facturas autorizadas: sin CAE el comprobante no
 * tiene validez y no hay nada válido que imprimir.
 */
export class InvoicePdfService {
  private readonly businessSettings: BusinessSettingsService;

  constructor(private readonly adminDb: SupabaseClient) {
    this.businessSettings = new BusinessSettingsService(adminDb);
  }

  /**
   * El PDF listo para descargar o adjuntar. Lo devuelve del bucket si ya
   * estaba, y si no lo genera y lo guarda.
   */
  async getOrCreate(invoiceId: string): Promise<InvoicePdfFile> {
    const invoice = await this.loadInvoice(invoiceId);
    const filename = invoicePdfFilename({
      invoiceType: invoice.invoice_type,
      salesPoint: invoice.sales_point,
      voucherNumber: invoice.voucher_number,
    });

    if (invoice.pdf_path) {
      const { data, error } = await this.adminDb.storage
        .from(INVOICE_PDF_BUCKET)
        .download(invoice.pdf_path);

      if (!error && data) {
        return {
          bytes: new Uint8Array(await data.arrayBuffer()),
          filename,
          storagePath: invoice.pdf_path,
        };
      }

      // La fila apunta a un archivo que no está (se borró del bucket, o
      // la subida quedó a medias). Se vuelve a generar en vez de fallar.
      console.warn(
        `[InvoicePdfService] La factura ${invoiceId} apunta a ${invoice.pdf_path} pero no se pudo descargar${
          error ? `: ${error.message}` : ""
        } — se regenera.`
      );
    }

    return this.generate(invoiceId);
  }

  /** Arma el PDF desde cero, lo sube al bucket y guarda la ruta. */
  async generate(invoiceId: string): Promise<InvoicePdfFile> {
    const invoice = await this.loadInvoice(invoiceId);

    if (invoice.status !== "authorized" || !invoice.cae) {
      throw new InvoiceNotAuthorizedError(invoice.status);
    }

    const issuer = await this.businessSettings.getComplete();
    const voucherTypeCode = invoiceVoucherTypeCode(invoice.invoice_type);
    const items = await this.resolveItems(invoice);

    // El QR se guardó al autorizar (invoices.qr_data_url). Se reusa ese
    // y no se rearma: tiene que ser exactamente el que se generó con la
    // fecha que se le mandó a ARCA, o queda inválido. Solo se arma acá
    // si la factura es anterior a que se guardara esa columna.
    const qrUrl =
      invoice.qr_data_url ??
      buildArcaQrUrl({
        cuit: Number(issuer.cuitDigits),
        salesPoint: invoice.sales_point!,
        voucherTypeCode,
        voucherNumber: invoice.voucher_number!,
        totalAmount: Number(invoice.total),
        issueDate: invoice.issue_date ?? invoice.created_at.slice(0, 10),
        docType: docTypeFor(invoice.buyer_document_type),
        docNumber: Number((invoice.buyer_document_number ?? "0").replace(/\D/g, "")) || 0,
        cae: invoice.cae,
      });

    const bytes = await buildInvoicePdf({
      issuer,
      invoice: {
        invoiceType: invoice.invoice_type ?? "B",
        voucherTypeCode,
        salesPoint: invoice.sales_point!,
        voucherNumber: invoice.voucher_number!,
        issueDate: invoice.issue_date ?? invoice.created_at.slice(0, 10),
        cae: invoice.cae,
        caeDueDate: invoice.cae_due_date ?? "",
        customerName: invoice.customer_name,
        buyerDocumentType: invoice.buyer_document_type,
        buyerDocumentNumber: invoice.buyer_document_number,
        buyerIvaCondition: invoice.buyer_iva_condition,
        subtotal: Number(invoice.subtotal),
        vatAmount: Number(invoice.vat_amount),
        total: Number(invoice.total),
        ivaContenido: invoice.iva_contenido != null ? Number(invoice.iva_contenido) : null,
        environment: invoice.environment,
        qrUrl,
      },
      items,
    });

    // La ruta incluye el año para que el bucket no termine con miles de
    // archivos sueltos en la raíz.
    const year = (invoice.issue_date ?? invoice.created_at).slice(0, 4);
    const storagePath = `${year}/${invoiceId}.pdf`;

    const { error: uploadError } = await this.adminDb.storage
      .from(INVOICE_PDF_BUCKET)
      .upload(storagePath, bytes, { contentType: "application/pdf", upsert: true });

    if (uploadError) {
      throw new Error(`No se pudo guardar el PDF de la factura: ${uploadError.message}`);
    }

    const { error: updateError } = await this.adminDb
      .from("invoices")
      .update({ pdf_path: storagePath })
      .eq("id", invoiceId);

    if (updateError) {
      // El PDF ya está en el bucket: no se pierde nada, solo que la
      // próxima vez se va a regenerar. No vale la pena fallar por esto.
      console.error(
        `[InvoicePdfService] El PDF de la factura ${invoiceId} se subió pero no se pudo guardar la ruta: ${updateError.message}`
      );
    }

    return { bytes, filename: invoicePdfFilename({
      invoiceType: invoice.invoice_type,
      salesPoint: invoice.sales_point,
      voucherNumber: invoice.voucher_number,
    }), storagePath };
  }

  /**
   * URL firmada de vida corta para descargar o imprimir desde el panel.
   * El bucket es privado: los comprobantes nunca se exponen con una URL
   * pública.
   */
  async getSignedUrl(invoiceId: string, expiresInSeconds = 300): Promise<string> {
    const file = await this.getOrCreate(invoiceId);

    const { data, error } = await this.adminDb.storage
      .from(INVOICE_PDF_BUCKET)
      .createSignedUrl(file.storagePath, expiresInSeconds, { download: file.filename });

    if (error || !data?.signedUrl) {
      throw new Error(
        `No se pudo generar el link del comprobante${error ? `: ${error.message}` : ""}`
      );
    }
    return data.signedUrl;
  }

  /**
   * Renglones del detalle. No se le manda a ARCA (el web service solo
   * recibe importes), pero el impreso tiene que mostrarlo.
   *
   * La convención de importes cambia según la letra, y es la parte más
   * delicada de todo el comprobante:
   *
   *  - Factura A (a Responsable Inscripto): los precios se muestran
   *    NETOS y el IVA se discrimina aparte. El neto del renglón es el
   *    que ya guardó create_order en order_items.subtotal, así que la
   *    suma de los renglones cierra exacta contra invoices.subtotal.
   *
   *  - Factura B (a Consumidor Final y demás): los precios se muestran
   *    CON IVA incluido, tal como los vio el cliente en la web
   *    (order_items.unit_price ya viene así). La suma de los renglones
   *    cierra exacta contra invoices.total, y el IVA se informa como
   *    "IVA Contenido" del régimen de transparencia fiscal.
   */
  private async resolveItems(invoice: InvoiceRecord): Promise<InvoicePdfItem[]> {
    const showsNetPrices = invoice.invoice_type === "A";

    if (!invoice.order_id) {
      // Factura manual (fletes, servicios, anticipos): no hay items
      // asociados, va un renglón único con descripción genérica.
      const amount = showsNetPrices ? Number(invoice.subtotal) : Number(invoice.total);
      return [
        {
          description: "Venta de bienes y/o servicios según acuerdo con el cliente",
          quantity: 1,
          unitPrice: amount,
          lineAmount: amount,
        },
      ];
    }

    const { data: items, error } = await this.adminDb
      .from("order_items")
      .select("product_name_snapshot, quantity, unit_price, subtotal")
      .eq("order_id", invoice.order_id);

    if (error) {
      throw new Error(`No se pudieron leer los items del pedido: ${error.message}`);
    }

    const rows = (items ?? []) as OrderItemRecord[];

    if (rows.length === 0) {
      // Un pedido sin items no debería existir, pero si pasa es mejor un
      // comprobante con un renglón genérico que un PDF vacío.
      const amount = showsNetPrices ? Number(invoice.subtotal) : Number(invoice.total);
      return [
        {
          description: "Venta de bienes según pedido",
          quantity: 1,
          unitPrice: amount,
          lineAmount: amount,
        },
      ];
    }

    return rows.map((item) => {
      const quantity = Number(item.quantity);

      if (showsNetPrices) {
        const lineAmount = Number(item.subtotal);
        return {
          description: item.product_name_snapshot,
          quantity,
          // El unitario neto se deriva del neto del renglón, que es el
          // importe que tiene que cerrar contra el total de la factura.
          unitPrice: quantity > 0 ? round2(lineAmount / quantity) : lineAmount,
          lineAmount,
        };
      }

      const unitPrice = Number(item.unit_price);
      return {
        description: item.product_name_snapshot,
        quantity,
        unitPrice,
        lineAmount: round2(unitPrice * quantity),
      };
    });
  }

  private async loadInvoice(invoiceId: string): Promise<InvoiceRecord> {
    const { data, error } = await this.adminDb
      .from("invoices")
      .select(
        "id, order_id, invoice_type, sales_point, voucher_number, cae, cae_due_date, status, subtotal, vat_amount, iva_contenido, total, customer_name, buyer_document_type, buyer_document_number, buyer_iva_condition, environment, issue_date, qr_data_url, created_at, pdf_path"
      )
      .eq("id", invoiceId)
      .maybeSingle();

    if (error) throw new Error(`Error al buscar la factura: ${error.message}`);
    if (!data) throw new InvoiceNotFoundError(invoiceId);
    return data as InvoiceRecord;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Mismo criterio que resolveBuyerDocument en billing-service. */
function docTypeFor(documentType: string | null): number {
  if (documentType === "CUIT") return 80;
  if (documentType === "DNI") return 96;
  return 99;
}

interface InvoiceRecord {
  id: string;
  order_id: string | null;
  invoice_type: string | null;
  sales_point: number | null;
  voucher_number: number | null;
  cae: string | null;
  cae_due_date: string | null;
  status: string;
  subtotal: number;
  vat_amount: number;
  iva_contenido: number | null;
  total: number;
  customer_name: string;
  buyer_document_type: string | null;
  buyer_document_number: string | null;
  buyer_iva_condition: string | null;
  environment: string;
  issue_date: string | null;
  qr_data_url: string | null;
  created_at: string;
  pdf_path: string | null;
}

interface OrderItemRecord {
  product_name_snapshot: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
}
