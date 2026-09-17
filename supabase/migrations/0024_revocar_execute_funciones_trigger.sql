-- ============================================================
-- 0024_revocar_execute_funciones_trigger.sql
-- Advertencias del revisor: funciones SECURITY DEFINER que se pueden
-- llamar desde la API (/rest/v1/rpc/...) sin iniciar sesión.
--
-- Son cuatro funciones y NO todas se tratan igual, porque no cumplen el
-- mismo papel:
--
-- 1. handle_new_customer() y prevent_customer_type_self_change() son
--    funciones de TRIGGER: las ejecuta la base sola al insertar o
--    actualizar. Nadie tiene que poder llamarlas por la API; llamarlas a
--    mano no crearía nada (les falta el contexto del trigger), pero no
--    hay razón para dejarlas expuestas. Se revoca EXECUTE.
--
--    Revocar no rompe los triggers: el permiso para ejecutar la función
--    de un trigger se controla al crear el trigger, no en cada disparo.
--
-- 2. is_employee() la llaman las POLICIES de lectura del catálogo
--    público:
--        products / categories → "for select using (active = true or is_employee())"
--    Una policy se evalúa con los permisos de quien consulta, así que si
--    se le revoca EXECUTE al rol anónimo, el catálogo deja de cargar con
--    un error de permisos. Se deja como está a propósito.
--
--    Dejarla expuesta no filtra datos: devuelve un booleano sobre QUIEN
--    llama ("¿soy empleado?"), sin parámetros y sin revelar nada de otras
--    personas.
--
-- 3. has_employee_role(...) la usan policies de escritura y la de
--    employee_profiles. El rol anónimo no necesita evaluarlas nunca (no
--    puede escribir ni leer empleados), así que se le revoca a anon y se
--    mantiene para authenticated, que sí las necesita.
--
-- Para sacar del todo estas dos del alcance de la API habría que moverlas
-- a un esquema no expuesto y reescribir las ~35 policies que las usan:
-- es un cambio grande y riesgoso para el beneficio que da. Queda anotado
-- en docs/seguridad-supabase.md.
-- ============================================================

-- ---------- funciones de trigger: nadie las llama por la API ----------
revoke execute on function handle_new_customer() from public, anon, authenticated;
revoke execute on function prevent_customer_type_self_change() from public, anon, authenticated;

comment on function handle_new_customer() is
  'Trigger de auth.users: crea el perfil del cliente. No se llama por la API (EXECUTE revocado a anon y authenticated).';
comment on function prevent_customer_type_self_change() is
  'Trigger de customer_profiles: impide que un cliente se cambie solo el tipo. No se llama por la API (EXECUTE revocado).';

-- ---------- helper de roles: el anónimo nunca lo necesita ----------
revoke execute on function has_employee_role(variadic employee_role[]) from anon;

comment on function has_employee_role(variadic employee_role[]) is
  'Usada por las policies de escritura. EXECUTE revocado a anon; authenticated la necesita para que se evalúen sus policies.';

comment on function is_employee() is
  'Usada por las policies de lectura del catálogo público, que se evalúan con los permisos de quien consulta: NO revocar EXECUTE a anon o el catálogo deja de cargar. Solo devuelve si quien llama es empleado.';
