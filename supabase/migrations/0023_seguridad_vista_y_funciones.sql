-- ============================================================
-- 0023_seguridad_vista_y_funciones.sql
-- Los avisos del revisor de seguridad de Supabase.
--
-- 1. CRÍTICO — products_available_stock con SECURITY DEFINER.
--
-- Una vista, por defecto, consulta con los permisos y las reglas (RLS) de
-- quien la creó, no de quien la consulta. products_available_stock lee
-- products, cuya policy solo muestra al público los productos ACTIVOS;
-- pero a través de la vista cualquier visitante anónimo veía TODOS,
-- incluidos los desactivados, con su stock.
--
-- security_invoker = on hace que la vista aplique las reglas de quien
-- consulta: el público pasa a ver solo los activos y los empleados siguen
-- viendo todo. Nada del código usa esta vista (el checkout calcula el
-- stock disponible dentro de create_order), así que el cambio no afecta
-- ninguna pantalla.
--
-- 2. ADVERTENCIAS — funciones SECURITY DEFINER sin search_path fijo.
--
-- Esas funciones corren con los permisos de su dueño. Si no fijan el
-- search_path, alguien que pueda crear objetos en un esquema que esté
-- antes en el camino de búsqueda podría hacer que la función use SU tabla
-- en lugar de la real. Fijándolo en public + pg_temp, los nombres se
-- resuelven siempre contra el esquema real.
--
-- Se recorren las funciones de public en vez de escribir cada firma a
-- mano: así no se escapa ninguna, no hay riesgo de equivocar un tipo de
-- argumento, y la migración se puede volver a correr sin efecto.
--
-- Solo cambia cómo se resuelven los nombres: ni la lógica ni los permisos
-- de las funciones se tocan.
-- ============================================================

alter view products_available_stock set (security_invoker = on);

comment on view products_available_stock is
  'Stock disponible (stock_quantity - stock_reserved). Con security_invoker aplica las reglas de quien consulta, así el público ve solo los productos activos.';

do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure as signature, p.proname, p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      -- Sin search_path propio todavía.
      and coalesce(array_to_string(p.proconfig, ','), '') not like '%search_path%'
  loop
    execute format('alter function %s set search_path = public, pg_temp', v_function.signature);
    raise notice 'search_path fijado en % (security definer: %)',
      v_function.signature, v_function.prosecdef;
  end loop;
end $$;
