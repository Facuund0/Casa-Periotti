/**
 * Bordes de un rango de fechas elegido en el panel.
 *
 * Los inputs `type="date"` mandan "2026-09-14" sin hora ni zona. Las
 * columnas contra las que se filtra son timestamptz, así que si el borde
 * se armara sin offset, Postgres lo interpretaría en UTC y el rango
 * quedaría corrido 3 horas: un comprobante subido a las 22:00 del lunes
 * en Argentina caería fuera de un filtro "hasta el lunes".
 *
 * Por eso los bordes se fijan explícitamente en hora de Argentina.
 * Argentina no aplica horario de verano (UTC-3 todo el año), así que un
 * offset fijo es correcto y no hace falta traer una librería de zonas.
 */
const AR_UTC_OFFSET = "-03:00";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Comienzo del día (00:00:00 en Argentina) de una fecha "yyyy-mm-dd". */
export function startOfDayInArgentina(date: string): string | null {
  if (!DATE_ONLY.test(date)) return null;
  return `${date}T00:00:00.000${AR_UTC_OFFSET}`;
}

/** Fin del día (23:59:59.999 en Argentina) de una fecha "yyyy-mm-dd". */
export function endOfDayInArgentina(date: string): string | null {
  if (!DATE_ONLY.test(date)) return null;
  return `${date}T23:59:59.999${AR_UTC_OFFSET}`;
}
