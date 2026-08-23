import { createBrowserClient } from "@supabase/ssr";

/**
 * Cliente de Supabase para usar en componentes de cliente ("use client").
 * Respeta Row Level Security según el usuario logueado.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
