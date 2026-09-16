/**
 * Tabla de decisión del comprobante de Casa Periotti (emisor Responsable
 * Inscripto). ÚNICO lugar que decide letra, condición del receptor que se
 * le informa a ARCA, documento y leyenda. La usan la vista previa del
 * checkout y del mostrador, y la emisión (BillingService), así lo que se
 * le muestra al cliente antes de confirmar es exactamente lo que se emite.
 *
 * Reglas:
 *  - La letra la decide el padrón de ARCA, nunca lo que eligió el cliente
 *    ni su tipo comercial (mayorista/minorista).
 *  - Responsable Inscripto → A. Monotributo → A con la leyenda de la
 *    Ley 27.618 (RG 5003/2021). Exento, No Alcanzado, No Categorizado y
 *    Consumidor Final → B.
 *  - Nunca A sin verificar: si el padrón no responde o no informa la
 *    condición, B a Consumidor Final identificado con el CUIT, marcada
 *    como no verificada para revisarla.
 *  - CUIT inválido, inexistente o cancelado: no se puede facturar con él.
 *  - Consumidor Final desde el umbral de ARCA (igual o superior): DNI.
 *
 * Combinaciones confirmadas con FEParamGetCondicionIvaReceptor de ARCA:
 * clase A admite 1, 6, 13 y 16; clase B admite 4, 5, 7, 8, 9, 10 y 15.
 *
 * Sin "server-only": es lógica pura, se puede probar aislada.
 */
import type { PadronFiscalStatus } from "./padron-parser";
// Import relativo (no "@/"): así el módulo se puede probar aislado con node.
import { formatCuit, isPlausibleDni, isValidCuit } from "../../shared/utils/cuit";

export const ARCA_RECEPTOR_CONDITION = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
  NO_CATEGORIZADO: 7,
  NO_ALCANZADO: 15,
} as const;

/** Descripciones tal como las publica ARCA (FEParamGetCondicionIvaReceptor). */
export const ARCA_RECEPTOR_CONDITION_LABELS: Record<number, string> = {
  1: "IVA Responsable Inscripto",
  4: "IVA Sujeto Exento",
  5: "Consumidor Final",
  6: "Responsable Monotributo",
  7: "Sujeto No Categorizado",
  13: "Monotributista Social",
  15: "IVA No Alcanzado",
  16: "Monotributo Trabajador Independiente Promovido",
};

const MONOTRIBUTO_CONDITION_IDS = [6, 13, 16];

/**
 * Leyenda obligatoria en comprobantes A a monotributistas. Texto de la
 * RG 5003/2021, art. 20 inc. 1 (modifica el art. 15 de la RG 1415),
 * verificado contra el Boletín Oficial del 02/06/2021.
 */
export const MONOTRIBUTO_LEGEND =
  "El crédito fiscal discriminado en el presente comprobante, sólo podrá ser computado a efectos del Régimen de Sostenimiento e Inclusión Fiscal para Pequeños Contribuyentes de la Ley Nº 27.618";

export function legendForReceptor(invoiceType: string | null, receptorConditionId: number | null): string | null {
  return invoiceType === "A" && receptorConditionId != null && MONOTRIBUTO_CONDITION_IDS.includes(receptorConditionId)
    ? MONOTRIBUTO_LEGEND
    : null;
}

/** Lo que devolvió la consulta al padrón. null = no se pudo consultar. */
export interface PadronLookupResult {
  found: boolean;
  fiscalStatus: PadronFiscalStatus | null;
  legalName: string | null;
  messages: string[];
}

export type FiscalVerification = "not_applicable" | "verified" | "unverified";

export interface InvoiceDecision {
  letter: "A" | "B";
  receptorConditionId: number;
  receptorConditionLabel: string;
  /** 80 CUIT · 96 DNI · 99 sin identificar */
  docType: 80 | 96 | 99;
  /** Solo dígitos; "0" si no hay documento. */
  docNumber: string;
  legend: string | null;
  verification: FiscalVerification;
  /** Razón social según ARCA, si se consultó y la informó. */
  legalName: string | null;
  /** Por qué corresponde este comprobante, listo para mostrar. */
  reason: string;
  /**
   * Monotributo sin variante distinguible: se informa 6. Quien emite deja
   * un log de advertencia con el CUIT para revisarlo después.
   */
  monotributoVariantUnverified: boolean;
}

export type DecisionOutcome = { ok: true; decision: InvoiceDecision } | { ok: false; error: string };

// Observaciones de ARCA que significan que el CUIT no puede recibir un
// comprobante. Hoy la única inequívoca es la cancelación.
const CANCELLED_MESSAGE = /cancelad/i;

