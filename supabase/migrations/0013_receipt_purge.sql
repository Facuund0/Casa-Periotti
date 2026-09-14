-- ============================================================
-- 0013_receipt_purge.sql
-- Borrado del archivo de un comprobante conservando el registro.
--
-- Cuando un admin elimina un comprobante desde /admin/comprobantes, el
-- archivo se borra del bucket privado pero la fila de payment_receipts
-- NO se borra: queda marcada como purgada, con quién la borró y cuándo.
-- Así sigue constando que el comprobante existió, de qué pedido era y
-- qué se resolvió con él — que es justamente lo que hace falta si
-- después alguien audita una venta.
--
-- storage_path se conserva a propósito (no se pone en null): es parte
-- del registro histórico de qué archivo había, y su UNIQUE evita que un
-- comprobante nuevo reutilice el path de uno borrado.
--
-- No se toca el enum receipt_review_status: "purgado" no es un estado de
-- revisión sino algo que puede pasarle a un comprobante ya revisado.
-- Las dos cosas son independientes y se consultan por separado.
-- ============================================================

alter table payment_receipts
  add column purged_at timestamptz,
  add column purged_by uuid references auth.users(id);

comment on column payment_receipts.purged_at is
  'Cuándo se borró el archivo de Storage. La fila se conserva como registro de que el comprobante existió.';

-- El listado de /admin/comprobantes ordena por fecha de subida
-- descendente y paginado; sin este índice, cada página hace un sort
-- completo de la tabla.
create index idx_payment_receipts_uploaded_at on payment_receipts(uploaded_at desc);

-- Mismo motivo para el listado de /admin/facturacion, que pasó de un
-- limit(50) fijo a orden por fecha descendente con filtros y paginación.
create index idx_invoices_created_at on invoices(created_at desc);
