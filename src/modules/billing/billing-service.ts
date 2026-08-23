import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { ArcaAdapter, type IvaCondition } from "./arca-adapter";
import { buildArcaQrUrl } from "./qr";

export type { IvaCondition };

const INVOICE_TYPE_TO_CODE: Record<string, number> = { A: 1, B: 6, C: 11 };

// A partir de este monto, ARCA exige identificar al comprador (CUIT,
// CUIL, CDI o DNI) incluso en Factura B — ya no alcanza con "Consumidor
// Final" anónimo. ARCA actualiza este valor de tanto en tanto, por eso
// es configurable en vez de estar fijo en el código.
const ANONYMOUS_INVOICE_THRESHOLD = Number(
  process.env.ARCA_ANONYMOUS_INVOICE_THRESHOLD || 10_000_000
);

// Si ARCA no responde en este tiempo (timeout o error de red), se corta
// la espera en vez de dejar la factura colgada en "processing" para
// siempre — ver withTimeout más abajo.
const ARCA_VOUCHER_TIMEOUT_MS = 20_000;

class ArcaTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArcaTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new ArcaTimeoutError(`${label} no respondió dentro de ${ms}ms`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
}

/**
 * Etiqueta legible que se guarda en invoices.buyer_iva_condition. Es un
 * campo DISTINTO de customer_name: uno identifica a la persona, el otro
 * su condición fiscal — nunca hay que mezclar los dos conceptos en la
 * misma columna.
 */
const IVA_CONDITION_LABELS: Record<IvaCondition, string> = {
  consumidor_final: "Consumidor Final",
  responsable_inscripto: "Responsable Inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
};

/**
 * Datos fiscales sueltos cargados en el momento de una venta (ej: venta
 * de mostrador a alguien sin cuenta que pide Factura A). Tienen
 * prioridad sobre cualquier perfil de customer_profiles y NUNCA crean
 * ni tocan un cliente — van derecho a la factura.
 */
export interface ManualBuyerOverride {
  buyerName: string;
  buyerCuitDni: string | null;
  buyerIvaCondition: IvaCondition;
}

interface IssueInvoiceParams {
  idempotencyKey: string;
  orderId: string | null;
  buyerName: string;
  buyerCuitDni: string | null;
  // Condición de IVA DECLARADA por el comprador — issueInvoice la
  // verifica contra el padrón de ARCA antes de decidir la letra final.
  buyerIvaCondition: IvaCondition;
  netAmount: number;
  vatAmount: number;
  vatRate: number;
  totalAmount: number;
  issuedBy: string | null;
}

/**
 * Casa Periotti es Responsable Inscripto: solo puede emitir Factura A a
 * quien también sea Responsable Inscripto (y tenga CUIT válido). A
 * cualquier otro comprador — Consumidor Final, Monotributista, Exento, o
 * sin CUIT identificado — le corresponde Factura B.
 */
function resolveInvoiceTypeLetter(
  buyerCuitDni: string | null,
  buyerIvaCondition: IvaCondition
): "A" | "B" {
  const hasValidCuit = (buyerCuitDni ?? "").replace(/\D/g, "").length === 11;
  return hasValidCuit && buyerIvaCondition === "responsable_inscripto" ? "A" : "B";
}

/**
 * Punto único de facturación del sistema. Lo usan dos caminos:
 *  1. billOrder(): automático, se dispara solo cuando un pedido web
 *     queda pagado (ver OrderFulfillmentService).
 *  2. billManual(): lo dispara un empleado con rol facturación/admin
 *     desde /admin/facturacion, para casos que no vienen de la web.
 *
 * Ambos terminan en el mismo lugar (issueInvoice), que es idempotente:
 * facturar dos veces el mismo pedido nunca genera un segundo comprobante.
 */
export class BillingService {
  private readonly arca: ArcaAdapter;

  constructor(private readonly adminDb: SupabaseClient) {
    this.arca = new ArcaAdapter();
  }

