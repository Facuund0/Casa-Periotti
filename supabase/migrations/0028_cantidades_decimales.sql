-- ============================================================
-- 0028_cantidades_decimales.sql
--
-- Poder vender 2,5 m³ de arena o 0,75 kg de algo, sin romper nada de lo
-- que hoy se vende por unidad.
--
-- Cómo se hace, en dos partes:
--
-- 1. Las cantidades pasan de entero a numeric(12,3) en pedidos, stock y
--    movimientos de inventario. Tres decimales alcanzan para metros
--    cúbicos, kilos y metros, y evitan que un redondeo raro deje el stock
--    con una cola infinita.
--
-- 2. Cada producto dice si admite decimales (products.decimal_quantity).
--    Arranca en false en TODOS los productos, así que el comportamiento
--    de hoy no cambia: si alguien manda 2,5 de un producto que se vende
--    por unidad, create_order lo rechaza igual que antes.
--
-- Lo que NO cambia:
--   * El precio lo sigue decidiendo create_order leyendo la base, con el
--     mismo bloqueo de filas y la misma regla de mayorista.
--   * confirm_order_paid y release_order_reservation quedan intactas: ya
--     trabajaban con la cantidad del renglón sin declarar su tipo, así
--     que siguen andando con decimales sin tocarles una línea.
--   * Los importes siguen redondeados al centavo (round(..., 2)).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Permiso por producto
-- ------------------------------------------------------------
alter table products
  add column decimal_quantity boolean not null default false;

comment on column products.decimal_quantity is
  'true: se puede vender en cantidades con decimales (m³, kg, metros). false (por defecto): solo cantidades enteras, como hasta ahora.';

-- ------------------------------------------------------------
-- 2. Cantidades con decimales
--
-- La vista products_available_stock depende de las dos columnas de
-- stock, así que hay que borrarla antes de cambiarles el tipo y volver a
-- crearla igual que la dejó la migración 0023 (con security_invoker).
-- ------------------------------------------------------------
drop view if exists products_available_stock;

alter table products
  alter column stock_quantity type numeric(12, 3),
  alter column stock_reserved type numeric(12, 3),
  alter column stock_minimum type numeric(12, 3);

alter table order_items
  alter column quantity type numeric(12, 3);

alter table inventory_movements
  alter column quantity type numeric(12, 3);

create view products_available_stock as
  select id, sku, name, stock_quantity - stock_reserved as stock_available
  from products;

alter view products_available_stock set (security_invoker = on);

comment on view products_available_stock is
  'Stock disponible (stock_quantity - stock_reserved). Con security_invoker aplica las reglas de quien consulta, así el público ve solo los productos activos.';

-- Al recrear la vista se pierden los permisos que tenía, así que se
-- vuelven a dar los mismos: con security_invoker, quien consulta ve solo
-- lo que su RLS le permite (el público, solo productos activos).
grant select on products_available_stock to anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 3. adjust_stock con decimales
--
-- Cambian los tipos de los parámetros y de lo que devuelve, así que hay
-- que borrarla y crearla de nuevo: con "create or replace" Postgres no
-- deja cambiar el tipo de retorno, y si quedaran las dos versiones no
-- sabría cuál llamar.
--
-- El cuerpo es el mismo de la migración 0003: mismo bloqueo de fila
-- (for update), mismos controles de stock y de reserva, mismo
-- movimiento de inventario.
-- ------------------------------------------------------------
drop function if exists adjust_stock(uuid, integer, integer, stock_movement_type, text, uuid, text, uuid);

create function adjust_stock(
  p_product_id uuid,
  p_quantity_delta numeric,
  p_reserved_delta numeric,
  p_movement_type stock_movement_type,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_reason text default null,
  p_created_by uuid default null
)
returns table (new_stock_quantity numeric, new_stock_reserved numeric) as $$
declare
  v_current_quantity numeric;
  v_current_reserved numeric;
  v_new_quantity numeric;
  v_new_reserved numeric;
  v_decimal_ok boolean;
