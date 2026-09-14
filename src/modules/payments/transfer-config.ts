/**
 * Única fuente de verdad de la configuración del pago por
 * transferencia. Lo consumen, sin duplicar ningún número:
 *  - el reloj que ve el cliente en el checkout (llega como prop desde
 *    checkout/page.tsx, que es Server Component — por eso la variable
 *    de entorno NO necesita el prefijo NEXT_PUBLIC_)
 *  - el cron /api/cron/release-stale-reservations y el botón manual del
 *    panel, que cancelan los pedidos vencidos
 *  - la validación del comprobante, en el navegador y en el servidor
 *
 * Si estos valores vivieran en dos lugares, el reloj del cliente y el
 * cron podrían decir cosas distintas sobre el mismo pedido.
 *
 * OJO: este archivo NO lleva "server-only" a propósito — las constantes
 * de validación del archivo las necesita también el componente cliente
 * que valida antes de subir. getTransferWindowMinutes() sí es
 * server-only en la práctica (process.env no existe en el navegador),
 * y solo se llama desde Server Components / rutas de API.
 */

// Minutos que tiene el cliente para transferir y subir el comprobante
// antes de que el cron libere la reserva de stock.
const DEFAULT_TRANSFER_WINDOW_MINUTES = 30;

export function getTransferWindowMinutes(): number {
  const raw = process.env.PAYMENT_TRANSFER_WINDOW_MINUTES;
  if (!raw) return DEFAULT_TRANSFER_WINDOW_MINUTES;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[transfer-config] PAYMENT_TRANSFER_WINDOW_MINUTES="${raw}" no es un número de minutos válido — se usa el default de ${DEFAULT_TRANSFER_WINDOW_MINUTES}.`
    );
    return DEFAULT_TRANSFER_WINDOW_MINUTES;
  }
  return parsed;
}

// Comprobante: imagen o PDF, hasta 10 MB. Se valida en el navegador
// (para dar el error al instante, sin subir nada) y de nuevo en el
// servidor (porque la validación del navegador es una comodidad, no una
// garantía — nunca se confía en ella).
export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

export const RECEIPT_ALLOWED_MIMES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
] as const;

// Para el atributo accept del input file — mismo criterio que
// RECEIPT_ALLOWED_MIMES, no una lista aparte.
export const RECEIPT_ACCEPT_ATTRIBUTE = RECEIPT_ALLOWED_MIMES.join(",");

export const RECEIPT_BUCKET = "comprobantes";

/**
 * Código que el cliente pone en el concepto/referencia de la
 * transferencia y que el empleado usa para cotejar contra el
 * homebanking. Se deriva del número de pedido: ya es único, corto,
 * tipeable a mano y coincide con el "Pedido #116" que ve el empleado en
 * el panel.
 */
export function buildTransferReference(orderNumber: number): string {
  return `CP-${String(orderNumber).padStart(6, "0")}`;
}

export function describeReceiptLimits(): string {
  return `Imagen (JPG, PNG, WEBP, HEIC) o PDF, hasta ${RECEIPT_MAX_BYTES / (1024 * 1024)} MB.`;
}

/**
 * Validación compartida del archivo. Devuelve null si está bien, o el
 * mensaje de error listo para mostrarle al cliente. La usan el
 * componente del checkout (antes de subir) y la Server Action (antes de
 * escribir en Storage).
 */
export function validateReceiptFile(file: { type: string; size: number }): string | null {
  if (!RECEIPT_ALLOWED_MIMES.includes(file.type as (typeof RECEIPT_ALLOWED_MIMES)[number])) {
    return `Ese tipo de archivo no se puede subir. ${describeReceiptLimits()}`;
  }
  if (file.size > RECEIPT_MAX_BYTES) {
    return `El archivo es demasiado grande. ${describeReceiptLimits()}`;
  }
  if (file.size === 0) {
    return "El archivo está vacío.";
  }
  return null;
}
