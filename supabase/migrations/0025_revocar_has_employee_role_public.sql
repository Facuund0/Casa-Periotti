-- ============================================================
-- 0025_revocar_has_employee_role_public.sql
-- Completa lo que la 0024 no llegó a cerrar.
--
-- La 0024 hizo "revoke execute ... from anon" sobre has_employee_role, y
-- al verificarlo seguía siendo llamable sin sesión. El motivo: Postgres
-- otorga EXECUTE al rol PUBLIC al crear la función, y PUBLIC incluye a
-- anon. Revocarle a anon no quita el permiso que viene por PUBLIC.
--
-- Así que se revoca a PUBLIC (que es de donde venía) y se otorga explícito
-- a los roles que sí la necesitan:
--   - authenticated: sus policies de escritura la evalúan con SUS
--     permisos, así que sin este grant dejaría de poder escribir.
--   - service_role: lo usa el servidor; no evalúa policies, pero se deja
--     explícito para que no dependa de PUBLIC.
--
-- is_employee() sigue con EXECUTE para todos a propósito: las policies de
-- lectura del catálogo público la llaman y el visitante anónimo necesita
-- poder evaluarlas (ver 0024 y docs/seguridad-supabase.md).
-- ============================================================

revoke execute on function has_employee_role(variadic employee_role[]) from public, anon;
grant execute on function has_employee_role(variadic employee_role[]) to authenticated, service_role;

-- Mismo criterio para las dos funciones de trigger: la 0024 ya les revocó
-- a public, anon y authenticated. Se repite por si quedó alguna
-- otorgada por PUBLIC en otro camino; revocar dos veces no hace nada.
revoke execute on function handle_new_customer() from public;
revoke execute on function prevent_customer_type_self_change() from public;
