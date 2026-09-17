import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { ArcaAdapter, type IvaCondition } from "./arca-adapter";
import {
  BusinessSettingsService,
  type CompleteBusinessSettings,
} from "./business-settings-service";
import { InvoicePdfService } from "./invoice-pdf-service";
import { INVOICE_TYPE_TO_CODE } from "./invoice-types";
import { buildArcaQrUrl } from "./qr";
import { getOrderFiscalChoice } from "@/modules/orders/order-fiscal-choice";
import { notifyInvoiceRejected } from "./rejected-invoice-notice";
import { fiscalIdDigits, isPlausibleDni, isValidCuit } from "@/shared/utils/cuit";
import {
  decideForFinalConsumer,
  decideForFiscalData,
  type InvoiceDecision,
} from "./invoice-decision";

export type { IvaCondition };

// Si ARCA no responde en este tiempo (timeout o error de red), se corta
// la espera en vez de dejar la factura colgada en "processing" para
// siempre — ver withTimeout más abajo.
const ARCA_VOUCHER_TIMEOUT_MS = 20_000;

// Código de ARCA para "el número/fecha del comprobante no coincide con
// el próximo a autorizar" — típicamente una desincronización transitoria
// (dos emisiones concurrentes leyeron el mismo FECompUltimoAutorizado),
// no un rechazo fiscal real del comprobante. Ver el comentario de
// arca-adapter.ts y la migración 0011 para el detalle.
const ARCA_VOUCHER_NUMBER_MISMATCH_CODE = "10016";

// Cuánto puede llegar a durar UNA emisión completa en el peor caso:
// el intento original más el único reintento de createVoucherWithRetry()
// ante un 10016, cada uno con su propio timeout hacia ARCA
// (ARCA_VOUCHER_TIMEOUT_MS). Es el techo real de cuánto tiempo puede
// quedar tomado el lock de numeración durante una emisión legítima.
const ARCA_MAX_ATTEMPT_TIME_MS = ARCA_VOUCHER_TIMEOUT_MS * 2;

// Vencimiento del lease del lock de numeración (arca_voucher_locks,
// migración 0011). TIENE que ser mayor que ARCA_MAX_ATTEMPT_TIME_MS con
// margen real, no ajustado — si el lease venciera mientras una emisión
// legítima todavía está esperando la respuesta de ARCA (o haciendo el
// reintento del 10016), otra emisión podría robarle el lock a mitad de
// camino, que es exactamente la carrera que este lock existe para
// evitar. El margen de acá (15s) cubre los round-trips al RPC de
// Postgres y el procesamiento entre los dos intentos, que no están
// contados en ARCA_MAX_ATTEMPT_TIME_MS. Nunca hay que fijar este valor
// de forma independiente de ARCA_VOUCHER_TIMEOUT_MS — si ese timeout
// cambia, este tiene que escalar solo con él (por eso se calcula, no
// se hardcodea un número suelto).
const ARCA_LOCK_STALE_AFTER_SECONDS = Math.ceil(ARCA_MAX_ATTEMPT_TIME_MS / 1000) + 15;

// Cuánto espera un proceso a que se libere el lock de numeración de
// otra emisión en curso antes de rendirse. Tiene que ser AL MENOS tan
// largo como el lease (ARCA_LOCK_STALE_AFTER_SECONDS): si fuera más
// corto, alguien esperando podría rendirse un instante antes de que la
// emisión que tiene el lock lo libere de verdad, sin necesidad —
// tirando un error de "no se pudo tomar el lock" evitable.
const ARCA_LOCK_MAX_WAIT_MS = ARCA_LOCK_STALE_AFTER_SECONDS * 1000 + 5_000;
const ARCA_LOCK_POLL_INTERVAL_MS = 300;

class ArcaTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArcaTimeoutError";
  }
}

