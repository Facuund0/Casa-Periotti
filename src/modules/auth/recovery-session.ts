import "server-only";
import { createClient } from "@/infrastructure/database/supabase-server";

// Cuánto tiempo después de abrir el link del mail se puede definir la
// contraseña nueva. El link en sí vence según la configuración de
// Supabase; esto acota además la sesión que abrió.
const RECOVERY_WINDOW_SECONDS = 15 * 60;

/**
 * true si la sesión actual se abrió desde un link de mail (recuperación o
 * confirmación) en los últimos minutos. Supabase marca esas sesiones con
 * el método "otp" (verificado contra la API). Así, alguien con una sesión
 * iniciada normalmente no puede cambiar la contraseña sin conocer la
 * actual.
 */
export async function hasRecentEmailLinkSession(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const amr = (data?.claims?.amr ?? []) as { method?: string; timestamp?: number }[];
  const now = Math.floor(Date.now() / 1000);
  return amr.some(
    (entry) =>
      (entry.method === "otp" || entry.method === "recovery") &&
      typeof entry.timestamp === "number" &&
      now - entry.timestamp <= RECOVERY_WINDOW_SECONDS
  );
}
