-- ============================================================
-- 0011_arca_voucher_lock.sql
-- Error 10016 de ARCA: "El numero o fecha del comprobante no se
-- corresponde con el proximo a autorizar." ArcaAdapter.createVoucher()
-- arma el número a mano (consulta FECompUltimoAutorizado y suma 1,
-- igual que haría Afip.ElectronicBilling.createNextVoucher() del SDK —
-- se reimplementa a mano solo para poder leer Observaciones, ver
-- arca-adapter.ts) pero esas dos llamadas no son atómicas: si dos
-- facturas para el mismo PtoVta+CbteTipo+entorno se emiten en paralelo,
-- las dos pueden leer el mismo "último número" y las dos mandan N+1 —
-- ARCA autoriza una y rechaza la otra con 10016.
--
-- Esta tabla + sus dos funciones son un lock de aplicación (lease con
-- vencimiento) alrededor de esa sección crítica. No se puede usar
-- pg_advisory_lock acá: BillingService habla con Postgres vía
-- supabase-js (PostgREST), que no garantiza mantener la misma conexión
-- entre el pedido de lock, la llamada externa a ARCA (HTTP/SOAP, tarda
-- varios segundos) y la liberación del lock — un advisory lock de
-- sesión se podría perder o quedar pisado entre medio. Un lease con
-- vencimiento en una fila de tabla no depende de la conexión.
-- ============================================================

create table arca_voucher_locks (
  sales_point integer not null,
  voucher_type_code integer not null,
  environment text not null,
  locked_at timestamptz,
  locked_by text,
  primary key (sales_point, voucher_type_code, environment)
);

-- Sin policies a propósito: nadie salvo service_role (que bypassea RLS)
-- tiene por qué tocar esta tabla — mismo criterio que el resto de las
-- tablas del sistema (0001_init.sql habilita RLS en todas).
alter table arca_voucher_locks enable row level security;

-- Intenta tomar el lock. Devuelve true si lo consiguió (porque estaba
-- libre, o porque el lease anterior venció hace más de
-- p_stale_after_seconds — cubre el caso de un proceso que se cayó sin
-- liberar). Devuelve false si otra emisión lo tiene tomado y sigue
-- vigente — quien llama tiene que esperar y reintentar.
--
-- billing-service.ts SIEMPRE manda p_stale_after_seconds explícito
-- (calculado a partir de ARCA_VOUCHER_TIMEOUT_MS, con margen para el
-- reintento del 10016 y los round-trips) — el default de acá es solo
-- una red de respaldo para una llamada manual/de diagnóstico, y tiene
-- que ser generoso a propósito: si el lease vence ANTES de que termine
-- una emisión legítima (intento original + reintento del 10016, cada
-- uno con su propio timeout hacia ARCA), otra emisión puede robarle el
-- lock a mitad de camino — exactamente la carrera que este lock existe
-- para evitar. Mejor un default demasiado largo que uno ajustado.
create or replace function acquire_arca_voucher_lock(
  p_sales_point integer,
  p_voucher_type_code integer,
  p_environment text,
  p_lock_token text,
  p_stale_after_seconds integer default 90
) returns boolean as $$
declare
  v_locked_by text;
begin
  insert into arca_voucher_locks (sales_point, voucher_type_code, environment, locked_at, locked_by)
  values (p_sales_point, p_voucher_type_code, p_environment, now(), p_lock_token)
  on conflict (sales_point, voucher_type_code, environment) do update
    set locked_at = now(), locked_by = p_lock_token
    where arca_voucher_locks.locked_at is null
       or arca_voucher_locks.locked_at < now() - (p_stale_after_seconds || ' seconds')::interval;

  select locked_by into v_locked_by
    from arca_voucher_locks
    where sales_point = p_sales_point
      and voucher_type_code = p_voucher_type_code
      and environment = p_environment;

  return v_locked_by = p_lock_token;
end;
$$ language plpgsql;

-- Libera el lock SOLO si p_lock_token todavía es el dueño — evita que
-- quien perdió el lock por vencimiento (stale) libere por accidente el
-- lock de quien lo tomó después.
create or replace function release_arca_voucher_lock(
  p_sales_point integer,
  p_voucher_type_code integer,
  p_environment text,
  p_lock_token text
) returns void as $$
begin
  update arca_voucher_locks
    set locked_at = null, locked_by = null
    where sales_point = p_sales_point
      and voucher_type_code = p_voucher_type_code
      and environment = p_environment
      and locked_by = p_lock_token;
end;
$$ language plpgsql;

revoke execute on function acquire_arca_voucher_lock from public, anon, authenticated;
revoke execute on function release_arca_voucher_lock from public, anon, authenticated;
grant execute on function acquire_arca_voucher_lock to service_role;
grant execute on function release_arca_voucher_lock to service_role;
