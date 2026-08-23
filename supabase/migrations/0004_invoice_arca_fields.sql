-- ============================================================
-- 0004_invoice_arca_fields.sql
-- Completa la tabla invoices con los campos que exige la normativa
-- vigente de ARCA para 2026 (investigado antes de programar el
-- módulo de facturación, según lo pedido).
-- ============================================================

alter table invoices
  -- Ambiente en el que se generó (nunca mezclar pruebas con producción)
  add column environment text not null default 'testing'
    check (environment in ('testing', 'production')),

  -- Código QR obligatorio desde 2026 (contiene URL de verificación de ARCA
  -- con: fecha, CUIT emisor, punto de venta, tipo y número de comprobante,
  -- importe, moneda, CAE). Se genera después de recibir el CAE, no antes.
  add column qr_data_url text,

  -- Condición frente al IVA del comprador. Determina si corresponde
  -- Factura A (a Responsable Inscripto) o B (a Consumidor Final /
  -- Monotributista / Exento). REQUIERE VALIDACIÓN CONTABLE/FISCAL para
  -- confirmar con qué condición de IVA está inscripta Casa Periotti,
  -- porque eso determina qué tipos de comprobante puede emitir.
  add column buyer_iva_condition text,

  -- IVA discriminado por ley de Transparencia Fiscal al Consumidor:
  -- aunque el precio final para el cliente no cambia, la factura B debe
  -- mostrar por separado cuánto de ese total es "IVA Contenido".
  add column iva_contenido numeric(12,2),

  -- Tipo y número de documento del comprador. Obligatorio siempre para
  -- Factura A; para Consumidor Final solo es obligatorio si la compra
  -- es >= al monto que fija ARCA (hoy $10.000.000, sujeto a cambio).
  add column buyer_document_type text default 'DNI',
  add column buyer_document_number text,

  -- Concepto del comprobante que exige WSFE: 1 = productos (nuestro caso
  -- casi siempre, por ser un corralón), 2 = servicios, 3 = ambos.
  add column concept smallint not null default 1,

  add column currency text not null default 'ARS';

comment on column invoices.environment is
  'testing = ambiente de homologación de ARCA, production = facturas reales. Nunca deben mezclarse ni compararse números de comprobante entre ambientes.';

comment on column invoices.buyer_iva_condition is
  'Ej: "Consumidor Final", "Responsable Inscripto", "Monotributista", "Exento". Lo devuelve el padrón de ARCA o lo carga el empleado manualmente.';
