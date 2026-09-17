/**
 * Fechas y horas mostradas siempre en hora de Argentina.
 *
 * `toLocaleString("es-AR")` sin zona horaria usa la del lugar donde corre
 * el código: en Vercel el servidor está en UTC, así que las horas salían
 * 3 horas adelantadas (y cerca de medianoche, con el día equivocado).
 * Con la zona fija se ve la hora real de Argentina, se renderice en el
 * servidor o en el navegador de alguien que esté en otro país.
 *
 * Sin "server-only": lo usan Server y Client Components.
 */

const TIME_ZONE = "America/Argentina/Buenos_Aires";

const dateTimeFormat = new Intl.DateTimeFormat("es-AR", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const dateFormat = new Intl.DateTimeFormat("es-AR", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "17/09/2026, 14:05:32" en hora de Argentina. */
export function formatDateTimeAR(value: string | number | Date): string {
  const date = toDate(value);
  return date ? dateTimeFormat.format(date) : "—";
}

/** "17/09/2026" según el día en Argentina. */
export function formatDateAR(value: string | number | Date): string {
  const date = toDate(value);
  return date ? dateFormat.format(date) : "—";
}
