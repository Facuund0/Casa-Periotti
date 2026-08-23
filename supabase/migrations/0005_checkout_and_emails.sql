-- ============================================================
-- 0005_checkout_and_emails.sql
-- Completa lo necesario para el flujo de checkout, pagos y emails.
-- ============================================================

-- Datos adicionales del pago con tarjeta que conviene guardar para
-- soporte/reclamos (nunca datos sensibles de la tarjeta en sí).
alter table payments
  add column payment_method_id text,   -- 'visa', 'master', etc. (lo da Mercado Pago)
  add column installments integer,
  add column status_detail text;       -- motivo detallado si fue rechazado

-- Historial de emails enviados, para poder reintentar si falló uno
-- sin volver a mandar los que sí llegaron.
create type email_status as enum ('pending', 'sent', 'failed');

create table email_events (
  id uuid primary key default uuid_generate_v4(),
  recipient text not null,
  template text not null,          -- 'order_confirmation', 'invoice', 'internal_new_order', etc.
  reference_type text,
  reference_id uuid,
  status email_status not null default 'pending',
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index idx_email_events_reference on email_events(reference_type, reference_id);

alter table email_events enable row level security;

create policy "Solo empleados ven el historial de emails" on email_events
  for select using (is_employee());

-- Índices que van a hacer falta para las queries del checkout y del
-- panel de facturación.
create index idx_orders_customer_status on orders(customer_id, status);
create index idx_invoices_environment on invoices(environment);
