import "server-only";
import Afip from "@afipsdk/afip.js";

export type IvaCondition =
  | "consumidor_final"
  | "responsable_inscripto"
  | "monotributista"
  | "exento";

/**
 * Códigos de "Condición frente al IVA" del receptor que exige ARCA desde
 * la RG 5616 (campo CondicionIVAReceptorId de FECAESolicitar), tal como
 * los publica el método FEParamGetCondicionIvaReceptor del WSFEv1. Si
 * ARCA cambia estos códigos, es acá donde hay que actualizarlos.
 */
const IVA_CONDITION_TO_ARCA_ID: Record<IvaCondition, number> = {
  responsable_inscripto: 1,
  exento: 4,
  consumidor_final: 5,
  monotributista: 6,
};

export interface ArcaVoucherInput {
  salesPoint: number;
  voucherTypeCode: number; // 1 = Factura A, 6 = Factura B, 11 = Factura C
  concept: 1 | 2 | 3; // 1 = productos (nuestro caso casi siempre)
  docType: number; // 80 = CUIT, 96 = DNI, 99 = Consumidor Final sin identificar
  docNumber: number;
  buyerIvaCondition: IvaCondition;
  netAmount: number;
  vatAmount: number;
  vatRate: number;
  totalAmount: number;
}

export interface ArcaObservation {
  code: string;
  message: string;
}

export interface ArcaVoucherResult {
  cae: string;
  caeExpirationDate: string; // yyyy-mm-dd
  voucherNumber: number;
  issueDate: string; // yyyy-mm-dd — la fecha (CbteFch) que efectivamente se mandó a ARCA
  observations: ArcaObservation[];
}

export interface PadronCheckResult {
  found: boolean;
  ivaCondition: IvaCondition | null;
}

const ARCA_PADRON_TIMEOUT_MS = 8_000;

// Códigos de alícuota de IVA que usa el web service de ARCA (WSFEv1).
const IVA_RATE_TO_ID: Record<number, number> = {
  0: 3,
  10.5: 4,
  21: 5,
  27: 6,
  5: 8,
  2.5: 9,
};

/**
 * Única pieza del sistema que sabe cómo hablar con ARCA. El resto del
 * código (BillingService, panel de empleados) nunca importa este
 * archivo directo — siempre pasa por BillingService. Así, si el día de
 * mañana cambia la librería o hay que hablar directo con los Web
 * Services SOAP, solo se toca este archivo.
 *
 * Usa el SDK de Afip SDK (@afipsdk/afip.js), que evita tener que lidiar
 * con SOAP y con el mecanismo de autenticación WSAA a mano.
 */
