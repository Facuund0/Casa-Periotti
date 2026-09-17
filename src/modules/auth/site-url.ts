import "server-only";
import { headers } from "next/headers";

/**
 * Origen del sitio (https://casa-periotti.vercel.app, http://localhost:3000)
 * para armar los links que manda Supabase Auth por mail. Sale de la
 * solicitud actual, así funciona igual en local, en previews y en
 * producción sin una variable de entorno por ambiente.
 *
 * No es un riesgo de redirección abierta: Supabase solo respeta las URLs
 * que estén en su lista "Redirect URLs" (Authentication → URL
 * Configuration); cualquier otra la reemplaza por la Site URL.
 */
export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/** Solo rutas internas: evita que ?next= mande a otro sitio. */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
