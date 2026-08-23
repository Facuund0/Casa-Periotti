/**
 * Este archivo se REEMPLAZA generando los tipos reales desde tu Supabase.
 * Después de correr la migración 0001_init.sql, ejecutá:
 *
 *   npx supabase login
 *   npx supabase link --project-ref TU_PROJECT_REF
 *   npx supabase gen types typescript --linked > src/shared/types/database.ts
 *
 * Mientras tanto, este placeholder evita que el proyecto rompa el build.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTable = { Row: any; Insert: any; Update: any; Relationships: any[] };

export type Database = {
  public: {
    Tables: Record<string, AnyTable>;
    Views: Record<string, { Row: Record<string, unknown> }>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Functions: Record<string, { Args: any; Returns: any }>;
    Enums: Record<string, string>;
    CompositeTypes: Record<string, Record<string, unknown>>;
  };
};