/** "Factura con datos fiscales": el padrón decide. */
export function decideForFiscalData(cuit: string | null | undefined, padron: PadronLookupResult | null): DecisionOutcome {
  const digits = (cuit ?? "").replace(/\D/g, "");
  if (!isValidCuit(digits)) {
    return {
      ok: false,
      error: "El CUIT no es válido: revisá los 11 dígitos (el último es un dígito verificador).",
    };
  }
  const shown = formatCuit(digits);

  const unverifiedB = (reason: string): DecisionOutcome => ({
    ok: true,
    decision: {
      letter: "B",
      receptorConditionId: ARCA_RECEPTOR_CONDITION.CONSUMIDOR_FINAL,
      receptorConditionLabel: ARCA_RECEPTOR_CONDITION_LABELS[5],
      docType: 80,
      docNumber: digits,
      legend: null,
      verification: "unverified",
      legalName: padron?.legalName ?? null,
      reason,
      monotributoVariantUnverified: false,
    },
  });

  // Caso 13: el padrón no respondió.
  if (!padron) {
    return unverifiedB(
      "No se pudo consultar el padrón de ARCA en este momento, así que no se puede verificar la condición frente al IVA. Se emite Factura B a Consumidor Final identificado con el CUIT."
    );
  }

  // Caso 10: CUIT inexistente.
  if (!padron.found) {
    return {
      ok: false,
      error: `ARCA no tiene registrado el CUIT ${shown}. Revisalo o comprá como Consumidor Final.`,
    };
  }

  // Caso 11: CUIT cancelado.
  const cancelled = padron.messages.find((m) => CANCELLED_MESSAGE.test(m));
  if (cancelled) {
    return {
      ok: false,
      error: `ARCA informa sobre el CUIT ${shown}: ${cleanMessage(cancelled)}. Con ese CUIT no se puede facturar; comprá como Consumidor Final o usá otro CUIT.`,
    };
  }

  // Caso 12: respondió, pero sin condición de IVA.
  if (padron.fiscalStatus === null) {
    const detail = padron.messages.length ? ` ARCA informó: ${padron.messages.map(cleanMessage).join(" / ")}.` : "";
    return unverifiedB(
      `El padrón de ARCA no informó la condición frente al IVA de este CUIT.${detail} Se emite Factura B a Consumidor Final identificado con el CUIT.`
    );
  }

  const verified = (
    letter: "A" | "B",
    receptorConditionId: number,
    reason: string,
    monotributoVariantUnverified = false
  ): DecisionOutcome => ({
    ok: true,
    decision: {
      letter,
      receptorConditionId,
      receptorConditionLabel: ARCA_RECEPTOR_CONDITION_LABELS[receptorConditionId],
      docType: 80,
      docNumber: digits,
      legend: legendForReceptor(letter, receptorConditionId),
      verification: "verified",
      legalName: padron.legalName,
      reason,
      monotributoVariantUnverified,
    },
  });

  switch (padron.fiscalStatus) {
    // Caso 1
    case "responsable_inscripto":
      return verified("A", 1, "Según ARCA es Responsable Inscripto en IVA: corresponde Factura A.");
    // Casos 2 a 4. La respuesta del padrón no distingue monotributo social
    // ni trabajador independiente promovido (ver padron-parser.ts): se
    // informa siempre 6 y se marca para dejar un log de advertencia.
    case "monotributo":
      return verified(
        "A",
        ARCA_RECEPTOR_CONDITION.MONOTRIBUTO,
        "Según ARCA está adherido al Monotributo: corresponde Factura A con la leyenda de la Ley 27.618.",
        true
      );
    // Caso 5
    case "exento":
      return verified("B", ARCA_RECEPTOR_CONDITION.EXENTO, "Según ARCA es Exento en IVA: corresponde Factura B, no A.");
    // Caso 6
    case "no_alcanzado":
      return verified(
        "B",
        ARCA_RECEPTOR_CONDITION.NO_ALCANZADO,
        "Según ARCA no está alcanzado por el IVA: corresponde Factura B, no A."
      );
    // Casos 7 y 8. PENDIENTE DE CONFIRMACIÓN DEL CONTADOR: CUIT sin IVA ni
    // Monotributo, o Responsable No Inscripto, van como No Categorizado (7).
    case "no_categorizado":
      return verified(
        "B",
        ARCA_RECEPTOR_CONDITION.NO_CATEGORIZADO,
        "Según ARCA no está inscripto en IVA ni en el Monotributo: corresponde Factura B como Sujeto No Categorizado."
      );
  }
}

/** Consumidor Final, sin datos fiscales (casos 14 y 15). */
export function decideForFinalConsumer(params: {
  total: number;
  threshold: number;
  dni: string | null | undefined;
}): DecisionOutcome {
  const dni = (params.dni ?? "").replace(/\D/g, "");
  const needsId = params.total >= params.threshold;

  if (dni && !isPlausibleDni(dni)) {
    return { ok: false, error: "El DNI tiene que tener 7 u 8 dígitos." };
  }
  if (needsId && !dni) {
    return {
      ok: false,
      error: `Por el monto de la compra (desde $ ${params.threshold.toLocaleString("es-AR")}), ARCA exige identificar al comprador: ingresá el DNI, o elegí "Factura con datos fiscales" para usar un CUIT.`,
    };
  }

  const identified = Boolean(dni);
  return {
    ok: true,
    decision: {
      letter: "B",
      receptorConditionId: ARCA_RECEPTOR_CONDITION.CONSUMIDOR_FINAL,
      receptorConditionLabel: ARCA_RECEPTOR_CONDITION_LABELS[5],
      docType: identified ? 96 : 99,
      docNumber: identified ? dni : "0",
      legend: null,
      verification: "not_applicable",
      legalName: null,
      reason: identified
        ? "Consumidor Final identificado con DNI: corresponde Factura B."
        : "Consumidor Final: corresponde Factura B.",
      monotributoVariantUnverified: false,
    },
  };
}

/** ARCA termina sus mensajes con punto; se saca para no duplicarlo al citarlo. */
export function cleanMessage(message: string): string {
  return message.replace(/[.\s]+$/, "");
}