begin
  select stock_quantity, stock_reserved, decimal_quantity
    into v_current_quantity, v_current_reserved, v_decimal_ok
    from products
    where id = p_product_id
    for update;

  if not found then
    raise exception 'Producto % no existe', p_product_id
      using errcode = 'P0001';
  end if;

  -- Un producto que se vende por unidad no puede quedar con medio en
  -- stock: sería un error de carga que después no cierra con el conteo.
  if not v_decimal_ok and (
    p_quantity_delta <> round(p_quantity_delta) or p_reserved_delta <> round(p_reserved_delta)
  ) then
    raise exception 'Ese producto se maneja por unidades enteras: no admite cantidades con decimales'
      using errcode = 'P0005';
  end if;

  v_new_quantity := round(v_current_quantity + p_quantity_delta, 3);
  v_new_reserved := round(v_current_reserved + p_reserved_delta, 3);

  if v_new_quantity < 0 then
    raise exception 'Stock insuficiente: quedan %, se intentó descontar %',
      v_current_quantity, -p_quantity_delta
      using errcode = 'P0002';
  end if;

  if v_new_reserved < 0 then
    raise exception 'No hay reserva suficiente para liberar en producto %', p_product_id
      using errcode = 'P0003';
  end if;

  if v_new_reserved > v_new_quantity then
    raise exception 'No hay suficiente stock disponible para reservar en producto %', p_product_id
      using errcode = 'P0004';
  end if;

  update products
    set stock_quantity = v_new_quantity,
        stock_reserved = v_new_reserved
    where id = p_product_id;

  insert into inventory_movements (
    product_id, movement_type, quantity, reference_type, reference_id, reason, created_by
  ) values (
    p_product_id, p_movement_type, p_quantity_delta, p_reference_type, p_reference_id, p_reason, p_created_by
  );

  return query select v_new_quantity, v_new_reserved;
end;
$$ language plpgsql security definer;

