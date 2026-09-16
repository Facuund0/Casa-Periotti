-- ============================================================
-- 0018_order_fiscal_choices.sql
-- Elección fiscal guardada junto a la venta de mostrador.
--
-- Hasta ahora la elección del comprobante de una venta de mostrador
-- (Consumidor Final o factura con datos fiscales, CUIT/DNI, nombre y mail
-- de un comprador sin cuenta) viajaba solo en memoria hasta la
-- facturación. Si esa emisión fallaba y la reintentaba el cron
-- bill-unbilled-orders, la elección se perdía: la venta se facturaba
-- según el perfil del cliente o como Consumidor Final, y el comprobante
-- no le llegaba al mail que había dejado el comprador.
--
-- Con esta tabla, la facturación y el envío del comprobante leen siempre
-- lo que se eligió en la venta, en el primer intento y en cualquier
-- reintento. No interviene en la creación del pedido ni en el stock: se
-- escribe después de registrar el pago y antes de confirmar la venta.
--
-- La letra se sigue decidiendo consultando el padrón al emitir; acá queda
-- qué se pidió y qué informó el padrón en el momento de la venta.
-- ============================================================

create table order_fiscal_choices (
  order_id uuid primary key references orders(id) on delete cascade,

  requested_kind text not null check (requested_kind in ('final_consumer', 'fiscal_data')),
  cuit text check (cuit is null or cuit ~ '^\d{11}$'),
  dni text check (dni is null or dni ~ '^\d{7,8}$'),

  -- Comprador sin cuenta: nombre para la factura y mail al que mandarla.
  buyer_name text,
  buyer_email text,

  -- Lo que informó el padrón al validar la venta (solo con datos fiscales).
  -- null en padron_fiscal_status = no se pudo verificar la condición.
  padron_fiscal_status text check (
    padron_fiscal_status is null or padron_fiscal_status in (
      'responsable_inscripto', 'monotributo', 'exento', 'no_alcanzado', 'no_categorizado'
    )
  ),
  padron_legal_name text,
  padron_checked_at timestamptz,

  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),

  check (requested_kind <> 'fiscal_data' or cuit is not null)
);

comment on table order_fiscal_choices is
  'Elección fiscal hecha en la venta (hoy: mostrador). billOrder() y el envío del comprobante la leen en lugar del perfil del cliente, también en los reintentos del cron.';

alter table order_fiscal_choices enable row level security;

-- Se escribe y se lee con el cliente admin desde el servidor; los
-- empleados pueden consultarla desde el panel.
create policy "Empleados ven la elección fiscal de las ventas" on order_fiscal_choices
  for select using (is_employee());