  async billOrder(orderId: string, manualBuyerOverride?: ManualBuyerOverride): Promise<string> {
    const idempotencyKey = `order-${orderId}`;

    const existing = await this.findByIdempotencyKey(idempotencyKey);
    if (existing?.status === "authorized") return existing.id;

    const { data: order, error: orderError } = await this.adminDb
      .from("orders")
      .select("id, order_number, subtotal, vat_amount, total, customer_id")
      .eq("id", orderId)
      .single();
    if (orderError || !order) {
      throw new Error(`No se encontró el pedido ${orderId} para facturar`);
    }

    let buyerName: string;
    let buyerCuitDni: string | null = null;
    let buyerIvaCondition: IvaCondition = "consumidor_final";

    if (manualBuyerOverride) {
      // Venta de mostrador a alguien sin cuenta con datos fiscales
      // cargados a mano: no hay perfil que consultar.
      buyerName = manualBuyerOverride.buyerName;
      buyerCuitDni = manualBuyerOverride.buyerCuitDni;
      buyerIvaCondition = manualBuyerOverride.buyerIvaCondition;
    } else if (order.customer_id) {
      // El pedido está atado a un cliente: el nombre SIEMPRE tiene que
      // salir de su perfil. Si la consulta falla o el perfil no existe,
      // es una inconsistencia de datos real — se corta acá en vez de
      // facturar en silencio a nombre de "Consumidor Final".
      const { data: customer, error: customerError } = await this.adminDb
        .from("customer_profiles")
        .select("full_name, cuit_dni, iva_condition")
        .eq("id", order.customer_id)
        .maybeSingle();

      if (customerError) {
        throw new Error(
          `No se pudo leer el perfil del cliente ${order.customer_id} para facturar el pedido ${orderId}: ${customerError.message}`
        );
      }
      if (!customer) {
        console.warn(
          `[BillingService] El pedido ${orderId} tiene customer_id ${order.customer_id} pero no se encontró su perfil en customer_profiles — revisar si falló el alta del cliente.`
        );
        throw new Error(
          `El pedido ${orderId} tiene customer_id ${order.customer_id} pero no existe ese perfil en customer_profiles`
        );
      }

      buyerName = customer.full_name;
      buyerCuitDni = customer.cuit_dni;
      buyerIvaCondition = (customer.iva_condition as IvaCondition) ?? "consumidor_final";
    } else {
      // Solo acá corresponde "Consumidor Final": no hay ningún cliente
      // asociado al pedido (compra realmente anónima).
      buyerName = "Consumidor Final";
    }

    // Se asume una única alícuota de IVA por pedido (la del primer
    // item). Casa Periotti vende mayormente a 21%. Si en el futuro se
    // cargan productos con IVA distinto en un mismo pedido, este punto
    // hay que ampliarlo para mandar varios bloques de IVA a ARCA
    // (el web service lo soporta, ver campo "Iva" como arreglo).
    const { data: items } = await this.adminDb
      .from("order_items")
      .select("vat_rate")
      .eq("order_id", orderId)
      .limit(1);
    const vatRate = items && items.length > 0 ? Number(items[0].vat_rate) : 21;

    return this.issueInvoice({
      idempotencyKey,
      orderId,
      buyerName,
      buyerCuitDni,
      buyerIvaCondition,
      netAmount: Number(order.subtotal),
      vatAmount: Number(order.vat_amount),
      vatRate,
      totalAmount: Number(order.total),
      issuedBy: null,
    });
  }

  async billManual(params: {
    buyerName: string;
    buyerCuitDni: string | null;
    buyerIvaCondition: IvaCondition;
    netAmount: number;
    vatAmount: number;
    vatRate: number;
    totalAmount: number;
    employeeId: string;
  }): Promise<string> {
    return this.issueInvoice({
      idempotencyKey: `manual-${randomUUID()}`,
      orderId: null,
      buyerName: params.buyerName,
      buyerCuitDni: params.buyerCuitDni,
      buyerIvaCondition: params.buyerIvaCondition,
      netAmount: params.netAmount,
      vatAmount: params.vatAmount,
      vatRate: params.vatRate,
      totalAmount: params.totalAmount,
      issuedBy: params.employeeId,
    });
  }

  private async findByIdempotencyKey(key: string) {
    const { data } = await this.adminDb
      .from("invoices")
      .select("id, status")
      .eq("idempotency_key", key)
      .maybeSingle();
    return data;
  }

