import { fiscalIdDigits, isPlausibleDni, isValidCuit } from "@/shared/utils/cuit";

/**
 * Reglas de los datos fiscales de un cliente (CUIT/DNI + condición de
 * IVA). Un único lugar para las tres pantallas que los cargan: el
 * checkout, el mostrador y la edición desde el panel. Si cada una
 * validara a su manera, un CUIT rechazado en una pasaría por otra.
 *
 * Sin "server-only": el navegador la usa para avisar al instante y el
 * servidor la vuelve a correr antes de guardar.
 */

export const CUSTOMER_IVA_CONDITIONS = [
  "consumidor_final",
  "responsable_inscripto",
  "monotributista",
  "exento",
] as const;

export type CustomerIvaCondition = (typeof CUSTOMER_IVA_CONDITIONS)[number];

export const CUSTOMER_IVA_CONDITION_LABELS: Record<CustomerIvaCondition, string> = {
  consumidor_final: "Consumidor Final",
  responsable_inscripto: "Responsable Inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
};

export function isCustomerIvaCondition(value: unknown): value is CustomerIvaCondition {
  return CUSTOMER_IVA_CONDITIONS.includes(value as CustomerIvaCondition);
}

/**
 * Devuelve null si los datos son válidos, o el mensaje listo para
 * mostrar.
 *
 * - Responsable Inscripto, Monotributista y Exento necesitan un CUIT con
 *   dígito verificador correcto: son condiciones que solo tiene quien
 *   está inscripto, y con un CUIT inválido ARCA rechaza la factura.
 * - Consumidor Final puede no tener documento, o tener un DNI, o un CUIT
 *   (que en ese caso tiene que ser válido).
 */
export function validateCustomerFiscalData(input: {
  cuitDni: string | null | undefined;
  ivaCondition: string;
}): string | null {
  if (!isCustomerIvaCondition(input.ivaCondition)) {
    return "Elegí una condición frente al IVA válida.";
  }

  const digits = fiscalIdDigits(input.cuitDni);

  if (input.ivaCondition !== "consumidor_final") {
    if (!digits) {
      return `Para ${CUSTOMER_IVA_CONDITION_LABELS[input.ivaCondition]} hace falta el CUIT.`;
    }
    if (!isValidCuit(digits)) {
      return "El CUIT no es válido: revisá los 11 dígitos (el último es un dígito verificador).";
    }
    return null;
  }

  if (!digits) return null;
  if (digits.length === 11) {
    return isValidCuit(digits)
      ? null
      : "El CUIT no es válido: revisá los 11 dígitos (el último es un dígito verificador).";
  }
  if (isPlausibleDni(digits)) return null;

  return "Ingresá un DNI (7 u 8 dígitos) o un CUIT válido (11 dígitos).";
}

/** Lo que se guarda: solo dígitos, o null si no hay documento. */
export function normalizeFiscalId(value: string | null | undefined): string | null {
  const digits = fiscalIdDigits(value);
  return digits || null;
}
