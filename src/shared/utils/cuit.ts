/**
 * CUIT / DNI: validación y formato.
 *
 * No lleva "server-only": la usan el checkout (para avisar al instante),
 * las Server Actions (que vuelven a validar, nunca confían en el
 * navegador) y el panel.
 *
 * El dígito verificador sigue el algoritmo módulo 11 de AFIP. Está
 * probado contra CUITs reales emitidos (20-20803535-6 de Casa Periotti y
 * 30-68441647-9 de La Alegría S.A.) y rechaza el de prueba
 * 12345678910, que es justo el que terminaba en facturas A rechazadas
 * por ARCA con el error 10015.
 */

const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

/** Solo los dígitos, sin guiones ni espacios. */
export function fiscalIdDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** ¿Es un CUIT de 11 dígitos con el dígito verificador correcto? */
export function isValidCuit(value: string | null | undefined): boolean {
  const digits = fiscalIdDigits(value);
  if (digits.length !== 11) return false;

  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * CUIT_WEIGHTS[i];

  let checkDigit = 11 - (sum % 11);
  if (checkDigit === 11) checkDigit = 0;
  // Cuando el cálculo da 10, AFIP no emite ese CUIT con ese prefijo: le
  // cambia el prefijo y el verificador pasa a ser 9. Es la regla que usan
  // los validadores de referencia.
  if (checkDigit === 10) checkDigit = 9;

  return checkDigit === Number(digits[10]);
}

/** ¿Es un DNI plausible (7 u 8 dígitos)? */
export function isPlausibleDni(value: string | null | undefined): boolean {
  const digits = fiscalIdDigits(value);
  return digits.length === 7 || digits.length === 8;
}

/** 20208035356 -> 20-20803535-6. Si no es un CUIT de 11 dígitos, lo deja como vino. */
export function formatCuit(value: string | null | undefined): string {
  const digits = fiscalIdDigits(value);
  if (digits.length !== 11) return value ?? "";
  return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
}