  private async issueInvoice(params: IssueInvoiceParams): Promise<string> {
    const environment = process.env.ARCA_ENVIRONMENT === "production" ? "production" : "testing";
    const salesPoint = Number(process.env.ARCA_SALES_POINT || 1);

    const { docType, docNumber } = resolveBuyerDocument(params.buyerCuitDni);

    // Verificación contra el padrón de ARCA: solo tiene sentido cuando
    // alguien declaró ser Responsable Inscripto con un CUIT (es el único
    // caso que decide si corresponde Factura A). Puede corregir la
    // condición declarada, o quedar sin verificar si el padrón no
    // responde — nunca bloquea la venta por esto.
    const {
      ivaCondition: buyerIvaCondition,
      verified: padronVerified,
      note: padronNote,
    } = await this.resolveVerifiedIvaCondition(params.buyerCuitDni, params.buyerIvaCondition);

    const invoiceTypeLetter = resolveInvoiceTypeLetter(params.buyerCuitDni, buyerIvaCondition);
    const voucherTypeCode = INVOICE_TYPE_TO_CODE[invoiceTypeLetter];

    // Umbral de ARCA: por encima de este monto, ni siquiera una Factura B
    // puede emitirse a Consumidor Final sin identificar.
    if (params.totalAmount >= ANONYMOUS_INVOICE_THRESHOLD && docType === 99) {
      throw new Error(
        `No se puede facturar $${params.totalAmount.toLocaleString("es-AR")} sin identificar al comprador — ARCA exige CUIT, CUIL, CDI o DNI a partir de $${ANONYMOUS_INVOICE_THRESHOLD.toLocaleString("es-AR")}.`
      );
    }

    // Se guarda la fila ANTES de llamar a ARCA. Si el proceso se corta
    // a mitad de camino, queda evidencia de que se intentó facturar, y
    // la próxima vez que se llame con la misma idempotencyKey no se
    // genera un comprobante duplicado (columna UNIQUE en la base).
    const { data: inserted, error: insertError } = await this.adminDb
      .from("invoices")
      .insert({
        order_id: params.orderId,
        idempotency_key: params.idempotencyKey,
        invoice_type: invoiceTypeLetter,
        sales_point: salesPoint,
        environment,
        customer_name: params.buyerName,
        buyer_iva_condition: IVA_CONDITION_LABELS[buyerIvaCondition],
        customer_document: params.buyerCuitDni,
        buyer_document_type: docType === 80 ? "CUIT" : docType === 96 ? "DNI" : "CF",
        buyer_document_number: String(docNumber),
        subtotal: params.netAmount,
        vat_amount: params.vatAmount,
        iva_contenido: params.vatAmount,
        total: params.totalAmount,
        concept: 1,
        status: "processing",
        issued_by: params.issuedBy,
        padron_verified: padronVerified,
        padron_note: padronNote,
      })
      .select("id")
      .single();

    let invoiceId: string;

    if (insertError) {
      if (insertError.code !== "23505") {
        throw new Error(`No se pudo iniciar la facturación: ${insertError.message}`);
      }

      // Ya existe una fila con esta idempotencyKey (mismo pedido o
      // misma factura manual). Si ya está autorizada, es la
      // idempotencia real: se devuelve tal cual, sin tocar nada. Si
      // no, es un intento anterior que no llegó a autorizarse (el
      // proceso se cortó a mitad de camino, o ARCA tardó demasiado) —
      // se reintenta ARCA sobre esa MISMA fila en vez de dejarla
      // trabada para siempre. Esto es lo que hace útil al cron de
      // recuperación de facturación.
      const existing = await this.findByIdempotencyKey(params.idempotencyKey);
      if (!existing) {
        throw new Error(`No se pudo iniciar la facturación: ${insertError.message}`);
      }
      if (existing.status === "authorized") return existing.id;
      invoiceId = existing.id;
    } else {
      invoiceId = inserted.id;
    }

    try {
      const result = await withTimeout(
        this.arca.createVoucher({
          salesPoint,
          voucherTypeCode,
          concept: 1,
          docType,
          docNumber,
          buyerIvaCondition,
          netAmount: params.netAmount,
          vatAmount: params.vatAmount,
          vatRate: params.vatRate,
          totalAmount: params.totalAmount,
        }),
        ARCA_VOUCHER_TIMEOUT_MS,
        "ARCA createVoucher"
      );

      const qrUrl = buildArcaQrUrl({
        cuit: this.arca.cuit,
        salesPoint,
        voucherTypeCode,
        voucherNumber: result.voucherNumber,
        totalAmount: params.totalAmount,
        // Misma fecha que se le mandó a ARCA (CbteFch), no la fecha en
        // que se generó el QR — si no coinciden, el QR queda inválido.
        issueDate: result.issueDate,
        docType,
        docNumber,
        cae: result.cae,
      });

      await this.adminDb
        .from("invoices")
        .update({
          voucher_number: result.voucherNumber,
          cae: result.cae,
          cae_due_date: result.caeExpirationDate,
          qr_data_url: qrUrl,
          issue_date: result.issueDate,
          status: "authorized",
          arca_response: { cae: result.cae, observations: result.observations },
        })
        .eq("id", invoiceId);

      return invoiceId;
    } catch (err) {
      const isTimeout = err instanceof ArcaTimeoutError;

      console.error(
        `[BillingService] ARCA ${
          isTimeout ? "no respondió a tiempo" : "devolvió un error"
        } al facturar invoice ${invoiceId} (pedido ${params.orderId ?? "manual"}):`,
        err
      );

      // Un timeout no significa que ARCA rechazó el comprobante — puede
      // haberlo autorizado igual del otro lado. Se marca retry_pending
      // (no rejected) para que quede claro que hay que revisarlo a mano
      // antes de reintentar, en vez de darlo por perdido.
      await this.adminDb
        .from("invoices")
        .update({
          status: isTimeout ? "retry_pending" : "rejected",
          rejection_reason: isTimeout
            ? `ARCA no respondió dentro de ${ARCA_VOUCHER_TIMEOUT_MS / 1000}s. Verificar manualmente si el comprobante se autorizó del lado de ARCA antes de reintentar.`
            : err instanceof Error
            ? err.message
            : String(err),
        })
        .eq("id", invoiceId);
      throw err;
    }
  }

