import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAYMENT_METHOD_LABELS, type PosPaymentMethod } from "@/modules/pos/schemas";
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
    const buyer = await this.resolveBuyerContact(invoice.order_id);
    const paymentMethod = await this.resolvePaymentMethod(invoice.order_id);

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
        // La hora no se guarda aparte: sale de created_at, que es el
        // momento en que se emitió, expresado en hora de Argentina.
        issueTime: formatArgentinaTime(invoice.created_at),
        cae: invoice.cae,
        caeDueDate: invoice.cae_due_date ?? "",
        customerName: invoice.customer_name,
        buyerDocumentLabel: buyerDocumentLabelFor(invoice.buyer_document_type),
        buyerDocumentNumber: invoice.buyer_document_number,
        buyerIvaCondition: invoice.buyer_iva_condition,
        buyerAddress: buyer.address,
        buyerCity: buyer.city,
        paymentMethod,
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

    const genericRow = (description: string): InvoicePdfItem => {
      const net = Number(invoice.subtotal);
      const gross = Number(invoice.total);
      const amount = showsNetPrices ? net : gross;
      return {
        code: "-",
        description,
        quantity: 1,
        unitPrice: amount,
        lineAmount: amount,
        vatRate: showsNetPrices ? deriveVatRate(net, Number(invoice.vat_amount)) : null,
        lineAmountWithVat: showsNetPrices ? gross : null,
      };
    };

    if (!invoice.order_id) {
      // Factura manual (fletes, servicios, anticipos): no hay items
      // asociados, va un renglón único con descripción genérica.
      return [genericRow("Venta de bienes y/o servicios según acuerdo con el cliente")];
    }

    const { data: items, error } = await this.adminDb
      .from("order_items")
      .select("product_id, product_name_snapshot, quantity, unit_price, vat_rate, subtotal")
      .eq("order_id", invoice.order_id);

    if (error) {
      throw new Error(`No se pudieron leer los items del pedido: ${error.message}`);
    }

    const rows = (items ?? []) as OrderItemRecord[];

    if (rows.length === 0) {
      // Un pedido sin items no debería existir, pero si pasa es mejor un
      // comprobante con un renglón genérico que un PDF vacío.
      return [genericRow("Venta de bienes según pedido")];
    }

    // El código de producto que va impreso es el SKU. No viene en
    // order_items (que guarda el nombre congelado, no el código), así
    // que se resuelve contra products; si un producto ya no estuviera,
    // el renglón se imprime con "-" en vez de fallar.
    const productIds = [...new Set(rows.map((r) => r.product_id).filter(Boolean))];
    const { data: products } = productIds.length
      ? await this.adminDb.from("products").select("id, sku").in("id", productIds)
      : { data: [] as { id: string; sku: string }[] };
    const skuById = new Map(
      ((products ?? []) as { id: string; sku: string }[]).map((p) => [p.id, p.sku])
    );

    return rows.map((item) => {
      const quantity = Number(item.quantity);
      const code = skuById.get(item.product_id) ?? "-";
      const vatRate = Number(item.vat_rate);
      const grossUnit = Number(item.unit_price);
      const lineNet = Number(item.subtotal);
      const lineGross = round2(grossUnit * quantity);

      if (showsNetPrices) {
        return {
          code,
          description: item.product_name_snapshot,
          quantity,
          // El unitario neto se deriva del neto del renglón, que es el
          // importe que tiene que cerrar contra el total de la factura.
          unitPrice: quantity > 0 ? round2(lineNet / quantity) : lineNet,
          lineAmount: lineNet,
          vatRate,
          lineAmountWithVat: lineGross,
        };
      }

      return {
        code,
        description: item.product_name_snapshot,
        quantity,
        unitPrice: grossUnit,
        lineAmount: lineGross,
        vatRate: null,
        lineAmountWithVat: null,
      };
    });
  }

  /**
   * Domicilio y localidad del receptor para la cabecera. Salen del
   * perfil del cliente; una venta a alguien sin cuenta (mostrador,
   * consumidor final) no los tiene y se imprimen como "NR".
   */
  private async resolveBuyerContact(
    orderId: string | null
  ): Promise<{ address: string | null; city: string | null }> {
    if (!orderId) return { address: null, city: null };

    const { data: order } = await this.adminDb
      .from("orders")
      .select("customer_id")
      .eq("id", orderId)
      .maybeSingle();
    if (!order?.customer_id) return { address: null, city: null };

    const { data: customer } = await this.adminDb
      .from("customer_profiles")
      .select("address_street, address_city")
      .eq("id", order.customer_id)
      .maybeSingle();

    return {
      address: customer?.address_street ?? null,
      city: customer?.address_city ?? null,
    };
  }

  /**
   * "Forma de Pago" del comprobante, deducida del pago registrado: una
   * venta web se cobra por transferencia y una de mostrador con el
   * medio que eligió el empleado. Una factura manual no tiene pago
   * asociado y se informa como contado.
   */
  private async resolvePaymentMethod(orderId: string | null): Promise<string> {
    if (!orderId) return "Contado";

    const { data: payment } = await this.adminDb
      .from("payments")
      .select("provider, payment_method_id")
      .eq("order_id", orderId)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!payment) return "Contado";
    if (payment.provider === "transferencia") return "Transferencia bancaria";
    if (payment.provider === "pos") {
      return (
        PAYMENT_METHOD_LABELS[payment.payment_method_id as PosPaymentMethod] ?? "Contado"
      );
    }
    return "Contado";
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

/**
 * Rótulo del documento del receptor, como en el comprobante impreso:
 * "CUIT" cuando está identificado con CUIT, "Nro. Doc." para un DNI.
 */
function buyerDocumentLabelFor(documentType: string | null): string {
  if (documentType === "CUIT") return "CUIT";
  if (documentType === "DNI") return "Nro. Doc.";
  return "CF";
}

/** Alícuota efectiva de una factura manual, derivada de sus importes. */
function deriveVatRate(netAmount: number, vatAmount: number): number | null {
  if (!netAmount) return null;
  return round2((vatAmount / netAmount) * 100);
}

/**
 * Hora de emisión en hora de Argentina, no UTC: es la que se imprime
 * junto a la fecha, y cerca de medianoche las dos difieren.
 */
function formatArgentinaTime(timestamp: string): string | null {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
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
  product_id: string;
  product_name_snapshot: string;
  quantity: number;
  unit_price: number;
  vat_rate: number;
  subtotal: number;
}
