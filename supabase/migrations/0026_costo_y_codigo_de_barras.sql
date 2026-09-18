-- ============================================================
-- 0026_costo_y_codigo_de_barras.sql
-- Dos datos nuevos del producto, los dos opcionales:
--
-- 1. cost_net — precio de COSTO sin IVA, como viene en la factura del
--    proveedor. Con esto los reportes pueden mostrar margen: hoy se sabe
--    cuánto entró, pero no cuánto se ganó.
--
--    Se guarda neto (sin IVA) a propósito: es el número que figura en la
--    factura de compra, y el IVA de la compra se recupera. Ojo con no
--    compararlo contra el precio de venta tal cual, que está cargado CON
--    IVA: los reportes comparan neto contra neto.
--
-- 2. barcode — el código de barras del envase, el que lee el escáner.
--    Es distinto del SKU: el SKU lo pone Casa Periotti y el código de
--    barras viene impreso de fábrica. Único cuando está cargado, para que
--    un escaneo no pueda dar dos productos.
--
-- Los dos quedan en null en todos los productos existentes: nada cambia
-- de comportamiento hasta que alguien los complete.
-- ============================================================

alter table products
  add column cost_net numeric(12, 2) check (cost_net is null or cost_net >= 0),
  add column barcode text;

comment on column products.cost_net is
  'Precio de costo SIN IVA, como figura en la factura del proveedor. Opcional; los reportes calculan margen solo con los productos que lo tienen cargado.';
comment on column products.barcode is
  'Código de barras del envase (EAN/UPC), el que lee el escáner del mostrador. Distinto del SKU, que lo asigna Casa Periotti.';

-- Único solo entre los que tienen código: varios productos sin código no
-- se estorban entre sí (un índice único común trataría los null como
-- distintos, pero así queda explícito).
create unique index products_barcode_key on products (barcode) where barcode is not null;
create index products_barcode_search_idx on products (barcode);