  /**
   * Solo consulta el padrón cuando alguien declaró ser Responsable
   * Inscripto con un CUIT válido — es el único caso que decide si
   * corresponde Factura A. Nunca bloquea la venta: si el padrón no
   * responde, se sigue con lo declarado y queda marcado como no
   * verificado; si contradice lo declarado, se emite según el padrón.
   */
  private async resolveVerifiedIvaCondition(
    buyerCuitDni: string | null,
    declaredCondition: IvaCondition
  ): Promise<{ ivaCondition: IvaCondition; verified: boolean; note: string | null }> {
    const cuitDigits = (buyerCuitDni ?? "").replace(/\D/g, "");
    const hasValidCuit = cuitDigits.length === 11;

    if (!hasValidCuit || declaredCondition !== "responsable_inscripto") {
      return { ivaCondition: declaredCondition, verified: false, note: null };
    }

    const padron = await this.arca.checkTaxpayerCondition(Number(cuitDigits));

    if (!padron) {
      return {
        ivaCondition: declaredCondition,
        verified: false,
        note: "ARCA no respondió al consultar el padrón — se facturó según los datos declarados por el comprador, sin verificar.",
      };
    }

    if (!padron.found) {
      return {
        ivaCondition: "consumidor_final",
        verified: true,
        note: `El CUIT ${buyerCuitDni} no figura en el padrón de ARCA — se había declarado Responsable Inscripto, pero se facturó como Consumidor Final.`,
      };
    }

    if (padron.ivaCondition === null) {
      return {
        ivaCondition: declaredCondition,
        verified: false,
        note: "El padrón de ARCA respondió pero no se pudo determinar la condición de IVA a partir de su respuesta — se facturó según los datos declarados, sin verificar.",
      };
    }

    if (padron.ivaCondition !== declaredCondition) {
      return {
        ivaCondition: padron.ivaCondition,
        verified: true,
        note: `El padrón de ARCA indica que este CUIT es "${IVA_CONDITION_LABELS[padron.ivaCondition]}", no "${IVA_CONDITION_LABELS[declaredCondition]}" como se había declarado — se facturó según el padrón.`,
      };
    }

    return { ivaCondition: declaredCondition, verified: true, note: null };
  }
}

function resolveBuyerDocument(cuitDni: string | null): { docType: number; docNumber: number } {
  if (!cuitDni) return { docType: 99, docNumber: 0 }; // Consumidor Final sin identificar
  const digits = cuitDni.replace(/\D/g, "");
  if (digits.length === 11) return { docType: 80, docNumber: Number(digits) }; // CUIT
  if (digits.length >= 7) return { docType: 96, docNumber: Number(digits) }; // DNI
  return { docType: 99, docNumber: 0 };
}
