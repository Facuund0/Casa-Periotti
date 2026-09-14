/**
 * Código de barras obligatorio en todo comprobante impreso de clase A,
 * B, C, E o M (RG 1702/2004 y sus modificatorias).
 *
 * Composición, en este orden y con esta cantidad exacta de dígitos:
 *   CUIT del emisor ................ 11
 *   Código de tipo de comprobante ...  3   (001 = Factura A, 006 = B, 011 = C)
 *   Punto de venta ..................  5
 *   CAE ............................. 14
 *   Vencimiento del CAE (AAAAMMDD) ..  8
 *   Dígito verificador ..............  1
 *                                    ----
 *                                      42
 *
 * Se codifica en "Interleaved 2 of 5" (ITF), que exige una cantidad par
 * de dígitos — los 42 de arriba la cumplen.
 *
 * Este archivo no lleva "server-only" porque es aritmética pura sin
 * dependencias; el que lo usa (invoice-pdf.ts) sí es server-only.
 */

export const INVOICE_BARCODE_DIGIT_COUNT = 42;

export interface InvoiceBarcodeInput {
  /** CUIT del emisor, solo dígitos. */
  cuitDigits: string;
  /** Código de ARCA del tipo de comprobante: 1 = A, 6 = B, 11 = C. */
  voucherTypeCode: number;
  salesPoint: number;
  cae: string;
  /** Vencimiento del CAE en formato yyyy-mm-dd. */
  caeDueDate: string;
}

export class InvoiceBarcodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvoiceBarcodeError";
  }
}

/**
 * Dígito verificador módulo 10 según el Anexo de la RG 1702:
 *  1. sumar los dígitos de las posiciones IMPARES (contando desde la
 *     izquierda, empezando en 1)
 *  2. multiplicar esa suma por 3
 *  3. sumar los dígitos de las posiciones PARES
 *  4. sumar los resultados de 2 y 3
 *  5. el dígito es lo que falta para llegar al siguiente múltiplo de 10
 */
export function computeModulo10CheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) {
    throw new InvoiceBarcodeError("El código de barras solo puede contener dígitos");
  }

  let oddSum = 0;
  let evenSum = 0;

  for (let i = 0; i < digits.length; i++) {
    const digit = digits.charCodeAt(i) - 48;
    // i es 0-based, así que la posición 1 (impar) es i = 0.
    if (i % 2 === 0) oddSum += digit;
    else evenSum += digit;
  }

  const total = oddSum * 3 + evenSum;
  return (10 - (total % 10)) % 10;
}

/** Los 42 dígitos del código de barras, verificador incluido. */
export function buildInvoiceBarcodeDigits(input: InvoiceBarcodeInput): string {
  const cuit = input.cuitDigits.replace(/\D/g, "");
  if (cuit.length !== 11) {
    throw new InvoiceBarcodeError(`El CUIT del emisor tiene que tener 11 dígitos (llegó "${input.cuitDigits}")`);
  }

  const cae = input.cae.replace(/\D/g, "");
  if (cae.length !== 14) {
    throw new InvoiceBarcodeError(`El CAE tiene que tener 14 dígitos (llegó "${input.cae}")`);
  }

  const dueDate = input.caeDueDate.replace(/\D/g, "");
  if (dueDate.length !== 8) {
    throw new InvoiceBarcodeError(
      `El vencimiento del CAE tiene que ser una fecha yyyy-mm-dd (llegó "${input.caeDueDate}")`
    );
  }

  const body =
    cuit +
    pad(input.voucherTypeCode, 3) +
    pad(input.salesPoint, 5) +
    cae +
    dueDate;

  const withCheckDigit = body + String(computeModulo10CheckDigit(body));

  if (withCheckDigit.length !== INVOICE_BARCODE_DIGIT_COUNT) {
    // Defensa contra un error de programación: si esto salta, alguna de
    // las longitudes de arriba cambió y el código quedaría ilegible o
    // con una cantidad impar de dígitos (ITF no lo admite).
    throw new InvoiceBarcodeError(
      `El código de barras quedó de ${withCheckDigit.length} dígitos y tiene que ser de ${INVOICE_BARCODE_DIGIT_COUNT}`
    );
  }

  return withCheckDigit;
}

// Patrones de Interleaved 2 of 5: cinco elementos por dígito, dos de
// ellos anchos. true = ancho.
const ITF_PATTERNS: Record<string, boolean[]> = {
  "0": [false, false, true, true, false],
  "1": [true, false, false, false, true],
  "2": [false, true, false, false, true],
  "3": [true, true, false, false, false],
  "4": [false, false, true, false, true],
  "5": [true, false, true, false, false],
  "6": [false, true, true, false, false],
  "7": [false, false, false, true, true],
  "8": [true, false, false, true, false],
  "9": [false, true, false, true, false],
};

export interface BarcodeBar {
  /** Desplazamiento desde el inicio del código, en módulos estrechos. */
  offset: number;
  /** Ancho de la barra, en módulos estrechos. */
  width: number;
}

export interface BarcodeGeometry {
  bars: BarcodeBar[];
  /** Ancho total del código, en módulos estrechos. */
  totalWidth: number;
}

/**
 * Geometría del código en "módulos" (unidades de barra estrecha), para
 * que quien dibuja elija la escala. Se devuelven solo las barras: los
 * espacios son lo que queda entre ellas.
 *
 * En ITF los dígitos se codifican de a pares: los cinco elementos del
 * primer dígito del par son BARRAS y los cinco del segundo son
 * ESPACIOS, intercalados uno y uno. De ahí el nombre.
 *
 * Se dibuja como vectores y no como una imagen rasterizada a propósito:
 * un código de barras impreso desde un PNG pierde nitidez al escalar y
 * puede dejar de leerse en el lector del mostrador.
 */
export function interleaved2of5Geometry(digits: string, wideRatio = 3): BarcodeGeometry {
  if (!/^\d+$/.test(digits)) {
    throw new InvoiceBarcodeError("El código de barras solo puede contener dígitos");
  }
  if (digits.length % 2 !== 0) {
    throw new InvoiceBarcodeError(
      `Interleaved 2 of 5 necesita una cantidad par de dígitos (llegaron ${digits.length})`
    );
  }

  const bars: BarcodeBar[] = [];
  let offset = 0;

  function push(width: number, isBar: boolean) {
    if (isBar) bars.push({ offset, width });
    offset += width;
  }

  // Guarda inicial: barra-espacio-barra-espacio, todos estrechos.
  push(1, true);
  push(1, false);
  push(1, true);
  push(1, false);

  for (let i = 0; i < digits.length; i += 2) {
    const barPattern = ITF_PATTERNS[digits[i]];
    const spacePattern = ITF_PATTERNS[digits[i + 1]];

    for (let e = 0; e < 5; e++) {
      push(barPattern[e] ? wideRatio : 1, true);
      push(spacePattern[e] ? wideRatio : 1, false);
    }
  }

  // Guarda final: barra ancha, espacio estrecho, barra estrecha.
  push(wideRatio, true);
  push(1, false);
  push(1, true);

  return { bars, totalWidth: offset };
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}
