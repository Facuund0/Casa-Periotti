/**
 * Interpretación de la Constancia de Inscripción de ARCA (padrón A5,
 * ws_sr_constancia_inscripcion, método getPersona_v2).
 *
 * Por qué este servicio y no otro: el padrón Alcance 13
 * (ws_sr_padron_a13) devuelve SOLO datos de identidad, sin ningún dato de
 * IVA. La Constancia de Inscripción sí informa los impuestos en los que
 * está inscripto el contribuyente.
 *
 * Códigos de impuesto (tabla de impuestos de ARCA):
 *   20 MONOTRIBUTO · 30 IVA · 32 IVA EXENTO
 *   33 IVA RESPONSABLE NO INSCRIPTO · 34 IVA NO ALCANZADO
 *
 * Qué está verificado y qué no: la forma de las respuestas con
 * observaciones (errorConstancia, que trae nombre y apellido) está
 * confirmada contra homologación. La forma de una respuesta exitosa
 * (datosGenerales, datosRegimenGeneral.impuesto, datosMonotributo) sale
 * de la documentación, porque los CUIT de prueba de homologación
 * devuelven observaciones en lugar de datos. Por eso la interpretación
 * es defensiva: acepta lista u objeto suelto, estado presente o ausente,
 * y ante una respuesta con observaciones devuelve null (sin clasificar)
 * en vez de adivinar.
 *
 * Variantes de monotributo (social, trabajador independiente promovido):
 * no se encontró en la respuesta ningún dato que las distinga del
 * monotributo común (ni en homologación ni en pyafipws, que interpreta
 * este mismo servicio), así que no se distinguen. Ver invoice-decision.ts.
 *
 * Sin dependencias ni "server-only": se puede probar aislado.
 */

/** Categoría del receptor según el padrón, en los términos de la tabla de decisión. */
export type PadronFiscalStatus =
  | "responsable_inscripto"
  | "monotributo"
  | "exento"
  | "no_alcanzado"
  | "no_categorizado";

export interface PadronInterpretation {
  /** false solo si ARCA dice que el CUIT no existe. */
  found: boolean;
  /** null si la respuesta no permite determinarla (observaciones, forma desconocida). */
  fiscalStatus: PadronFiscalStatus | null;
  /** Razón social, o apellido y nombre, tal como figura en ARCA. */
  legalName: string | null;
  /** Observaciones que devolvió ARCA sobre el CUIT, tal cual. */
  messages: string[];
}

export const IMPUESTO_MONOTRIBUTO = 20;
export const IMPUESTO_IVA = 30;
export const IMPUESTO_IVA_EXENTO = 32;
export const IMPUESTO_IVA_RESPONSABLE_NO_INSCRIPTO = 33;
export const IMPUESTO_IVA_NO_ALCANZADO = 34;

/**
 * El SDK devuelve null cuando ARCA responde que el CUIT no existe, y la
 * respuesta completa (personaReturn) en cualquier otro caso.
 */
export function interpretConstanciaResponse(response: unknown): PadronInterpretation {
  if (response === null || response === undefined) {
    return { found: false, fiscalStatus: null, legalName: null, messages: [] };
  }
  if (typeof response !== "object") {
    return { found: true, fiscalStatus: null, legalName: null, messages: [] };
  }

  const r = response as Record<string, unknown>;

  const constanciaErrors = collectMessages(r.errorConstancia);
  const messages = [
    ...constanciaErrors,
    ...collectMessages(r.errorRegimenGeneral),
    ...collectMessages(r.errorMonotributo),
  ];

  const datosGenerales = nonEmptyObject(r.datosGenerales);
  const legalName = extractLegalName(datosGenerales) ?? extractLegalName(nonEmptyObject(r.errorConstancia));

  const monotributo = nonEmptyObject(r.datosMonotributo);
  const regimenGeneral = nonEmptyObject(r.datosRegimenGeneral);

  const activeIds = new Set<number>([
    ...activeImpuestoIds(regimenGeneral?.impuesto),
    ...activeImpuestoIds(monotributo?.impuesto),
  ]);

  let fiscalStatus: PadronFiscalStatus | null = null;

  if (monotributo || activeIds.has(IMPUESTO_MONOTRIBUTO)) {
    fiscalStatus = "monotributo";
  } else if (activeIds.has(IMPUESTO_IVA)) {
    fiscalStatus = "responsable_inscripto";
  } else if (activeIds.has(IMPUESTO_IVA_EXENTO)) {
    fiscalStatus = "exento";
  } else if (activeIds.has(IMPUESTO_IVA_NO_ALCANZADO)) {
    fiscalStatus = "no_alcanzado";
  } else if (activeIds.has(IMPUESTO_IVA_RESPONSABLE_NO_INSCRIPTO)) {
    // PENDIENTE DE CONFIRMACIÓN DEL CONTADOR: Responsable No Inscripto es
    // una categoría derogada; se la trata como No Categorizado (código 7).
    fiscalStatus = "no_categorizado";
  } else if (constanciaErrors.length === 0 && (datosGenerales || regimenGeneral)) {
    // La constancia respondió con datos, sin observaciones, y el CUIT no
    // está inscripto ni en IVA ni en Monotributo.
    // PENDIENTE DE CONFIRMACIÓN DEL CONTADOR: va como No Categorizado (7).
    fiscalStatus = "no_categorizado";
  }

  return { found: true, fiscalStatus, legalName, messages };
}

function extractLegalName(source: Record<string, unknown> | null): string | null {
  if (!source) return null;
  const razonSocial = typeof source.razonSocial === "string" ? source.razonSocial.trim() : "";
  if (razonSocial) return razonSocial;
  const parts = [source.apellido, source.nombre]
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .map((p) => p.trim());
  return parts.length ? parts.join(" ") : null;
}

/**
 * Ids de los impuestos activos. Al pasar de XML a objeto, un único
 * impuesto puede llegar como objeto suelto en lugar de lista. Si el
 * impuesto trae un estado y no es ACTIVO (por ejemplo una baja), no
 * cuenta; si no trae estado, se lo toma como vigente, porque la
 * constancia lista las inscripciones actuales.
 */
function activeImpuestoIds(value: unknown): number[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const ids: number[] = [];

  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const impuesto = item as Record<string, unknown>;
    const estado = impuesto.estadoImpuesto ?? impuesto.estado;
    if (typeof estado === "string" && estado.trim().toUpperCase() !== "ACTIVO") continue;
    const id = Number(impuesto.idImpuesto);
    if (Number.isFinite(id)) ids.push(id);
  }

  return ids;
}

function collectMessages(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as Record<string, unknown>).error;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.filter((m): m is string => typeof m === "string" && m.trim().length > 0);
}

function nonEmptyObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.keys(value).length > 0 ? (value as Record<string, unknown>) : null;
}
