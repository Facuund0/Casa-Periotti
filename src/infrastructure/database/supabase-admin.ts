import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * ⚠️ Cliente con privilegios de administrador (service_role).
 * SALTA Row Level Security por completo.
 *
 * Reglas de uso:
 * - Solo se importa desde API Routes o Server Actions, NUNCA desde un
 *   componente "use client".
 * - Se usa exclusivamente para operaciones donde el backend necesita
 *   escribir/leer sin restricción de RLS (ej: recalcular stock,
 *   procesar webhooks de pago, generar facturas).
 * - El paquete "server-only" hace que el build falle si por error se
 *   importa desde código de cliente.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}
