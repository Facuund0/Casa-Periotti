-- ============================================================
-- 0002_auth_and_roles.sql
-- Auto-creación de perfil al registrarse + RLS con roles granulares
-- ============================================================

-- ------------------------------------------------------------
-- Al registrarse un cliente en Supabase Auth, se crea automáticamente
-- su fila en customer_profiles. Los datos vienen del metadata que
-- manda el frontend en el signUp (full_name, phone, quiere_mayorista, cuit).
-- ------------------------------------------------------------

create or replace function handle_new_customer()
returns trigger as $$
declare
  wants_wholesale boolean;
begin
  -- Solo crea perfil de cliente si el signup NO vino marcado como empleado
  -- (los empleados se dan de alta manualmente por un super_admin, ver más abajo)
  if coalesce(new.raw_user_meta_data ->> 'is_employee_signup', 'false') = 'true' then
    return new;
  end if;

  wants_wholesale := coalesce(new.raw_user_meta_data ->> 'wants_wholesale', 'false') = 'true';

  insert into customer_profiles (id, full_name, email, phone, customer_type, cuit_dni)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    new.raw_user_meta_data ->> 'phone',
    case when wants_wholesale then 'mayorista_pendiente'::customer_type else 'minorista'::customer_type end,
    new.raw_user_meta_data ->> 'cuit_dni'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_handle_new_customer
  after insert on auth.users
  for each row execute function handle_new_customer();

-- ------------------------------------------------------------
-- Helper: ¿el usuario actual tiene alguno de estos roles de empleado?
-- Uso: has_employee_role('admin', 'super_admin')
-- ------------------------------------------------------------

create or replace function has_employee_role(variadic roles employee_role[])
returns boolean as $$
  select exists (
    select 1 from employee_profiles
    where id = auth.uid()
      and active = true
      and role = any(roles)
  );
$$ language sql security definer stable;

-- ------------------------------------------------------------
-- PRODUCTOS: solo admin/super_admin/stock pueden crear o modificar
-- ------------------------------------------------------------

create policy "Admin y stock pueden crear productos" on products
  for insert with check (has_employee_role('admin', 'super_admin', 'stock'));

create policy "Admin y stock pueden modificar productos" on products
  for update using (has_employee_role('admin', 'super_admin', 'stock'));

create policy "Admin y stock pueden crear categorías" on categories
  for insert with check (has_employee_role('admin', 'super_admin', 'stock'));

create policy "Admin y stock pueden modificar categorías" on categories
  for update using (has_employee_role('admin', 'super_admin', 'stock'));

create policy "Admin y stock crean imágenes" on product_images
  for insert with check (has_employee_role('admin', 'super_admin', 'stock'));

create policy "Admin y stock modifican imágenes" on product_images
  for update using (has_employee_role('admin', 'super_admin', 'stock'));

create policy "Admin y stock borran imágenes" on product_images
  for delete using (has_employee_role('admin', 'super_admin', 'stock'));

-- ------------------------------------------------------------
-- STOCK: los movimientos siempre se insertan a través de la función
-- adjust_stock() (ver 0004), nunca directo. Esta policy es un
-- respaldo por si alguna vez se necesita insertar manualmente.
-- ------------------------------------------------------------

create policy "Admin y stock pueden registrar movimientos" on inventory_movements
  for insert with check (has_employee_role('admin', 'super_admin', 'stock'));

-- ------------------------------------------------------------
-- CLIENTES: la policy de UPDATE de 0001 ya permite que el propio
-- cliente edite su fila. Pero eso NO debe incluir poder auto-aprobarse
-- como mayorista. Se bloquea con un trigger que protege específicamente
-- la columna customer_type: solo se puede cambiar si quien ejecuta la
-- operación es un empleado con rol admin/ventas, o si viene del backend
-- usando la service_role key (procesos automáticos).
-- ------------------------------------------------------------

create or replace function prevent_customer_type_self_change()
returns trigger as $$
begin
  if new.customer_type is distinct from old.customer_type then
    if auth.role() <> 'service_role' and not has_employee_role('admin', 'super_admin', 'ventas') then
      raise exception 'No autorizado para cambiar el tipo de cliente (minorista/mayorista)';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger trg_prevent_customer_type_self_change
  before update on customer_profiles
  for each row execute function prevent_customer_type_self_change();

-- ------------------------------------------------------------
-- PEDIDOS: ventas/admin pueden cambiar estados manualmente si hace falta
-- ------------------------------------------------------------

create policy "Ventas y admin pueden modificar pedidos" on orders
  for update using (has_employee_role('admin', 'super_admin', 'ventas'));

-- ------------------------------------------------------------
-- FACTURACIÓN: solo facturacion/admin pueden emitir manualmente
-- ------------------------------------------------------------

create policy "Facturación y admin pueden crear facturas manuales" on invoices
  for insert with check (has_employee_role('admin', 'super_admin', 'facturacion'));

-- ------------------------------------------------------------
-- EMPLEADOS: solo super_admin da de alta empleados
-- ------------------------------------------------------------

create policy "Super admin administra empleados" on employee_profiles
  for all using (has_employee_role('super_admin'))
  with check (has_employee_role('super_admin'));

-- Nota: el primer super_admin de Casa Periotti se crea a mano una sola
-- vez desde el SQL Editor de Supabase (ver instrucciones en README),
-- porque hasta que exista un super_admin no hay nadie con permiso para
-- crear al primero.
