-- ============================================================
-- 0012_payment_transfer.sql
-- Pago por transferencia bancaria en reemplazo de Mercado Pago.
--
-- No se toca nada de lo que ya existe: ni `payments` (el pago por
-- transferencia se registra ahí igual, con provider='transferencia' —
-- mismo criterio que el POS, que usa provider='pos'), ni `orders`, ni
-- el enum order_status. El flujo entero encaja en los estados que ya
-- existen:
--   pending_payment     -> pedido creado, esperando la transferencia
--                          (corre el plazo, stock reservado)
--   payment_processing   -> comprobante subido, esperando que un
--                          empleado lo verifique contra el homebanking
--   paid                 -> empleado confirmó (confirm_order_paid)
--   payment_failed       -> empleado rechazó (release_order_reservation)
--   cancelled            -> venció el plazo sin comprobante (cron)
-- ============================================================

-- ------------------------------------------------------------
-- DATOS BANCARIOS
-- Van en la base, no en variables de entorno: los edita un admin desde
-- /admin/configuracion-pago sin necesidad de un deploy, y cada cambio
-- queda registrado en audit_logs.
--
-- Tabla de una sola fila: el id fijo 1 con un CHECK evita que se
-- generen varias configuraciones en paralelo y tener que adivinar cuál
-- es la vigente.
-- ------------------------------------------------------------
create table payment_settings (
  id integer primary key default 1 check (id = 1),
  alias text,
  cbu text,
  account_holder text,
  bank_name text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create trigger trg_payment_settings_updated_at before update on payment_settings
  for each row execute function set_updated_at();

-- Fila inicial vacía: la página de configuración siempre encuentra algo
-- que editar, y el checkout puede distinguir "todavía no se cargaron
-- los datos bancarios" de "no existe la fila".
insert into payment_settings (id) values (1);

alter table payment_settings enable row level security;

create policy "Empleados ven la configuración de pago" on payment_settings
  for select using (is_employee());

create policy "Admin edita la configuración de pago" on payment_settings
  for update using (has_employee_role('admin', 'super_admin'));

-- ------------------------------------------------------------
-- COMPROBANTES DE TRANSFERENCIA
-- El archivo en sí vive en Storage (bucket privado 'comprobantes'),
-- acá solo queda la referencia + el resultado de la verificación.
--
-- review_status arranca en 'pending' y lo resuelve un empleado. Es
-- deliberadamente independiente de payments.status: si un comprobante
-- se rechaza y el cliente sube otro, queda el historial de los dos.
-- ------------------------------------------------------------
create type receipt_review_status as enum ('pending', 'approved', 'rejected');

create table payment_receipts (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id),
  payment_id uuid not null references payments(id),
  storage_path text not null unique,
  file_mime text not null,
  file_size integer not null,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now(),
  review_status receipt_review_status not null default 'pending',
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  rejection_reason text
);

create index idx_payment_receipts_order on payment_receipts(order_id);
create index idx_payment_receipts_review on payment_receipts(review_status);

alter table payment_receipts enable row level security;

-- El cliente ve los comprobantes de sus propios pedidos (para que la
-- página del pedido pueda mostrar "comprobante recibido"); los
-- empleados ven todos.
create policy "Cliente y empleados ven comprobantes" on payment_receipts
  for select using (
    exists (
      select 1 from orders
      where orders.id = payment_receipts.order_id
        and (orders.customer_id = auth.uid() or is_employee())
    )
  );

-- La subida y la revisión pasan siempre por el backend con el service
-- role (valida tipo/tamaño del archivo, dueño del pedido y estado antes
-- de escribir), así que no hace falta ninguna policy de insert/update
-- para clientes ni empleados.
