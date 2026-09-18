-- ============================================================
-- 0030_forma_de_pago_en_cuenta_corriente.sql
--
-- Con qué pagó el cliente cada vez que baja su deuda.
--
-- Por qué hace falta. Cuando una venta fiada se cobra en parte en el
-- momento, esa plata SÍ entra al cajón, así que tiene que aparecer en el
-- cierre de caja. No se puede registrar como un segundo pago del pedido:
-- la migración 0007 pone un índice único que permite un solo pago activo
-- por pedido, y esa barrera existe para que nadie cobre dos veces el
-- mismo pedido. No se toca.
--
-- Entonces el pago del momento vive donde corresponde: como movimiento
-- de la cuenta corriente. Lo único que le faltaba era decir con qué se
-- pagó, para poder sumarlo al cierre de caja por medio de pago en vez de
-- adivinarlo de una nota escrita a mano.
--
-- Los movimientos que ya existen quedan con method en null, que se
-- muestra como "sin especificar": no se inventa un medio que nadie cargó.
-- ============================================================

alter table customer_account_movements
  add column method text
    check (method is null or method in ('efectivo', 'transferencia', 'tarjeta', 'otro'));

comment on column customer_account_movements.method is
  'Con qué pagó el cliente (solo en los movimientos de tipo pago). null = no se registró. Lo usa el cierre de caja para sumar las cobranzas por medio de pago.';

-- Las cobranzas del período se leen por fecha y tipo: este índice evita
-- recorrer toda la tabla cuando crezca.
create index idx_account_movements_pagos
  on customer_account_movements (created_at desc)
  where kind = 'pago';
