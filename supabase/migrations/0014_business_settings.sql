-- ============================================================
-- 0014_business_settings.sql
-- Datos fiscales del emisor (Casa Periotti).
--
-- Hasta ahora el CUIT y el punto de venta vivían en variables de
-- entorno (ARCA_CUIT, ARCA_SALES_POINT) y el resto de los datos que
-- toda factura tiene que mostrar impresos —razón social, domicilio
-- comercial, Ingresos Brutos, fecha de inicio de actividades— no
-- existían en ningún lado. Sin eso no se puede emitir un comprobante
-- impreso válido.
--
-- Van en la base y no en variables de entorno por dos razones: los
-- cambia el dueño desde /admin/configuracion-fiscal sin depender de un
-- deploy, y cada cambio queda registrado en audit_logs (un cambio de
-- CUIT o de punto de venta afecta la numeración de los comprobantes:
-- tiene que quedar rastro de quién lo hizo y cuándo).
--
-- Tabla de una sola fila, igual que payment_settings: el id fijo 1 con
-- un CHECK evita que se generen varias configuraciones en paralelo y
-- tener que adivinar cuál es la vigente.
-- ============================================================

create table business_settings (
  id integer primary key default 1 check (id = 1),

  -- Razón social: el nombre legal, tal como figura en la constancia de
  -- inscripción. Es el que va impreso en la factura.
  legal_name text,
  -- Nombre de fantasía: el comercial ("Casa Periotti"). Puede diferir
  -- de la razón social y no lo reemplaza.
  trade_name text,

  cuit text,

  -- Domicilio comercial, desglosado para poder imprimirlo bien
  -- formateado en el comprobante.
  address_street text,
  address_city text,
  address_province text,
  address_postal_code text,

  -- Condición del EMISOR frente al IVA. Determina qué comprobantes
  -- puede emitir: siendo Responsable Inscripto, Factura A a otro
  -- Responsable Inscripto y B al resto (ver resolveInvoiceTypeLetter en
  -- billing-service.ts).
  iva_condition text check (
    iva_condition in ('responsable_inscripto', 'monotributista', 'exento')
  ),

  -- Número de inscripción en Ingresos Brutos (o Convenio Multilateral).
  gross_income_number text,
  activities_start_date date,

  -- Punto de venta habilitado en ARCA. Reemplaza a ARCA_SALES_POINT.
  sales_point integer,

  contact_email text,
  contact_phone text,

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create trigger trg_business_settings_updated_at before update on business_settings
  for each row execute function set_updated_at();

-- Fila inicial vacía: la página de configuración siempre encuentra algo
-- que editar, y la facturación puede distinguir "todavía no se cargaron
-- los datos fiscales" de "no existe la fila".
insert into business_settings (id) values (1);

alter table business_settings enable row level security;

-- Los empleados los leen (la facturación y el PDF los necesitan), pero
-- solo el super_admin los edita: un CUIT o un punto de venta mal
-- cargado invalida todos los comprobantes que se emitan después.
create policy "Empleados ven los datos fiscales" on business_settings
  for select using (is_employee());

create policy "Super admin edita los datos fiscales" on business_settings
  for update using (has_employee_role('super_admin'));
