import "server-only";
import Afip from "@afipsdk/afip.js";
import { interpretConstanciaResponse, type PadronInterpretation } from "./padron-parser";

export type IvaCondition =
  | "consumidor_final"
  | "responsable_inscripto"
  | "monotributista"
  | "exento";

export interface ArcaVoucherInput {
  salesPoint: number;
  voucherTypeCode: number; // 1 = Factura A, 6 = Factura B, 11 = Factura C
  concept: 1 | 2 | 3; // 1 = productos (nuestro caso casi siempre)
  docType: number; // 80 = CUIT, 96 = DNI, 99 = Consumidor Final sin identificar
  docNumber: number;
  /**
   * CondicionIVAReceptorId (RG 5616). Lo decide invoice-decision.ts, que
   * es donde vive la tabla de códigos confirmada con ARCA.
   */
  receptorConditionId: number;
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

export type PadronCheckResult = PadronInterpretation;

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

  /**
   * El CUIT del emisor llega desde business_settings (lo carga el
   * super_admin en /admin/configuracion-fiscal) — ya no de una variable
   * de entorno. Quien construye este adapter es BillingService, que lo
   * lee de la base y corta con un mensaje claro si no está cargado.
   *
   * En ambiente de pruebas se ignora ese CUIT a propósito: el CUIT de
   * homologación es el del certificado público de Afip SDK y no puede
   * ser otro, así que usar el real acá fallaría al autenticar.
   */
  constructor(params?: { cuit?: number }) {
    this.environment = process.env.ARCA_ENVIRONMENT === "production" ? "production" : "testing";

    if (this.environment === "testing") {
      // CUIT de pruebas público que ofrece Afip SDK: permite desarrollar
      // y probar el flujo completo (incluido el rechazo de comprobantes)
      // sin necesitar todavía el certificado real de Casa Periotti.
      this.cuit = 20409378472;
    } else {
      if (!params?.cuit) {
        throw new Error(
          "Falta el CUIT de Casa Periotti para facturar en producción. Cargalo en /admin/configuracion-fiscal (solo super_admin)."
        );
      }
      this.cuit = params.cuit;
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
      CondicionIVAReceptorId: input.receptorConditionId,
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
   * Consulta el padrón de ARCA (Constancia de Inscripción, ws_sr_constancia_inscripcion) para verificar la
   * condición frente al IVA real de un CUIT, que es la que decide la
   * letra (ver invoice-decision.ts). Devuelve null si el padrón no
   * respondió (timeout, error de red, servicio caído): en ese caso nunca
   * se emite A sin verificar.
   */
  async checkTaxpayerCondition(cuit: number): Promise<PadronCheckResult | null> {
    try {
      // Constancia de Inscripción y no Alcance 13: el Alcance 13 solo
      // devuelve identidad, sin datos de IVA (ver padron-parser.ts).
      // En producción, el certificado tiene que tener asociado el
      // servicio ws_sr_constancia_inscripcion en ARCA.
      const response = await withPadronTimeout(
        this.afip.RegisterInscriptionProof.getTaxpayerDetails(cuit)
      );
      return interpretConstanciaResponse(response);
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
