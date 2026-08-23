-- ============================================================
-- 0006_create_order_function.sql
-- Crear un pedido es la operación más delicada del sistema: hay que
-- recalcular precios, verificar stock y reservarlo, todo sin dejar
-- huecos donde algo pueda quedar a mitad de camino. Por eso vive
-- entera en una función de Postgres: una función = una transacción,
-- así que si algo falla a mitad de camino, TODO se deshace solo.
--
-- Además: los cálculos de plata se hacen con "numeric" de Postgres,
-- que es aritmética decimal exacta (no como el float de JavaScript),
-- así que el redondeo de precios nunca genera un centavo de diferencia.
-- ============================================================

create or replace function create_order(
  p_customer_id uuid,
  p_fulfillment_method fulfillment_method,
  p_items jsonb,  -- [{"product_id": "...", "quantity": 2}, ...]
  p_shipping_address_street text default null,
  p_shipping_address_city text default null,
  p_notes text default null
)
returns uuid as $$
declare
  v_customer_type customer_type;
  v_order_id uuid;
  v_item jsonb;
  v_ids uuid[] := '{}';
  v_quantities integer[] := '{}';
  v_unit_prices numeric[] := '{}';
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
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no puede estar vacío' using errcode = 'P1001';
  end if;

  -- El tipo de cliente (minorista/mayorista) se lee SIEMPRE de la base
  -- de datos acá adentro. Nunca se recibe como parámetro desde afuera,
  -- así nadie puede mandar "soy mayorista" desde el navegador.
  if p_customer_id is not null then
    select customer_type into v_customer_type from customer_profiles where id = p_customer_id;
  end if;
  if v_customer_type is null then
    v_customer_type := 'minorista';
  end if;

  -- Ordenar los productos por id antes de bloquearlos: si dos
  -- checkouts concurrentes piden los mismos dos productos en distinto
  -- orden, bloquear siempre en el mismo orden evita un deadlock.
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
           stock_quantity, stock_reserved
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

    v_names := array_append(v_names, v_row.name);
    v_unit_prices := array_append(
      v_unit_prices,
      case when v_customer_type = 'mayorista' then v_row.price_wholesale else v_row.price_retail end
    );
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
    customer_id, status, fulfillment_method, customer_type_at_purchase,
    subtotal, vat_amount, total, shipping_address_street, shipping_address_city, notes
  ) values (
    p_customer_id, 'pending_payment', p_fulfillment_method, v_customer_type,
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
      order_id, product_id, product_name_snapshot, quantity, unit_price, vat_rate, subtotal
    ) values (
      v_order_id, v_ids[v_idx], v_names[v_idx], v_quantities[v_idx],
      v_unit_prices[v_idx], v_vat_rates[v_idx], v_line_net[v_idx]
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

revoke execute on function create_order from public, anon, authenticated;
grant execute on function create_order to service_role;

-- ============================================================
-- Confirmar pedido pagado: convierte la reserva en descuento real
-- de stock. Es IDEMPOTENTE a propósito — si Mercado Pago manda el
-- mismo webhook dos veces, la segunda llamada no hace nada (porque
-- el pedido ya no está en un estado donde tenga sentido confirmarlo).
-- ============================================================

create or replace function confirm_order_paid(p_order_id uuid)
returns void as $$
declare
  v_current_status order_status;
  v_item record;
begin
  select status into v_current_status from orders where id = p_order_id for update;

  if not found then
    raise exception 'Pedido % no existe', p_order_id using errcode = 'P1005';
  end if;

  -- Idempotencia: si ya está pagado (o más adelante en el flujo),
  -- no hacemos nada. Esto es lo que evita procesar un webhook duplicado.
  if v_current_status not in ('pending_payment', 'payment_processing') then
    return;
  end if;

  for v_item in select product_id, quantity from order_items where order_id = p_order_id loop
    update products
      set stock_quantity = stock_quantity - v_item.quantity,
          stock_reserved = stock_reserved - v_item.quantity
      where id = v_item.product_id;

    insert into inventory_movements (
      product_id, movement_type, quantity, reference_type, reference_id, reason
    ) values (
      v_item.product_id, 'venta', -v_item.quantity, 'order', p_order_id, 'Venta confirmada'
    );
  end loop;

  update orders set status = 'paid' where id = p_order_id;
  insert into order_status_history (order_id, from_status, to_status)
    values (p_order_id, v_current_status, 'paid');
end;
$$ language plpgsql security definer;

revoke execute on function confirm_order_paid from public, anon, authenticated;
grant execute on function confirm_order_paid to service_role;

-- ============================================================
-- Liberar la reserva de stock sin confirmar la venta: pago rechazado,
-- cancelado, o el checkout quedó abandonado. También idempotente.
-- ============================================================

create or replace function release_order_reservation(p_order_id uuid, p_new_status order_status)
returns void as $$
declare
  v_current_status order_status;
  v_item record;
begin
  select status into v_current_status from orders where id = p_order_id for update;

  if not found then
    raise exception 'Pedido % no existe', p_order_id using errcode = 'P1005';
  end if;

  if v_current_status not in ('pending_payment', 'payment_processing') then
    return;
  end if;

  for v_item in select product_id, quantity from order_items where order_id = p_order_id loop
    update products
      set stock_reserved = stock_reserved - v_item.quantity
      where id = v_item.product_id;

    insert into inventory_movements (
      product_id, movement_type, quantity, reference_type, reference_id, reason
    ) values (
      v_item.product_id, 'liberacion_reserva', -v_item.quantity, 'order', p_order_id,
      'Reserva liberada: ' || p_new_status::text
    );
  end loop;

  update orders set status = p_new_status where id = p_order_id;
  insert into order_status_history (order_id, from_status, to_status)
    values (p_order_id, v_current_status, p_new_status);
end;
$$ language plpgsql security definer;

revoke execute on function release_order_reservation from public, anon, authenticated;
grant execute on function release_order_reservation to service_role;
