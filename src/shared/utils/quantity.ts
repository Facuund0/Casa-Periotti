/**
 * Cantidades que pueden tener decimales (2,5 m³) y cantidades enteras
 * (3 bolsas) se muestran distinto: nadie quiere leer "3,000 bolsas".
 * Se muestran hasta 3 decimales, sin ceros de relleno.
 */
export function formatQuantity(quantity: number): string {
  return quantity.toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

/** Acepta "2,5" y "2.5". Devuelve null si no es un número usable. */
export function parseQuantity(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Cantidad válida para un producto: hasta 3 decimales si los admite,
 * entera si no. Devuelve null si no sirve.
 */
export function normalizeQuantity(value: number, allowsDecimals: boolean): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const rounded = allowsDecimals ? Math.round(value * 1000) / 1000 : Math.round(value);
  return rounded > 0 ? rounded : null;
}
