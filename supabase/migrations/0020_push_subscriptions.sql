-- ============================================================
-- 0020_push_subscriptions.sql
-- Notificaciones push para empleados (Web Push + VAPID).
--
-- Una fila por DISPOSITIVO de un empleado: el navegador entrega un
-- endpoint propio por dispositivo y por navegador. Que un empleado tenga
-- las notificaciones "activadas" es, justamente, que exista su fila; al
-- desactivarlas desde el panel, se borra.
--
-- Qué se notifica y a quién lo decide el código (push-service.ts) según
-- el rol del empleado: ventas y admin reciben pedidos a confirmar y
-- solicitudes de mayorista; facturación y admin, las facturas rechazadas.
--
-- Las claves p256dh y auth son las que genera el navegador para cifrar el
-- aviso. No sirven para nada más: sin ellas el aviso no se puede entregar,
-- y con ellas no se accede a ningún dato del sistema.
-- ============================================================

create table push_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  employee_id uuid not null references auth.users(id) on delete cascade,

  -- Dirección que da el navegador para entregarle avisos a ese
  -- dispositivo. Única: si el mismo navegador se vuelve a suscribir, se
  -- actualiza la fila en vez de duplicarla.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,

  -- Para que el empleado reconozca cuál de sus dispositivos es cuando
  -- quiere desactivar uno.
  user_agent text,

  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_failure_at timestamptz
);

create index push_subscriptions_employee_idx on push_subscriptions (employee_id);

comment on table push_subscriptions is
  'Suscripciones de Web Push por dispositivo de cada empleado. El envío las borra cuando el navegador informa que ya no valen (410/404).';

alter table push_subscriptions enable row level security;

-- El empleado ve y borra sus propias suscripciones; el envío y el alta
-- pasan por el servidor con el cliente admin.
create policy "Empleado ve sus suscripciones push" on push_subscriptions
  for select using (auth.uid() = employee_id);

create policy "Empleado borra sus suscripciones push" on push_subscriptions
  for delete using (auth.uid() = employee_id);
