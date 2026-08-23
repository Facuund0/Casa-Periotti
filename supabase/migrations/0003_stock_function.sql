-- ============================================================
-- 0003_stock_function.sql
-- Ajuste de stock 100% atómico: lock de fila + validación +
-- movimiento registrado, todo en una sola transacción.
-- ============================================================

-- delta positivo = entra stock (compra, ajuste hacia arriba, devolución)
-- delta negativo = sale stock (venta, merma, ajuste hacia abajo)
--
-- reserved_delta se usa para el flujo de checkout: cuando el cliente
-- inicia el pago se "reserva" stock (no se descuenta todavía, pero
-- deja de estar disponible para otro comprador). Cuando se confirma
-- el pago, se libera la reserva Y se descuenta el stock real en el
-- mismo movimiento de tipo 'venta'.

create or replace function adjust_stock(
  p_product_id uuid,
  p_quantity_delta integer,
  p_reserved_delta integer,
  p_movement_type stock_movement_type,
  p_reference_type text default null,
  p_reference_id uuid default null,
  p_reason text default null,
  p_created_by uuid default null
)
returns table (new_stock_quantity integer, new_stock_reserved integer) as $$
declare
  v_current_quantity integer;
  v_current_reserved integer;
  v_new_quantity integer;
  v_new_reserved integer;
begin
  -- Bloquea la fila del producto hasta que termine esta transacción.
  -- Si dos ventas del mismo producto llegan al mismo tiempo, la segunda
  -- espera a que termine la primera antes de leer el stock. Así se
  -- evita el bug clásico de "leer-calcular-guardar" sin control de
  -- concurrencia que puede vender de más.
  select stock_quantity, stock_reserved
    into v_current_quantity, v_current_reserved
    from products
    where id = p_product_id
    for update;

  if not found then
    raise exception 'Producto % no existe', p_product_id
      using errcode = 'P0001';
  end if;

  v_new_quantity := v_current_quantity + p_quantity_delta;
  v_new_reserved := v_current_reserved + p_reserved_delta;

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

-- Solo el backend (con service_role) o empleados con rol admin/stock
-- pueden ejecutar esta función. No se expone a clientes.
revoke execute on function adjust_stock from public, anon, authenticated;
grant execute on function adjust_stock to service_role;
