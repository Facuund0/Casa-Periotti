-- ============================================================
-- 0019_wholesale_minimum.sql
-- Cantidad mínima para el precio mayorista, y elección del tipo de
-- precio (mayorista/minorista) para clientes mayoristas aprobados.
--
-- Regla, única para la web y el mostrador (la aplica create_order, que
-- es la que decide el precio de todo pedido):
--   un renglón va a precio mayorista solo si
--     1. el cliente es mayorista aprobado (customer_type leído de la base),
--     2. eligió precio mayorista (p_price_preference, por defecto 'mayorista'), y
--     3. la cantidad pedida de ESE producto llega a su wholesale_min_quantity.
--   En cualquier otro caso, precio minorista. El mínimo se evalúa por
--   producto, no por el total del carrito.
--
-- create_order cambia de firma (parámetro nuevo), así que se borra la
-- versión anterior y se crea la nueva en esta misma migración: si
-- convivieran las dos, Postgres no sabría cuál llamar.
--
-- Stock: sin cambios. Mismo bloqueo de filas (for update), mismo control
-- de disponible, misma reserva y mismos movimientos de inventario que la
-- versión de la migración 0006. Solo cambia la elección del precio.
-- ============================================================

alter table products
  add column wholesale_min_quantity integer not null default 1
    check (wholesale_min_quantity >= 1);

comment on column products.wholesale_min_quantity is
  'Cantidad mínima de este producto, en un mismo pedido, para que a un mayorista aprobado se le aplique price_wholesale. 1 = sin mínimo.';

alter table orders
  add column price_preference text not null default 'mayorista'
    check (price_preference in ('mayorista', 'minorista'));

comment on column orders.price_preference is
  'Tipo de precio que eligió el cliente (o el empleado en el mostrador). Solo tiene efecto para mayoristas aprobados.';

alter table order_items
  add column price_type text not null default 'retail'
    check (price_type in ('wholesale', 'retail'));

comment on column order_items.price_type is
  'Precio aplicado a este renglón: wholesale (mayorista) o retail (minorista).';

-- Pedidos anteriores: los de mayoristas se cobraron a precio mayorista.
update order_items oi
set price_type = 'wholesale'
from orders o
where o.id = oi.order_id and o.customer_type_at_purchase = 'mayorista';

drop function if exists create_order(uuid, fulfillment_method, jsonb, text, text, text);

create function create_order(
  p_customer_id uuid,
  p_fulfillment_method fulfillment_method,
  p_items jsonb,  -- [{"product_id": "...", "quantity": 2}, ...]
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
  v_quantities integer[] := '{}';
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
  v_available integer;
  v_row record;
  v_product_quantity integer;
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
    v_quantities := array_append(v_quantities, (v_item ->> 'quantity')::integer);
  end loop;

  -- Fase 1: bloquear cada producto, validar y tomar el precio real
  -- (nunca el que mandó el navegador).
  for v_idx in 1 .. array_length(v_ids, 1) loop
    if v_quantities[v_idx] <= 0 then
      raise exception 'Cantidad inválida para un producto del pedido' using errcode = 'P1002';
    end if;

    select id, name, active, price_retail, price_wholesale, vat_rate,
           stock_quantity, stock_reserved, wholesale_min_quantity
      into v_row
      from products
      where id = v_ids[v_idx]
      for update;

    if not found or not v_row.active then
      raise exception 'Un producto del pedido ya no está disponible' using errcode = 'P1003';
    end if;

    v_available := v_row.stock_quantity - v_row.stock_reserved;
    if v_available < v_quantities[v_idx] then
      raise exception 'Sin stock suficiente de "%": quedan % disponibles', v_row.name, v_available
        using errcode = 'P1004';
    end if;

    -- Mínimo por producto: cuenta la cantidad total de ESE producto en el
    -- pedido (por si llegara repartido en más de un renglón).
    select coalesce(sum((value ->> 'quantity')::integer), 0)
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
