-- ============================================================
-- 0008_invoice_issue_date.sql
-- Fecha real del comprobante + condición de IVA del cliente.
-- ============================================================

-- Fecha (CbteFch) que efectivamente se mandó a ARCA al crear el
-- comprobante. El código QR obligatorio se arma con esta misma fecha:
-- si no coinciden, el QR queda inválido.
alter table invoices
  add column issue_date date;

comment on column invoices.issue_date is
  'Fecha (CbteFch) enviada a ARCA al crear el comprobante. Debe coincidir con la fecha usada para armar el QR.';

-- Condición del cliente frente al IVA. Casa Periotti es Responsable
-- Inscripto: solo puede emitir Factura A a otro Responsable Inscripto
-- con CUIT válido; a cualquier otra condición le corresponde Factura B
-- (ver resolveInvoiceTypeLetter en billing-service.ts).
alter table customer_profiles
  add column iva_condition text not null default 'consumidor_final'
    check (iva_condition in ('consumidor_final', 'responsable_inscripto', 'monotributista', 'exento'));

comment on column customer_profiles.iva_condition is
  'Condición del cliente frente al IVA. Determina si corresponde Factura A (responsable_inscripto con CUIT) o B (cualquier otro caso).';