/**
 * true si el error que tiró el SDK de ARCA es específicamente el 10016
 * de numeración desincronizada. AfipWebServiceError expone `.code` con
 * el código real que devolvió ARCA (ver node_modules/@afipsdk/afip.js
 * /src/Class/ElectronicBilling.js, _checkErrors) — se compara como
 * string porque no está garantizado que XML→JS lo deje como number. El
 * fallback por regex sobre el mensaje cubre el caso de que algún día el
 * error llegue envuelto y pierda la propiedad `.code`.
 */
function isVoucherNumberMismatchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: unknown }).code;
  if (code != null && String(code) === ARCA_VOUCHER_NUMBER_MISMATCH_CODE) return true;
  return new RegExp(`\\(${ARCA_VOUCHER_NUMBER_MISMATCH_CODE}\\)`).test(err.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 * Qué comprobante pidió el comprador. La letra NO se pide: la decide
 * invoice-decision.ts (con datos fiscales, según el padrón de ARCA).
 */
export type BuyerInvoiceRequest =
  | { kind: "fiscal_data"; cuit: string; name: string | null }
  | { kind: "final_consumer"; dni: string | null; name: string | null };

interface IssueInvoiceParams {
  idempotencyKey: string;
  orderId: string | null;
  buyer: BuyerInvoiceRequest;
  netAmount: number;
  vatAmount: number;
  vatRate: number;
  totalAmount: number;
  issuedBy: string | null;
}

interface ResolvedBuyer {
  decision: InvoiceDecision;
  name: string;
  note: string | null;
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
  private readonly businessSettings: BusinessSettingsService;
  private arcaInstance: ArcaAdapter | null = null;

  constructor(private readonly adminDb: SupabaseClient) {
    this.businessSettings = new BusinessSettingsService(adminDb);
  }

  /**
   * El ArcaAdapter se construye recién cuando hay que emitir, porque
   * necesita el CUIT del emisor y ese dato ahora vive en la base
   * (business_settings), no en una variable de entorno. Se cachea por
   * instancia: una misma emisión no lo reconstruye.
   */
  private getArca(issuer: CompleteBusinessSettings): ArcaAdapter {
    if (!this.arcaInstance) {
      this.arcaInstance = new ArcaAdapter({ cuit: Number(issuer.cuitDigits) });
    }
    return this.arcaInstance;
  }

  async billOrder(orderId: string): Promise<string> {
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

    let buyer: BuyerInvoiceRequest;

    // Elección guardada junto a la venta (mostrador, migración 0018). Se
    // lee acá y no se recibe por parámetro: así el primer intento y
    // cualquier reintento del cron facturan lo mismo.
    const storedChoice = await getOrderFiscalChoice(this.adminDb, orderId);

    if (storedChoice) {
      // Vale lo que se eligió en la venta. Si hay cliente registrado y no
      // se cargó otro nombre, va el de su perfil.
      let name = storedChoice.buyerName?.trim() || null;
      if (!name && order.customer_id) {
        const { data: profile } = await this.adminDb
          .from("customer_profiles")
          .select("full_name")
          .eq("id", order.customer_id)
          .maybeSingle();
        name = profile?.full_name ?? null;
      }
      buyer =
        storedChoice.requestedKind === "fiscal_data" && storedChoice.cuit
          ? { kind: "fiscal_data", cuit: storedChoice.cuit, name }
          : { kind: "final_consumer", dni: storedChoice.dni, name };
    } else if (order.customer_id) {
      // El pedido está atado a un cliente: el nombre SIEMPRE tiene que
      // salir de su perfil. Si la consulta falla o el perfil no existe,
      // es una inconsistencia de datos real — se corta acá en vez de
      // facturar en silencio a nombre de "Consumidor Final".
      const { data: customer, error: customerError } = await this.adminDb
        .from("customer_profiles")
        .select("full_name, cuit_dni, dni, invoice_with_fiscal_data")
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

      // La elección se guarda en el perfil en el checkout, justo antes de
      // crear el pedido (ver saveInvoicePreferenceAction).
      buyer =
        customer.invoice_with_fiscal_data && fiscalIdDigits(customer.cuit_dni).length === 11
          ? { kind: "fiscal_data", cuit: customer.cuit_dni, name: customer.full_name }
          : { kind: "final_consumer", dni: customer.dni, name: customer.full_name };
    } else {
      // Compra realmente anónima: Consumidor Final sin identificar.
      buyer = { kind: "final_consumer", dni: null, name: null };
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
      buyer,
      netAmount: Number(order.subtotal),
      vatAmount: Number(order.vat_amount),
      vatRate,
      totalAmount: Number(order.total),
      issuedBy: null,
    });
  }

  async billManual(params: {
    buyerName: string | null;
    /** CUIT (factura con datos fiscales, decide el padrón) o DNI (Consumidor Final). */
    buyerCuitDni: string | null;
    netAmount: number;
    vatAmount: number;
    vatRate: number;
    totalAmount: number;
    employeeId: string;
  }): Promise<string> {
    const digits = fiscalIdDigits(params.buyerCuitDni);
    let buyer: BuyerInvoiceRequest;
    if (digits.length === 11) {
      buyer = { kind: "fiscal_data", cuit: digits, name: params.buyerName };
    } else if (!digits || isPlausibleDni(digits)) {
      buyer = { kind: "final_consumer", dni: digits || null, name: params.buyerName };
    } else {
      throw new Error("Ingresá un CUIT de 11 dígitos o un DNI de 7 u 8 dígitos.");
    }

    return this.issueInvoice({
      idempotencyKey: `manual-${randomUUID()}`,
      orderId: null,
      buyer,
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
    // Datos fiscales del emisor. Se leen ANTES de insertar la fila de
    // invoices: si falta alguno, corta con un mensaje que dice
    // exactamente qué cargar y no queda una factura a medio emitir.
    const issuer = await this.businessSettings.getComplete();
    const arca = this.getArca(issuer);

    const environment = process.env.ARCA_ENVIRONMENT === "production" ? "production" : "testing";
    // Punto de venta habilitado en ARCA, desde business_settings.
    const salesPoint = issuer.salesPoint;

    // Tabla de decisión (invoice-decision.ts): letra, condición del
    // receptor, documento y leyenda. Con datos fiscales, consulta el padrón.
    const { decision, name: buyerName, note: padronNote } = await this.resolveBuyer(
      arca,
      params.buyer,
      params.totalAmount,
      issuer.anonymousInvoiceThreshold
    );
    const invoiceTypeLetter = decision.letter;
    const voucherTypeCode = INVOICE_TYPE_TO_CODE[invoiceTypeLetter];
    const docType = decision.docType;
    const docNumber = Number(decision.docNumber);

    // Se guarda la fila ANTES de llamar a ARCA. Si el proceso se corta
    // a mitad de camino, queda evidencia de que se intentó facturar, y
    // la próxima vez que se llame con la misma idempotencyKey no se
    // genera un comprobante duplicado (columna UNIQUE en la base).
    // Datos descriptivos de la factura. Se usan para crearla y también para
    // refrescar un intento anterior que no llegó a autorizarse (ver abajo).
    const invoiceFields = {
      invoice_type: invoiceTypeLetter,
      sales_point: salesPoint,
      environment,
      customer_name: buyerName,
      buyer_iva_condition: decision.receptorConditionLabel,
      customer_document: docType === 99 ? null : decision.docNumber,
      buyer_document_type: docType === 80 ? "CUIT" : docType === 96 ? "DNI" : "CF",
      buyer_document_number: decision.docNumber,
      subtotal: params.netAmount,
      vat_amount: params.vatAmount,
      iva_contenido: params.vatAmount,
      total: params.totalAmount,
      concept: 1,
      padron_verified: decision.verification === "verified",
      padron_note: padronNote,
      receptor_iva_condition_id: decision.receptorConditionId,
      fiscal_verification: decision.verification,
    };

    const { data: inserted, error: insertError } = await this.adminDb
      .from("invoices")
      .insert({
        order_id: params.orderId,
        idempotency_key: params.idempotencyKey,
        ...invoiceFields,
        status: "processing",
        issued_by: params.issuedBy,
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

      // El intento anterior no se autorizó, así que esa fila todavía no es
      // un comprobante: se refrescan sus datos con los actuales antes de
      // volver a ARCA. Sin esto, si entre un intento y otro se corrigió el
      // CUIT o la condición de IVA del cliente, ARCA emitiría con los datos
      // nuevos (por ejemplo, una Factura B) mientras la fila y el PDF
      // seguirían diciendo lo viejo (Factura A).
      const { error: refreshError } = await this.adminDb
        .from("invoices")
        .update({ ...invoiceFields, status: "processing", rejection_reason: null })
        .eq("id", invoiceId)
        .neq("status", "authorized");
      if (refreshError) {
        throw new Error(
          `No se pudo actualizar el intento de facturación anterior: ${refreshError.message}`
        );
      }
    } else {
      invoiceId = inserted.id;
    }

    try {
      const result = await this.withArcaVoucherLock(salesPoint, voucherTypeCode, environment, () =>
        this.createVoucherWithRetry(
          arca,
          {
            salesPoint,
            voucherTypeCode,
            concept: 1,
            docType,
            docNumber,
            receptorConditionId: decision.receptorConditionId,
            netAmount: params.netAmount,
            vatAmount: params.vatAmount,
            vatRate: params.vatRate,
            totalAmount: params.totalAmount,
          },
          `invoice ${invoiceId}`
        )
      );

      const qrUrl = buildArcaQrUrl({
        cuit: arca.cuit,
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

      // El PDF imprimible se arma acá, ya con el CAE. Va en su propio
      // try/catch y no relanza nada: la factura YA está autorizada en
      // ARCA, así que un fallo al dibujar el PDF no puede tirar abajo la
      // emisión ni la venta. Si falla, queda sin pdf_path y se genera
      // solo la primera vez que alguien lo descarga o lo reenvía.
      try {
        await new InvoicePdfService(this.adminDb).generate(invoiceId);
      } catch (pdfError) {
        console.error(
          `[BillingService] La factura ${invoiceId} se autorizó pero no se pudo generar su PDF (se va a regenerar al pedirlo):`,
          pdfError
        );
      }

      return invoiceId;
    } catch (err) {
      const isTimeout = err instanceof ArcaTimeoutError;
      // Si llega hasta acá siendo un 10016, es porque ya se agotó el
      // reintento único de createVoucherWithRetry() — no es que no se
      // haya intentado resolver solo.
      const isVoucherMismatch = isVoucherNumberMismatchError(err);

      console.error(
        `[BillingService] ARCA ${
          isTimeout
            ? "no respondió a tiempo"
            : isVoucherMismatch
            ? "devolvió 10016 (numeración desincronizada) incluso después de reintentar"
            : "devolvió un error"
        } al facturar invoice ${invoiceId} (pedido ${params.orderId ?? "manual"}):`,
        err
      );

      // Ni un timeout ni un 10016 significan que ARCA rechazó el
      // comprobante de verdad — el primero puede haberlo autorizado
      // igual del otro lado, el segundo es una desincronización de
      // numeración transitoria, no un rechazo fiscal. Los dos quedan en
      // retry_pending (no rejected) para que se distingan de un rechazo
      // real y se puedan reintentar desde el panel sin confusión.
      const isRetryable = isTimeout || isVoucherMismatch;

      const failureStatus = isRetryable ? "retry_pending" : "rejected";
      await this.adminDb
        .from("invoices")
        .update({
          status: failureStatus,
          rejection_reason: isTimeout
            ? `ARCA no respondió dentro de ${ARCA_VOUCHER_TIMEOUT_MS / 1000}s. Verificar manualmente si el comprobante se autorizó del lado de ARCA antes de reintentar.`
            : isVoucherMismatch
            ? "ARCA rechazó el número de comprobante por desincronización (10016) incluso después de reintentar una vez con el número actualizado. No es un rechazo fiscal real — puede resolverse solo al reintentar de nuevo más tarde."
            : err instanceof Error
            ? err.message
            : String(err),
        })
        .eq("id", invoiceId);

      // Aviso a facturación: la venta está cobrada y sin comprobante
      // válido. Solo ante un rechazo real de ARCA (un timeout o una
      // desincronización de numeración se reintentan solos). No cambia
      // nada del manejo del error: ver rejected-invoice-notice.ts.
      if (failureStatus === "rejected") {
        notifyInvoiceRejected(this.adminDb, {
          orderId: params.orderId,
          reason: err instanceof Error ? err.message : String(err),
        });
      }

      throw err;
    }
  }

  /**
   * Reintento acotado (una sola vez) específico para el 10016 de ARCA
   * ("el número/fecha del comprobante no se corresponde con el próximo
   * a autorizar") — es una desincronización transitoria, no un rechazo
   * real, así que reintentar tiene sentido. Alcanza con volver a llamar
   * a arca.createVoucher(): internamente vuelve a consultar
   * FECompUltimoAutorizado desde cero en cada llamada (ver
   * arca-adapter.ts) — no hay nada que "refrescar" aparte.
   *
   * No reintenta ante ningún otro error (timeout, rechazo fiscal real,
   * etc.) — esos los maneja el caller.
   */
  private async createVoucherWithRetry(
    arca: ArcaAdapter,
    arcaInput: Parameters<ArcaAdapter["createVoucher"]>[0],
    context: string
  ) {
    try {
      return await withTimeout(arca.createVoucher(arcaInput), ARCA_VOUCHER_TIMEOUT_MS, "ARCA createVoucher");
    } catch (err) {
      if (!isVoucherNumberMismatchError(err)) throw err;
      console.warn(
        `[BillingService] ARCA devolvió 10016 (numeración desincronizada) para ${context} — reintentando una vez tras volver a consultar FECompUltimoAutorizado.`
      );
      return await withTimeout(
        arca.createVoucher(arcaInput),
        ARCA_VOUCHER_TIMEOUT_MS,
        "ARCA createVoucher (reintento 10016)"
      );
    }
  }

  /**
   * Serializa las emisiones de comprobantes que comparten
   * (salesPoint, voucherTypeCode, environment) — ArcaAdapter.createVoucher()
   * arma el número a mano (lastVoucher+1, ver ese archivo) y esa lectura
   * más el envío no son atómicos: dos emisiones concurrentes para la
   * misma numeración pueden leer el mismo último número y una de las
   * dos termina con 10016. Este lock (migración 0011,
   * arca_voucher_locks) evita que eso pase en la mayoría de los casos;
   * createVoucherWithRetry() cubre el resto (ej. un intento anterior
   * indeterminado que dejó la numeración real de ARCA adelantada).
   *
   * No se puede usar pg_advisory_lock acá — ver el comentario de la
   * migración 0011 sobre por qué (supabase-js no garantiza mantener la
   * misma conexión de Postgres durante toda la llamada a ARCA).
   */
  private async withArcaVoucherLock<T>(
    salesPoint: number,
    voucherTypeCode: number,
    environment: "testing" | "production",
    fn: () => Promise<T>
  ): Promise<T> {
    const lockToken = randomUUID();
    const deadline = Date.now() + ARCA_LOCK_MAX_WAIT_MS;
    let acquired = false;

    while (Date.now() < deadline) {
      const { data, error } = await this.adminDb.rpc("acquire_arca_voucher_lock", {
        p_sales_point: salesPoint,
        p_voucher_type_code: voucherTypeCode,
        p_environment: environment,
        p_lock_token: lockToken,
        // Explícito siempre — nunca depender del default de la función
        // en Postgres, que puede quedar desactualizado respecto al
        // timeout real si alguien cambia ARCA_VOUCHER_TIMEOUT_MS acá y
        // se olvida de tocar la migración.
        p_stale_after_seconds: ARCA_LOCK_STALE_AFTER_SECONDS,
      });
      if (error) {
        throw new Error(`No se pudo consultar el lock de numeración de ARCA: ${error.message}`);
      }
      if (data === true) {
        acquired = true;
        break;
      }
      await sleep(ARCA_LOCK_POLL_INTERVAL_MS);
    }

    if (!acquired) {
      throw new Error(
        `No se pudo tomar el lock de numeración de ARCA para PtoVta=${salesPoint} CbteTipo=${voucherTypeCode} (${environment}) tras ${ARCA_LOCK_MAX_WAIT_MS / 1000}s — hay otra emisión en curso que no lo libera.`
      );
    }

    try {
      return await fn();
    } finally {
      const { error } = await this.adminDb.rpc("release_arca_voucher_lock", {
        p_sales_point: salesPoint,
        p_voucher_type_code: voucherTypeCode,
        p_environment: environment,
        p_lock_token: lockToken,
      });
      if (error) {
        // No se relanza: la factura ya se resolvió (bien o mal) del
        // lado de ARCA en fn(). El lock igual se libera solo — vence
        // por stale-after en la próxima consulta (ver migración 0011).
        console.error(`[BillingService] No se pudo liberar el lock de numeración de ARCA:`, error);
      }
    }
  }

  /**
   * Aplica la tabla de decisión al comprador. Con datos fiscales, el
   * padrón decide la letra en esta misma emisión (aunque ya se haya
   * mostrado una vista previa antes de la venta: puede haber cambiado).
   *
   * La venta ya está cobrada cuando se llega acá, así que nunca se deja
   * sin factura por el CUIT: si el CUIT dejó de servir (inválido,
   * inexistente o cancelado), se emite B a Consumidor Final y queda
   * marcada como no verificada para revisarla.
   */
  private async resolveBuyer(
    arca: ArcaAdapter,
    buyer: BuyerInvoiceRequest,
    totalAmount: number,
    threshold: number
  ): Promise<ResolvedBuyer> {
    if (buyer.kind === "fiscal_data") {
      const digits = fiscalIdDigits(buyer.cuit);
      const padron = isValidCuit(digits) ? await arca.checkTaxpayerCondition(Number(digits)) : null;
      const outcome = decideForFiscalData(digits, padron);

      if (outcome.ok) {
        const decision = outcome.decision;
        if (decision.monotributoVariantUnverified) {
          console.warn(
            `[BillingService] Monotributo sin variante verificable: el padrón no distingue monotributo común, social o trabajador independiente promovido para el CUIT ${digits}. Se informa CondicionIVAReceptorId 6 — revisar.`
          );
        }
        return {
          decision,
          name: decision.legalName ?? buyer.name ?? "Consumidor Final",
          note: decision.verification === "unverified" ? decision.reason : null,
        };
      }

      const fallback = decideForFinalConsumer({ total: totalAmount, threshold, dni: null });
      if (!fallback.ok) {
        throw new Error(
          `No se puede facturar con el CUIT ${buyer.cuit}: ${outcome.error} Y por el monto tampoco se puede emitir a Consumidor Final sin identificar.`
        );
      }
      return {
        decision: { ...fallback.decision, verification: "unverified" },
        name: buyer.name ?? "Consumidor Final",
        note: `Se pidió factura con datos fiscales, pero el CUIT no se pudo usar: ${outcome.error} Se emitió Factura B a Consumidor Final.`,
      };
    }

    const outcome = decideForFinalConsumer({ total: totalAmount, threshold, dni: buyer.dni });
    if (!outcome.ok) throw new Error(outcome.error);
    return { decision: outcome.decision, name: buyer.name ?? "Consumidor Final", note: null };
  }
}