revoke execute on function adjust_stock(uuid, numeric, numeric, stock_movement_type, text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function adjust_stock(uuid, numeric, numeric, stock_movement_type, text, uuid, text, uuid)
  to service_role;

-- ------------------------------------------------------------
-- 4. create_order con cantidades decimales
--
-- La firma NO cambia (las cantidades viajan dentro del jsonb), así que
-- alcanza con reemplazar el cuerpo. Es el mismo de la migración 0019 —
-- mismo bloqueo por producto en orden fijo, misma regla de precio
-- mayorista, misma reserva de stock — con tres diferencias:
--   * las cantidades se leen como numeric y se redondean a 3 decimales;
--   * un producto sin decimal_quantity solo acepta cantidades enteras;
--   * las variables de cantidad y de disponible son numeric.
-- ------------------------------------------------------------
create or replace function create_order(
  p_customer_id uuid,
  p_fulfillment_method fulfillment_method,
  p_items jsonb,  -- [{"product_id": "...", "quantity": 2.5}, ...]
  p_shipping_address_street text default null,
  p_shipping_address_city text default null,
  p_notes text default null,
  p_price_preference text default 'mayorista'
)
returns uuid as $$
declare
  v_customer_type customer_type;
  v_order_id uuid;
  v_item jsonb;
  v_ids uuid[] := '{}';
  v_quantities numeric[] := '{}';
  v_unit_prices numeric[] := '{}';
  v_price_types text[] := '{}';
  v_vat_rates numeric[] := '{}';
  v_names text[] := '{}';
  v_line_net numeric[] := '{}';
  v_line_vat numeric[] := '{}';
  v_line_gross numeric[] := '{}';
  v_subtotal numeric := 0;
  v_vat_total numeric := 0;
  v_total numeric := 0;
  v_idx integer;
  v_available numeric;
  v_row record;
  v_product_quantity numeric;
  v_wholesale boolean;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no puede estar vacío' using errcode = 'P1001';
  end if;

  if p_price_preference is null or p_price_preference not in ('mayorista', 'minorista') then
    raise exception 'Tipo de precio inválido' using errcode = 'P1006';
  end if;

  if p_customer_id is not null then
    select customer_type into v_customer_type from customer_profiles where id = p_customer_id;
  end if;
  if v_customer_type is null then
    v_customer_type := 'minorista';
  end if;

  -- Orden fijo por product_id: evita deadlocks entre pedidos concurrentes
  -- que bloquean los mismos productos.
  for v_item in
    select value from jsonb_array_elements(p_items) order by (value ->> 'product_id')
  loop
    v_ids := array_append(v_ids, (v_item ->> 'product_id')::uuid);
    v_quantities := array_append(v_quantities, round((v_item ->> 'quantity')::numeric, 3));
  end loop;

  -- Fase 1: bloquear cada producto, validar y tomar el precio real
  -- (nunca el que mandó el navegador).
  for v_idx in 1 .. array_length(v_ids, 1) loop
    if v_quantities[v_idx] <= 0 then
      raise exception 'Cantidad inválida para un producto del pedido' using errcode = 'P1002';
    end if;

    select id, name, active, price_retail, price_wholesale, vat_rate,
           stock_quantity, stock_reserved, wholesale_min_quantity, decimal_quantity
      into v_row
      from products
      where id = v_ids[v_idx]
      for update;

    if not found or not v_row.active then
      raise exception 'Un producto del pedido ya no está disponible' using errcode = 'P1003';
    end if;

    -- Decimales solo donde están habilitados. Así un producto que se
    -- vende por unidad no puede venderse "a medias" por más que el
    -- navegador mande otra cosa.
    if not v_row.decimal_quantity and v_quantities[v_idx] <> round(v_quantities[v_idx]) then
      raise exception '"%" se vende por unidades enteras', v_row.name using errcode = 'P1002';
    end if;

    v_available := v_row.stock_quantity - v_row.stock_reserved;
    if v_available < v_quantities[v_idx] then
      raise exception 'Sin stock suficiente de "%": quedan % disponibles', v_row.name, v_available
        using errcode = 'P1004';
    end if;

    -- Mínimo por producto: cuenta la cantidad total de ESE producto en el
    -- pedido (por si llegara repartido en más de un renglón).
    select coalesce(sum((value ->> 'quantity')::numeric), 0)
      into v_product_quantity
      from jsonb_array_elements(p_items)
      where (value ->> 'product_id')::uuid = v_ids[v_idx];

    v_wholesale := v_customer_type = 'mayorista'
      and p_price_preference = 'mayorista'
      and v_product_quantity >= v_row.wholesale_min_quantity;

    v_names := array_append(v_names, v_row.name);
    v_unit_prices := array_append(
      v_unit_prices,
      case when v_wholesale then v_row.price_wholesale else v_row.price_retail end
    );
    v_price_types := array_append(v_price_types, case when v_wholesale then 'wholesale' else 'retail' end);
    v_vat_rates := array_append(v_vat_rates, v_row.vat_rate);
  end loop;

  -- Fase 2: calcular subtotales. Los precios están cargados CON IVA
  -- incluido (como se muestran en la web); acá se discrimina cuánto
  -- de ese total es neto y cuánto es IVA, redondeando al centavo.
  for v_idx in 1 .. array_length(v_ids, 1) loop
    v_line_gross[v_idx] := round(v_unit_prices[v_idx] * v_quantities[v_idx], 2);
    v_line_net[v_idx] := round(v_line_gross[v_idx] / (1 + v_vat_rates[v_idx] / 100), 2);
    v_line_vat[v_idx] := v_line_gross[v_idx] - v_line_net[v_idx];

    v_subtotal := v_subtotal + v_line_net[v_idx];
    v_vat_total := v_vat_total + v_line_vat[v_idx];
    v_total := v_total + v_line_gross[v_idx];
  end loop;

  -- Fase 3: crear el pedido
  insert into orders (
    customer_id, status, fulfillment_method, customer_type_at_purchase, price_preference,
    subtotal, vat_amount, total, shipping_address_street, shipping_address_city, notes
  ) values (
    p_customer_id, 'pending_payment', p_fulfillment_method, v_customer_type, p_price_preference,
    v_subtotal, v_vat_total, v_total, p_shipping_address_street, p_shipping_address_city, p_notes
  )
  returning id into v_order_id;

  insert into order_status_history (order_id, from_status, to_status) values
    (v_order_id, null, 'created'),
    (v_order_id, 'created', 'pending_payment');

  -- Fase 4: crear los items y reservar stock (todavía no se descuenta,
  -- solo se aparta para que otro cliente no se lo lleve mientras este
  -- todavía está pagando).
  for v_idx in 1 .. array_length(v_ids, 1) loop
    insert into order_items (
      order_id, product_id, product_name_snapshot, quantity, unit_price, price_type, vat_rate, subtotal
    ) values (
      v_order_id, v_ids[v_idx], v_names[v_idx], v_quantities[v_idx],
      v_unit_prices[v_idx], v_price_types[v_idx], v_vat_rates[v_idx], v_line_net[v_idx]
    );

    update products
      set stock_reserved = stock_reserved + v_quantities[v_idx]
      where id = v_ids[v_idx];

    insert into inventory_movements (
      product_id, movement_type, quantity, reference_type, reference_id, reason
    ) values (
      v_ids[v_idx], 'reserva', v_quantities[v_idx], 'order', v_order_id, 'Reserva por checkout'
    );
  end loop;

  return v_order_id;
end;
$$ language plpgsql security definer;

revoke execute on function create_order(uuid, fulfillment_method, jsonb, text, text, text, text)
  from public, anon, authenticated;
grant execute on function create_order(uuid, fulfillment_method, jsonb, text, text, text, text)
  to service_role;

-- ------------------------------------------------------------
-- 5. retry_order_payment: la única otra función que declaraba el
--    disponible como entero. Mismo cuerpo de la migración 0010.
-- ------------------------------------------------------------
create or replace function retry_order_payment(p_order_id uuid)
returns void as $$
declare
  v_current_status order_status;
  v_item record;
  v_row record;
  v_available numeric;
  v_approved_count integer;
begin
  select status into v_current_status from orders where id = p_order_id for update;

  if not found then
    raise exception 'Pedido % no existe', p_order_id using errcode = 'P1005';
  end if;

  if v_current_status <> 'payment_failed' then
    raise exception 'El pedido % no está en payment_failed (está en %)', p_order_id, v_current_status
      using errcode = 'P1006';
  end if;

  -- Defensa en profundidad: nunca reintentar si ya existe un pago
  -- aprobado para este pedido, aunque el status del pedido por alguna
  -- inconsistencia diga otra cosa.
  select count(*) into v_approved_count
    from payments
    where order_id = p_order_id and status = 'approved';

  if v_approved_count > 0 then
    raise exception 'El pedido % ya tiene un pago aprobado, no se puede reintentar', p_order_id
      using errcode = 'P1007';
  end if;

  -- Se bloquean los productos por id (mismo orden que create_order)
  -- para evitar deadlocks contra otros checkouts concurrentes.
  for v_item in
    select oi.product_id, oi.quantity
      from order_items oi
      where oi.order_id = p_order_id
      order by oi.product_id
  loop
    select stock_quantity, stock_reserved, name, active
      into v_row
      from products
      where id = v_item.product_id
      for update;

    if not found or not v_row.active then
      raise exception 'Un producto del pedido ya no está disponible' using errcode = 'P1003';
    end if;

    v_available := v_row.stock_quantity - v_row.stock_reserved;
    if v_available < v_item.quantity then
      raise exception 'Sin stock suficiente de "%": quedan % disponibles', v_row.name, v_available
        using errcode = 'P1004';
    end if;

    update products
      set stock_reserved = stock_reserved + v_item.quantity
      where id = v_item.product_id;

    insert into inventory_movements (
      product_id, movement_type, quantity, reference_type, reference_id, reason
    ) values (
      v_item.product_id, 'reserva', v_item.quantity, 'order', p_order_id, 'Reserva por reintento de pago'
    );
  end loop;

  update orders set status = 'pending_payment' where id = p_order_id;
  insert into order_status_history (order_id, from_status, to_status)
    values (p_order_id, v_current_status, 'pending_payment');
end;
$$ language plpgsql security definer;

revoke execute on function retry_order_payment from public, anon, authenticated;
grant execute on function retry_order_payment to service_role;

-- ------------------------------------------------------------
-- 6. search_path fijo en las funciones que esta migración volvió a
--    crear, igual que las dejó la migración 0023 (aviso de seguridad
--    "Function Search Path Mutable" de Supabase).
-- ------------------------------------------------------------
do $$
declare
  v_fn record;
begin
  for v_fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('adjust_stock', 'create_order', 'retry_order_payment')
  loop
    execute format('alter function %s set search_path = public, pg_temp', v_fn.sig);
  end loop;
end $$;
