import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Cliente de Supabase para Server Components / API Routes.
 * Respeta RLS según el usuario logueado (usa las cookies de sesión).
 *
 * NOTA: todavía sin tipar con <Database> a propósito. En cuanto corras
 *   npx supabase gen types typescript --linked > src/shared/types/database.ts
 * agregá el genérico de vuelta: createServerClient<Database>(...).
 * Así vas a tener autocompletado real de columnas y vas a ver en rojo
 * cualquier campo que hayas escrito mal.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Se puede ignorar si se llama desde un Server Component puro
            // (el middleware ya se encarga de refrescar la sesión)
          }
        },
      },
    }
  );
}
