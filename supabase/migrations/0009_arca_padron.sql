-- ============================================================
-- 0009_arca_padron.sql
-- Trazabilidad de la verificación contra el padrón de ARCA al emitir
-- una factura con datos declarados (CUIT + condición de IVA).
-- ============================================================

alter table invoices
  -- true solo cuando se pudo consultar el padrón de ARCA
  -- (ws_sr_padron_a13) y se usó su respuesta para confirmar o corregir
  -- la condición de IVA declarada por el comprador.
  add column padron_verified boolean not null default false,

  -- Explica qué pasó con la verificación: si el padrón contradijo lo
  -- declarado (y con qué se corrigió), o si no se pudo consultar y por
  -- qué se facturó igual según los datos declarados.
  add column padron_note text;

comment on column invoices.padron_verified is
  'true si se confirmó la condición de IVA del comprador contra el padrón de ARCA antes de emitir. false = se facturó según lo declarado sin poder verificar.';

comment on column invoices.padron_note is
  'Detalle legible de la verificación contra el padrón: coincide, fue corregida, o no se pudo consultar.';
