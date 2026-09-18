-- ============================================================
-- 0027_cuenta_corriente.sql
--
-- Fiado: vender en cuenta corriente a un cliente registrado, y después
-- registrar los pagos que va haciendo.
--
-- Cómo encaja con lo que ya existe, sin cambiar nada de eso:
--
--  * La VENTA no cambia en nada. Sigue pasando por create_order y
--    confirm_order_paid: se descuenta el stock y se emite la factura en
--    el momento de la entrega, que es cuando corresponde emitirla, sin
--    importar cuándo se cobre. El pago queda registrado en payments con
--    payment_method_id = 'cuenta_corriente', así la factura sale con
--    "Cuenta corriente" como condición de venta.
--
--  * La PLATA que entra de verdad se lleva en esta tabla nueva, no en
--    payments: una venta fiada es un movimiento que suma deuda, y cada
--    pago del cliente es un movimiento que la baja. Por eso los reportes
--    dejan el fiado afuera del total de caja: la venta existe, pero esa
--    plata todavía no entró al mostrador.
--
-- amount con signo, para que el saldo sea una suma simple:
--   positivo = el cliente DEBE más (venta fiada, ajuste en contra)
--   negativo = el cliente debe MENOS (pago recibido, ajuste a favor)
-- Saldo del cliente = sum(amount). Positivo es deuda.
-- ============================================================

-- ------------------------------------------------------------
-- Permiso de fiado por cliente. Por defecto NADIE tiene cuenta
-- corriente: hay que habilitarla cliente por cliente, así el mostrador
-- no puede fiarle a alguien por error.
-- ------------------------------------------------------------
alter table customer_profiles
  add column credit_enabled boolean not null default false,
  add column credit_limit numeric(12, 2) check (credit_limit is null or credit_limit >= 0);

comment on column customer_profiles.credit_enabled is
  'true: se le puede vender en cuenta corriente. Lo habilita un empleado desde el panel.';
comment on column customer_profiles.credit_limit is
  'Límite de deuda sugerido. null = sin límite cargado. Avisa al vender, no corta la venta: la decisión es del mostrador.';

-- ------------------------------------------------------------
-- Movimientos de la cuenta corriente
-- ------------------------------------------------------------
create table customer_account_movements (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references customer_profiles(id) on delete cascade,

  -- La venta que generó la deuda. null en los pagos y los ajustes.
  order_id uuid references orders(id),

  kind text not null check (kind in ('venta', 'pago', 'ajuste')),

  -- Con signo (ver arriba). Una venta siempre suma, un pago siempre resta.
  amount numeric(12, 2) not null check (amount <> 0),

  -- Cómo pagó el cliente, o por qué se ajustó. Texto libre a propósito:
  -- no vale la pena un enum para una nota del mostrador.
  note text,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),

  constraint venta_suma check (kind <> 'venta' or amount > 0),
  constraint pago_resta check (kind <> 'pago' or amount < 0),
  constraint venta_con_pedido check (kind <> 'venta' or order_id is not null)
);

comment on table customer_account_movements is
  'Cuenta corriente de cada cliente: ventas fiadas (suman deuda) y pagos recibidos (la bajan). Es la fuente de verdad de lo que entró, no payments.';

create index idx_account_movements_customer on customer_account_movements (customer_id, created_at desc);
create index idx_account_movements_created on customer_account_movements (created_at desc);

-- Una sola deuda por venta: si un reintento intentara cargar la misma
-- venta dos veces, la base lo rechaza.
create unique index account_movements_venta_unica
  on customer_account_movements (order_id) where kind = 'venta';

-- ------------------------------------------------------------
-- RLS
-- Se escribe desde el servidor con el cliente admin (el mostrador y la
-- pantalla de cuentas). El cliente puede ver su propia cuenta; los
-- empleados, todas.
-- ------------------------------------------------------------
alter table customer_account_movements enable row level security;

create policy "Cliente ve su propia cuenta corriente" on customer_account_movements
  for select using (auth.uid() = customer_id);

create policy "Empleados ven las cuentas corrientes" on customer_account_movements
  for select using (is_employee());
