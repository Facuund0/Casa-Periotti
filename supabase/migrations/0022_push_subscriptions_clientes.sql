-- ============================================================
-- 0022_push_subscriptions_clientes.sql
-- Los clientes también reciben notificaciones push: cuando se confirma
-- el pago de su pedido y cuando se rechaza.
--
-- La tabla push_subscriptions ya guardaba una fila por dispositivo, pero
-- solo de empleados (columna employee_id). Clientes y empleados viven los
-- dos en auth.users, así que alcanza con renombrar la columna y anotar de
-- qué tipo es cada suscripción: de eso depende qué avisos recibe.
--
-- Sin pérdida de datos: las suscripciones que ya existían son de
-- empleados y quedan marcadas como tales.
-- ============================================================

alter table push_subscriptions rename column employee_id to user_id;

alter table push_subscriptions
  add column subscriber_type text not null default 'empleado'
    check (subscriber_type in ('empleado', 'cliente'));

comment on column push_subscriptions.user_id is
  'Dueño de la suscripción: puede ser un empleado o un cliente (los dos están en auth.users).';
comment on column push_subscriptions.subscriber_type is
  'empleado: recibe pedidos a confirmar, solicitudes de mayorista y facturas rechazadas según su rol. cliente: recibe el estado de SUS pedidos.';

alter index push_subscriptions_employee_idx rename to push_subscriptions_user_idx;

-- Las policies apuntaban a la columna vieja: se recrean con el nombre
-- nuevo. Siguen diciendo lo mismo: cada uno ve y borra solo lo suyo.
drop policy if exists "Empleado ve sus suscripciones push" on push_subscriptions;
drop policy if exists "Empleado borra sus suscripciones push" on push_subscriptions;

create policy "Cada uno ve sus suscripciones push" on push_subscriptions
  for select using (auth.uid() = user_id);

create policy "Cada uno borra sus suscripciones push" on push_subscriptions
  for delete using (auth.uid() = user_id);
