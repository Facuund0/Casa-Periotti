-- ============================================================
-- 0017_invoice_decision.sql
-- La letra del comprobante la decide el padrón de ARCA, no el cliente.
--
-- Antes, pedir "Factura A" dejaba al cliente como Responsable Inscripto
-- para siempre y la letra salía de esa declaración. Ahora:
--   * El cliente elige solo entre Consumidor Final (por defecto) y
--     "Factura con datos fiscales" (CUIT). Con CUIT, el padrón decide la
--     letra y la condición en CADA emisión (ver invoice-decision.ts).
--   * Consumidor Final que supera el umbral de ARCA se identifica con DNI.
--   * El umbral vive en business_settings, editable por el super_admin.
--   * Cada factura guarda el código de condición del receptor que se le
--     mandó a ARCA y si la condición quedó verificada contra el padrón.
-- ============================================================

-- ---------- Umbral de identificación obligatoria ----------
alter table business_settings
  add column anonymous_invoice_threshold numeric(14, 2) not null default 10000000
    check (anonymous_invoice_threshold > 0);

comment on column business_settings.anonymous_invoice_threshold is
  'Monto desde el cual (igual o superior) ARCA exige identificar al Consumidor Final. Lo actualiza ARCA; se edita en /admin/configuracion-fiscal.';

-- ---------- Elección del cliente ----------
alter table customer_profiles
  add column invoice_with_fiscal_data boolean not null default false,
  add column dni text check (dni is null or dni ~ '^\d{7,8}$');

comment on column customer_profiles.invoice_with_fiscal_data is
  'true = "Factura con datos fiscales": se factura con cuit_dni y el padrón de ARCA decide la letra. false = Consumidor Final. Se guarda en cada checkout.';
comment on column customer_profiles.dni is
  'DNI para identificar al Consumidor Final cuando la compra supera el umbral de ARCA.';
comment on column customer_profiles.iva_condition is
  'Última condición informada por el padrón de ARCA para el CUIT del cliente. Solo informativa: la letra se decide consultando el padrón al emitir.';

-- Los clientes que ya venían facturando con CUIT (antes "Responsable
-- Inscripto" declarado) siguen pidiendo factura con datos fiscales; desde
-- ahora el padrón decide su letra.
update customer_profiles
set invoice_with_fiscal_data = true
where iva_condition <> 'consumidor_final'
  and cuit_dni ~ '^\d{11}$';

-- ---------- Rastro en cada factura ----------
alter table invoices
  add column receptor_iva_condition_id smallint,
  add column fiscal_verification text not null default 'not_applicable'
    check (fiscal_verification in ('not_applicable', 'verified', 'unverified'));

comment on column invoices.receptor_iva_condition_id is
  'CondicionIVAReceptorId enviado a ARCA (1 RI, 4 Exento, 5 CF, 6 Monotributo, 7 No Categorizado, 15 No Alcanzado).';
comment on column invoices.fiscal_verification is
  'not_applicable: Consumidor Final sin datos fiscales. verified: letra decidida por el padrón. unverified: se pidió factura con datos fiscales pero el padrón no respondió o no informó la condición; se emitió B y hay que revisarla (posible nota de crédito y reemisión en A).';

update invoices set fiscal_verification = 'verified' where padron_verified;
update invoices set fiscal_verification = 'unverified'
where not padron_verified and padron_note is not null;

create index invoices_fiscal_unverified_idx on invoices (created_at desc)
  where fiscal_verification = 'unverified';