export class ArcaAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly afip: any;
  readonly environment: "testing" | "production";
  readonly cuit: number;

  constructor() {
    this.environment = process.env.ARCA_ENVIRONMENT === "production" ? "production" : "testing";

    if (this.environment === "testing") {
      // CUIT de pruebas público que ofrece Afip SDK: permite desarrollar
      // y probar el flujo completo (incluido el rechazo de comprobantes)
      // sin necesitar todavía el certificado real de Casa Periotti.
      this.cuit = 20409378472;
    } else {
      const cuit = process.env.ARCA_CUIT;
      if (!cuit) {
        throw new Error(
          "Falta ARCA_CUIT en .env.local para facturar en producción (REQUIERE INFORMACIÓN DEL NEGOCIO)"
        );
      }
      this.cuit = Number(cuit);
    }

    const accessToken = process.env.AFIPSDK_ACCESS_TOKEN;
    if (!accessToken) {
      throw new Error(
        "Falta AFIPSDK_ACCESS_TOKEN en .env.local. Se obtiene gratis registrándose en https://app.afipsdk.com"
      );
    }

    this.afip = new Afip({ CUIT: this.cuit, access_token: accessToken });
  }

  async createVoucher(input: ArcaVoucherInput): Promise<ArcaVoucherResult> {
    const netAmount = round2(input.netAmount);
    const vatAmount = round2(input.vatAmount);
    const totalAmount = round2(input.totalAmount);

    // ARCA exige ImpTotal = ImpNeto + ImpIVA + ImpTotConc + ImpOpEx + ImpTrib.
    // Los últimos tres son siempre 0 en nuestro caso, así que alcanza con
    // validar que neto + iva cierre exacto contra el total ANTES de
    // llamar a ARCA — así el error queda claro acá y no como un rechazo
    // genérico del web service.
    const expectedTotal = round2(netAmount + vatAmount);
    if (expectedTotal !== totalAmount) {
      throw new Error(
        `Los importes no cierran para ARCA: ImpNeto (${netAmount}) + ImpIVA (${vatAmount}) = ${expectedTotal}, pero ImpTotal es ${totalAmount}. No se envía el comprobante hasta que coincidan exactamente.`
      );
    }

    // Factura C (Monotributista): ARCA no acepta IVA discriminado. Todo
    // el importe va como neto y no se manda el array Iva.
    const isFacturaC = input.voucherTypeCode === 11;

    // Consumidor Final sin identificar: DocNro siempre 0, sin importar
    // qué haya llegado.
    const docNumber = input.docType === 99 ? 0 : input.docNumber;

    const ivaId = IVA_RATE_TO_ID[input.vatRate] ?? 5;
    const { yyyymmdd, isoDate } = getArgentinaTodayDate();

    const requestData: Record<string, unknown> = {
      PtoVta: input.salesPoint,
      CbteTipo: input.voucherTypeCode,
      Concepto: input.concept,
      DocTipo: input.docType,
      DocNro: docNumber,
      CbteFch: yyyymmdd,
      ImpTotal: totalAmount,
      ImpTotConc: 0,
      ImpNeto: isFacturaC ? totalAmount : netAmount,
      ImpOpEx: 0,
      ImpIVA: isFacturaC ? 0 : vatAmount,
      ImpTrib: 0,
      MonId: "PES",
      MonCotiz: 1,
      CondicionIVAReceptorId: IVA_CONDITION_TO_ARCA_ID[input.buyerIvaCondition],
    };

    if (!isFacturaC) {
      requestData.Iva = [{ Id: ivaId, BaseImp: netAmount, Importe: vatAmount }];
    }

    // Se replica a mano lo que hace Afip.ElectronicBilling.createNextVoucher
    // (pedir el último número y crear el siguiente) porque ese método no
    // deja pedir la respuesta completa de ARCA, y sin ella no se puede
    // leer Observaciones — clave para diagnosticar comprobantes que
    // ARCA aprueba pero con advertencias.
    const lastVoucher: number = await this.afip.ElectronicBilling.getLastVoucher(
      input.salesPoint,
      input.voucherTypeCode
    );
    const voucherNumber = lastVoucher + 1;
    requestData.CbteDesde = voucherNumber;
    requestData.CbteHasta = voucherNumber;

    const raw = await this.afip.ElectronicBilling.createVoucher(requestData, true);

    let detail = raw?.FeDetResp?.FECAEDetResponse;
    if (Array.isArray(detail)) detail = detail[0];
    if (!detail?.CAE) {
      throw new Error("ARCA no devolvió un CAE para el comprobante");
    }

    return {
      cae: detail.CAE,
      caeExpirationDate: formatArcaDate(String(detail.CAEFchVto)),
      voucherNumber,
      issueDate: isoDate,
      observations: extractObservations(detail.Observaciones),
    };
  }

  /**
   * Consulta el padrón de ARCA (ws_sr_padron_a13) para verificar la
   * condición frente al IVA real de un CUIT antes de emitir Factura A.
   * Devuelve null si el padrón no respondió (timeout, error de red,
   * servicio caído) — en ese caso quien llama tiene que facturar según
   * lo declarado y marcarlo como no verificado, nunca bloquear la venta
   * por esto.
   */
  async checkTaxpayerCondition(cuit: number): Promise<PadronCheckResult | null> {
    try {
      const persona = await withPadronTimeout(
        this.afip.RegisterScopeThirteen.getTaxpayerDetails(cuit)
      );
      if (!persona) return { found: false, ivaCondition: null };
      return { found: true, ivaCondition: resolveIvaConditionFromPersona(persona) };
    } catch (err) {
      console.error(`[ArcaAdapter] El padrón de ARCA no respondió para el CUIT ${cuit}:`, err);
      return null;
    }
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatArcaDate(raw: string): string {
  // ARCA devuelve fechas como "20260830" -> las pasamos a "2026-08-30"
  if (!raw || raw.length !== 8) return raw;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/**
 * Fecha de "hoy" según la hora local de Argentina, no UTC — cerca de
 * medianoche estas dos difieren, y ARCA rechaza CbteFch que no coincida
 * con el día real del comprobante.
 */
function getArgentinaTodayDate(): { yyyymmdd: string; isoDate: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;

  return { yyyymmdd: `${year}${month}${day}`, isoDate: `${year}-${month}-${day}` };
}

function extractObservations(obs: unknown): ArcaObservation[] {
  if (!obs || typeof obs !== "object") return [];
  const list = (obs as { Obs?: unknown }).Obs;
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  return arr
    .filter((o): o is Record<string, unknown> => !!o && typeof o === "object")
    .map((o) => ({ code: String(o.Code ?? ""), message: String(o.Msg ?? "") }));
}

function withPadronTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`El padrón de ARCA no respondió dentro de ${ARCA_PADRON_TIMEOUT_MS}ms`));
    }, ARCA_PADRON_TIMEOUT_MS);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutHandle));
}

/**
 * REQUIERE VALIDACIÓN: el shape exacto que devuelve ws_sr_padron_a13
 * (getPersona) no se pudo confirmar 100% contra una consulta real antes
 * de programar esto — la documentación pública de ARCA no publica un
 * ejemplo completo de respuesta. Esta función busca las formas más
 * documentadas (impuestos[].idImpuesto = 30 para IVA Responsable
 * Inscripto, 32 para IVA Exento, categoriasMonotributo para
 * Monotributo), pero hay que confirmarlo contra una consulta real antes
 * de confiar en esto para producción. Ante cualquier forma de respuesta
 * no reconocida, devuelve null en vez de arriesgarse a clasificar mal a
 * alguien — eso se trata igual que "el padrón no respondió".
 */
function resolveIvaConditionFromPersona(persona: unknown): IvaCondition | null {
  if (!persona || typeof persona !== "object") return null;
  const p = persona as Record<string, unknown>;

  const monotributoData = p.categoriasMonotributo ?? p.monotributo ?? p.datosMonotributo;
  const hasMonotributo = Array.isArray(monotributoData) ? monotributoData.length > 0 : !!monotributoData;
  if (hasMonotributo) return "monotributista";

  const impuestos = Array.isArray(p.impuestos) ? p.impuestos : [];
  const impuestoIds = impuestos
    .filter((imp): imp is Record<string, unknown> => !!imp && typeof imp === "object")
    .map((imp) => Number(imp.idImpuesto));

  if (impuestoIds.includes(30)) return "responsable_inscripto";
  if (impuestoIds.includes(32)) return "exento";

  return null;
}
