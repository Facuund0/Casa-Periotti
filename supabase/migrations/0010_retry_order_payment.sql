-- ============================================================
-- 0010_retry_order_payment.sql
-- Permite reintentar el pago de un pedido que quedó en
-- payment_failed, re-reservando stock si sigue disponible, en vez de
-- obligar al cliente a rehacer el carrito completo. Protege contra
-- doble cobro: nunca reintenta si ya existe un pago aprobado para ese
-- pedido, sin importar lo que diga el status del pedido.
-- ============================================================

create or replace function retry_order_payment(p_order_id uuid)
returns void as $$
declare
  v_current_status order_status;
  v_item record;
  v_row record;
  v_available integer;
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
