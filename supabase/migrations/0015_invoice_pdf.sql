-- ============================================================
-- 0015_invoice_pdf.sql
-- Ruta del PDF imprimible de cada factura.
--
-- ARCA no genera el impreso: el web service solo devuelve el CAE. El
-- comprobante en papel lo arma el sistema (ver invoice-pdf.ts) y se
-- guarda en el bucket privado 'facturas' de Storage; acá queda la
-- referencia.
--
-- Se guarda la ruta y no el archivo: la normativa obliga a conservar el
-- comprobante por años, y un bucket es el lugar para eso, no una
-- columna de la base.
--
-- Es nullable a propósito: una factura recién insertada todavía no
-- tiene PDF (se genera después del CAE), y las que se emitieron antes
-- de esta migración tampoco. Se genera al pedirlo, así que las viejas
-- se completan solas la primera vez que alguien las descarga o
-- reenvía.
-- ============================================================

alter table invoices
  add column pdf_path text;

comment on column invoices.pdf_path is
  'Ruta dentro del bucket privado "facturas" de Storage. Null = todavía no se generó el PDF; se genera al pedirlo.';
