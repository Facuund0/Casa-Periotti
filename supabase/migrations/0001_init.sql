-- ============================================================
-- 0001_init.sql — Casa Periotti: esquema base
-- Corralón de Sunchales, Santa Fe. E-commerce minorista/mayorista.
-- ============================================================

create extension if not exists "uuid-ossp";

-- ============================================================
-- CLIENTES
-- ============================================================

create type customer_type as enum ('minorista', 'mayorista', 'mayorista_pendiente');

create table customer_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  customer_type customer_type not null default 'minorista',
  cuit_dni text,
  address_street text,
  address_city text default 'Sunchales',
  address_province text default 'Santa Fe',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column customer_profiles.customer_type is
  'minorista: precio de lista. mayorista_pendiente: pidió mayorista, espera aprobación de un empleado. mayorista: aprobado, ve precio mayorista.';

-- ============================================================
-- CATEGORÍAS (según catálogo real de casaperiotti.com.ar)
-- ============================================================

create table categories (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique,
  parent_id uuid references categories(id),
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index idx_categories_parent on categories(parent_id);

insert into categories (name, slug, display_order) values
  ('Sanitarios', 'sanitarios', 1),
  ('Piscinas', 'piscinas', 2),
  ('Electricidad', 'electricidad', 3),
  ('Ferretería', 'ferreteria', 4),
  ('Artefactos', 'artefactos', 5),
  ('Construcción', 'construccion', 6),
  ('Línea Solar', 'linea-solar', 7),
  ('Combos', 'combos', 8);

-- ============================================================
-- PRODUCTOS
-- ============================================================

create table products (
  id uuid primary key default uuid_generate_v4(),
  sku text not null unique,
  name text not null,
  slug text not null unique,
  description text,
  brand text,
  category_id uuid references categories(id),
  price_retail numeric(12,2) not null check (price_retail >= 0),
  price_wholesale numeric(12,2) not null check (price_wholesale >= 0),
  vat_rate numeric(5,2) not null default 21.00,
  unit text not null default 'unidad',
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  stock_reserved integer not null default 0 check (stock_reserved >= 0),
  stock_minimum integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint stock_reserved_lte_quantity check (stock_reserved <= stock_quantity)
);

create index idx_products_category on products(category_id);
create index idx_products_active on products(active);
create index idx_products_sku on products(sku);

-- Stock realmente disponible para vender (lo usa el checkout)
create or replace view products_available_stock as
  select id, sku, name, stock_quantity - stock_reserved as stock_available
  from products;

create table product_images (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id) on delete cascade,
  storage_path text not null,
  alt_text text,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index idx_product_images_product on product_images(product_id);

-- ============================================================
-- STOCK — historial de movimientos (nunca se pisa el número sin rastro)
-- ============================================================

create type stock_movement_type as enum (
  'entrada_compra',
  'venta',
  'ajuste',
  'merma',
  'devolucion',
  'reserva',
  'liberacion_reserva'
);

create table inventory_movements (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid not null references products(id),
  movement_type stock_movement_type not null,
  quantity integer not null,
  reference_type text,        -- 'order', 'manual_adjustment', etc.
  reference_id uuid,
  created_by uuid references auth.users(id),
  reason text,
  created_at timestamptz not null default now()
);

create index idx_inventory_movements_product on inventory_movements(product_id);
create index idx_inventory_movements_reference on inventory_movements(reference_type, reference_id);

-- ============================================================
-- PEDIDOS
-- ============================================================

create type order_status as enum (
  'created',
  'pending_payment',
  'payment_processing',
  'paid',
  'payment_failed',
  'preparing',
  'ready_for_pickup',
  'shipped',
  'completed',
  'cancelled'
);

create type fulfillment_method as enum ('pickup', 'delivery');

create table orders (
  id uuid primary key default uuid_generate_v4(),
  order_number serial,
  customer_id uuid references customer_profiles(id),
  status order_status not null default 'created',
  fulfillment_method fulfillment_method not null default 'pickup',
  customer_type_at_purchase customer_type not null,

  subtotal numeric(12,2) not null default 0,
  vat_amount numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,

  shipping_address_street text,
  shipping_address_city text,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_orders_customer on orders(customer_id);
create index idx_orders_status on orders(status);

create table order_status_history (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  from_status order_status,
  to_status order_status not null,
  changed_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table order_items (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid not null references products(id),
  product_name_snapshot text not null,   -- por si el producto cambia de nombre después
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null,      -- precio ya recalculado en el backend, congelado
  vat_rate numeric(5,2) not null,
  subtotal numeric(12,2) not null
);

create index idx_order_items_order on order_items(order_id);

-- ============================================================
-- PAGOS
-- ============================================================

create type payment_status as enum (
  'pending', 'processing', 'approved', 'rejected', 'cancelled', 'refunded'
);

create table payments (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid not null references orders(id),
  provider text not null default 'mercadopago',
  provider_payment_id text,           -- ID que devuelve Mercado Pago
  status payment_status not null default 'pending',
  amount numeric(12,2) not null,
  idempotency_key text not null unique,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_payments_order on payments(order_id);
create index idx_payments_provider_id on payments(provider_payment_id);

-- Evita procesar el mismo webhook de Mercado Pago dos veces
create table webhook_events (
  id uuid primary key default uuid_generate_v4(),
  provider text not null,
  event_id text not null,
  payload jsonb not null,
  processed boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz,

  unique (provider, event_id)
);

-- ============================================================
-- FACTURACIÓN (ARCA)
-- ============================================================

create type invoice_status as enum (
  'pending', 'processing', 'authorized', 'rejected', 'retry_pending', 'cancelled'
);

create table invoices (
  id uuid primary key default uuid_generate_v4(),
  order_id uuid references orders(id),         -- null si fue facturación manual sin pedido web
  idempotency_key text not null unique,

  invoice_type text,               -- 'A' | 'B' | 'C' según condición IVA (REQUIERE VALIDACIÓN CONTABLE/FISCAL)
  sales_point integer,
  voucher_number bigint,
  cae text,
  cae_due_date date,

  customer_name text not null,
  customer_document text,

  subtotal numeric(12,2) not null,
  vat_amount numeric(12,2) not null,
  total numeric(12,2) not null,

  status invoice_status not null default 'pending',
  arca_response jsonb,
  rejection_reason text,

  issued_by uuid references auth.users(id),   -- null si fue automática post-pago
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_invoices_order on invoices(order_id);
create index idx_invoices_status on invoices(status);

-- ============================================================
-- USUARIOS INTERNOS (empleados)
-- ============================================================

create type employee_role as enum ('super_admin', 'admin', 'ventas', 'stock', 'facturacion');

create table employee_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role employee_role not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================
-- AUDITORÍA
-- ============================================================

create table audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  data_before jsonb,
  data_after jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_logs_entity on audit_logs(entity_type, entity_id);

-- ============================================================
-- TRIGGERS: updated_at automático
-- ============================================================

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_products_updated_at before update on products
  for each row execute function set_updated_at();
create trigger trg_customer_profiles_updated_at before update on customer_profiles
  for each row execute function set_updated_at();
create trigger trg_orders_updated_at before update on orders
  for each row execute function set_updated_at();
create trigger trg_payments_updated_at before update on payments
  for each row execute function set_updated_at();
create trigger trg_invoices_updated_at before update on invoices
  for each row execute function set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table customer_profiles enable row level security;
alter table products enable row level security;
alter table categories enable row level security;
alter table product_images enable row level security;
alter table inventory_movements enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_status_history enable row level security;
alter table payments enable row level security;
alter table invoices enable row level security;
alter table employee_profiles enable row level security;
alter table audit_logs enable row level security;

-- Helper: ¿el usuario actual es empleado activo?
create or replace function is_employee()
returns boolean as $$
  select exists (
    select 1 from employee_profiles
    where id = auth.uid() and active = true
  );
$$ language sql security definer stable;

-- --- Catálogo: lectura pública ---
create policy "Productos activos son públicos" on products
  for select using (active = true or is_employee());

create policy "Categorías activas son públicas" on categories
  for select using (active = true or is_employee());

create policy "Imágenes de productos son públicas" on product_images
  for select using (true);

-- --- Clientes: cada uno ve/edita solo lo suyo ---
create policy "Cliente ve su propio perfil" on customer_profiles
  for select using (auth.uid() = id or is_employee());

create policy "Cliente crea su propio perfil" on customer_profiles
  for insert with check (auth.uid() = id);

create policy "Cliente edita su propio perfil" on customer_profiles
  for update using (auth.uid() = id or is_employee());

-- --- Pedidos: cliente ve solo los suyos ---
create policy "Cliente ve sus propios pedidos" on orders
  for select using (auth.uid() = customer_id or is_employee());

create policy "Cliente ve items de sus propios pedidos" on order_items
  for select using (
    exists (select 1 from orders where orders.id = order_id and (orders.customer_id = auth.uid() or is_employee()))
  );

create policy "Cliente ve historial de sus propios pedidos" on order_status_history
  for select using (
    exists (select 1 from orders where orders.id = order_id and (orders.customer_id = auth.uid() or is_employee()))
  );

-- --- Pagos: cliente ve solo los de sus pedidos ---
create policy "Cliente ve pagos de sus propios pedidos" on payments
  for select using (
    exists (select 1 from orders where orders.id = order_id and (orders.customer_id = auth.uid() or is_employee()))
  );

-- --- Facturas: cliente ve solo las de sus pedidos ---
create policy "Cliente ve facturas de sus propios pedidos" on invoices
  for select using (
    order_id is null and is_employee()
    or exists (select 1 from orders where orders.id = order_id and (orders.customer_id = auth.uid() or is_employee()))
  );

-- --- Empleados y auditoría: solo empleados ---
create policy "Solo empleados ven perfiles de empleados" on employee_profiles
  for select using (is_employee());

create policy "Solo empleados ven auditoría" on audit_logs
  for select using (is_employee());

create policy "Solo empleados ven movimientos de stock" on inventory_movements
  for select using (is_employee());

-- Nota: las escrituras (insert/update) sobre productos, stock, pedidos,
-- pagos y facturas se hacen SIEMPRE desde el backend (API routes) usando
-- el cliente admin (service_role), nunca directo desde el navegador.
-- Esto es intencional: la lógica de negocio (recalcular precio, verificar
-- stock, etc.) vive en los services de TypeScript, no en el cliente.
