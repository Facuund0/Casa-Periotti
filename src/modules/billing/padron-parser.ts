/**
 * Interpretación de la Constancia de Inscripción de ARCA
 * (ws_sr_constancia_inscripcion, método getPersona_v2).
 *
 * Por qué este servicio y no otro: antes se consultaba el padrón
 * Alcance 13 (ws_sr_padron_a13), y ese servicio devuelve SOLO datos de
 * identidad — razón social, domicilio, forma jurídica —, sin ningún dato
 * de IVA. Verificado con una consulta real. Por eso la verificación de
 * Responsable Inscripto nunca pudo determinar nada: la información no
 * estaba en la respuesta. La Constancia de Inscripción sí informa los
 * impuestos en los que está inscripto el contribuyente.
 *
 * Códigos de impuesto (tabla de impuestos de ARCA):
 *   20 MONOTRIBUTO · 30 IVA · 32 IVA EXENTO
 *   33 IVA RESPONSABLE NO INSCRIPTO · 34 IVA NO ALCANZADO
 *
 * Qué está verificado y qué no: la forma de las respuestas con
 * observaciones (errorConstancia) está confirmada contra homologación.
 * La forma de una respuesta exitosa (datosRegimenGeneral.impuesto,
 * datosMonotributo) sale de la documentación, porque los CUIT de prueba
 * de homologación devuelven observaciones en lugar de datos. Por eso la
 * interpretación es defensiva: acepta lista u objeto suelto, estado
 * presente o ausente, y ante una forma que no reconoce devuelve null
 * (sin clasificar) en vez de adivinar.
 *
 * Sin dependencias ni "server-only": se puede probar aislado.
 */

export type PadronIvaCondition =
  | "consumidor_final"
  | "responsable_inscripto"
  | "monotributista"
  | "exento";

export interface PadronInterpretation {
  /** false solo si ARCA dice que el CUIT no existe. */
  found: boolean;
  /** null si la respuesta no permite determinarla. */
  ivaCondition: PadronIvaCondition | null;
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
    return { found: false, ivaCondition: null, messages: [] };
  }
  if (typeof response !== "object") {
    return { found: true, ivaCondition: null, messages: [] };
  }

  const r = response as Record<string, unknown>;

  const messages = [
    ...collectMessages(r.errorConstancia),
    ...collectMessages(r.errorRegimenGeneral),
    ...collectMessages(r.errorMonotributo),
  ];

  const monotributo = nonEmptyObject(r.datosMonotributo);
  const regimenGeneral = nonEmptyObject(r.datosRegimenGeneral);

  const activeIds = new Set<number>([
    ...activeImpuestoIds(regimenGeneral?.impuesto),
    ...activeImpuestoIds(monotributo?.impuesto),
  ]);

  let ivaCondition: PadronIvaCondition | null = null;

  if (monotributo || activeIds.has(IMPUESTO_MONOTRIBUTO)) {
    ivaCondition = "monotributista";
  } else if (activeIds.has(IMPUESTO_IVA)) {
    ivaCondition = "responsable_inscripto";
  } else if (activeIds.has(IMPUESTO_IVA_EXENTO)) {
    ivaCondition = "exento";
  } else if (
    activeIds.has(IMPUESTO_IVA_NO_ALCANZADO) ||
    activeIds.has(IMPUESTO_IVA_RESPONSABLE_NO_INSCRIPTO)
  ) {
    // No es Responsable Inscripto: nunca le corresponde Factura A. Se
    // lo trata como Consumidor Final, que es la condición del sistema
    // que factura igual que estos casos (Factura B).
    ivaCondition = "consumidor_final";
  }

  return { found: true, ivaCondition, messages };
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
