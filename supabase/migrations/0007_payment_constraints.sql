-- ============================================================
-- 0007_payment_constraints.sql
-- Un pedido no puede tener dos pagos "vivos" al mismo tiempo. Esto
-- es una segunda barrera (además de la que hace el código en
-- PaymentService) contra doble clic, doble submit o una carrera
-- entre dos pestañas del navegador.
-- ============================================================

create unique index idx_payments_one_active_per_order
  on payments (order_id)
  where status in ('pending', 'processing', 'approved');
