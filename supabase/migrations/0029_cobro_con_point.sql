-- ============================================================
-- 0029_cobro_con_point.sql
--
-- Cobrar con tarjeta desde el sistema, mandándole el monto a la terminal
-- Point Smart de Mercado Pago en vez de tipearlo a mano.
--
-- Cómo es el ida y vuelta, que explica por qué hace falta esta tabla:
--
--   1. El mostrador confirma la venta. Se crea el pedido (create_order,
--      que reserva stock) igual que siempre, pero NO se cobra todavía.
--   2. Se le manda el monto a la terminal ("payment intent"). El cliente
--      pasa la tarjeta y elige débito, crédito o cuotas en el equipo.
--   3. El sistema pregunta cómo salió. Si se aprobó, ahí sí se registra
--      el pago y se confirma la venta (confirm_order_paid + factura),
--      exactamente el mismo camino que una venta en efectivo.
--   4. Si se rechaza o se cancela, se libera la reserva de stock con la
--      misma función que un pago rechazado de la web.
--
-- El paso 2 tarda lo que tarda el cliente, así que el estado tiene que
-- vivir en algún lado: si se cierra el navegador, se corta la luz o se
-- reintenta, hay que poder saber qué pasó con ESA venta. Eso es esta
-- tabla. Sin ella, un pago aprobado que nadie leyó quedaría como venta
-- sin cobrar.
--
-- Nada del cobro actual cambia: efectivo, transferencia, tarjeta tipeada
-- a mano y cuenta corriente siguen por donde venían. Si la terminal no
-- está configurada, el medio de pago ni aparece en pantalla.
-- ============================================================

-- ------------------------------------------------------------
-- Qué terminal usar. Va en payment_settings, que es donde ya viven los
-- datos de cobro y lo edita un admin desde el panel (no en variables de
-- entorno: cambiar de equipo no puede necesitar un deploy).
-- ------------------------------------------------------------
alter table payment_settings
  add column point_enabled boolean not null default false,
  add column point_device_id text;

comment on column payment_settings.point_enabled is
  'true: en la venta de mostrador aparece el medio de pago "Tarjeta (Point)", que le manda el monto a la terminal.';
comment on column payment_settings.point_device_id is
  'ID de la terminal Point Smart en Mercado Pago (se lista con la API y tiene que estar en modo PDV/integrado).';

-- ------------------------------------------------------------
-- Cobros pedidos a la terminal
-- ------------------------------------------------------------
create table point_payment_intents (
  id uuid primary key default uuid_generate_v4(),

  -- Un solo cobro por pedido: si se reintenta la consulta, no se duplica.
  order_id uuid not null unique references orders(id),

  -- El identificador que devuelve Mercado Pago al mandar el monto.
  intent_id text not null unique,
  device_id text not null,

  amount numeric(12, 2) not null check (amount > 0),

  -- Último estado conocido, tal como lo informa Mercado Pago:
  -- OPEN y ON_TERMINAL = esperando al cliente; FINISHED/PROCESSED =
  -- pagado; CANCELED, ERROR, EXPIRED y ABANDONED = no se cobró.
  state text not null default 'OPEN',

  -- Datos del pago ya hecho, para conciliar contra la liquidación de
  -- Mercado Pago y para que el reporte pueda distinguir débito de
  -- crédito en cuotas.
  payment_id text,
  payment_type text,
  installments integer,

  -- true cuando ya se registró el pago y se confirmó la venta. Evita
  -- confirmar dos veces si la pantalla pregunta de nuevo.
  settled boolean not null default false,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_checked_at timestamptz
);

comment on table point_payment_intents is
  'Cobros con tarjeta pedidos a una terminal Point. Guarda en qué quedó cada uno para que un pago aprobado nunca se pierda si se cierra la pantalla.';

create index idx_point_intents_state on point_payment_intents (state) where not settled;
create index idx_point_intents_created on point_payment_intents (created_at desc);

create trigger trg_point_payment_intents_updated_at before update on point_payment_intents
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- RLS: se escribe desde el servidor con el cliente admin; los empleados
-- pueden consultarla desde el panel. Un cliente no tiene nada que ver acá.
-- ------------------------------------------------------------
alter table point_payment_intents enable row level security;

create policy "Empleados ven los cobros con Point" on point_payment_intents
  for select using (is_employee());
