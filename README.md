# Casa Periotti — Sistema web + facturación

E-commerce con precios minorista/mayorista, pago por transferencia
bancaria con verificación manual del comprobante, y facturación
electrónica (ARCA), para el corralón Casa Periotti en Sunchales,
Santa Fe.

## Estado actual

- ✅ Catálogo público con precios minorista/mayorista (Sanitarios, Piscinas,
  Electricidad, Ferretería, Artefactos, Construcción, Línea Solar, Combos)
- ✅ Auth de clientes: registro, login, pedido de mayorista con aprobación
- ✅ Panel interno `/admin` con roles (admin, ventas, stock, facturación,
  super_admin) — CRUD de productos, ajuste de stock, aprobación de
  mayoristas, facturación manual
- ✅ Carrito + checkout con reserva de stock atómica (sin condiciones de
  carrera, todo en una transacción de Postgres)
- ✅ Pago por transferencia bancaria: el cliente transfiere, sube el
  comprobante (Storage privado) y un empleado lo verifica contra el
  homebanking antes de confirmar
- ✅ Facturación electrónica con ARCA (ambiente de pruebas / homologación)
- ✅ Emails transaccionales (Resend) — desacoplados, nunca bloquean una venta
- ⬜ Reportes, envíos con cálculo de flete, auditoría avanzada — quedan
  para una fase posterior

## 1. Instalar dependencias

```bash
npm install
cp .env.example .env.local
```

## 2. Conectar la base de datos (Supabase) — paso a paso

### 2.1. Conseguir tus credenciales de Supabase

1. Entrá a [supabase.com](https://supabase.com) y abrí tu proyecto (o creá uno nuevo, plan gratuito).
2. Andá a **Project Settings → API**.
3. Vas a ver tres datos: copialos a tu `.env.local`:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** (aparece tapada, hay que clickear "Reveal") → `SUPABASE_SERVICE_ROLE_KEY`

   ⚠️ La `service_role key` es la más sensible de todo el proyecto: le
   da a quien la tenga acceso total a la base, saltándose todas las
   reglas de seguridad. Nunca la compartas, nunca la subas a git (el
   `.gitignore` ya excluye `.env.local` así que no debería pasar por
   error).

### 2.2. Crear las tablas

En el panel de Supabase, andá a **SQL Editor** (ícono de rayo en el
menú lateral) → **New query**.

Las migraciones están en `supabase/migrations/`, numeradas en orden.
Abrí cada archivo, copiá **todo** su contenido, pegalo en el SQL
Editor, y apretá **Run**. Hacelo **en este orden exacto**, uno por vez,
esperando a que cada uno termine sin error antes de pasar al siguiente:

```
0001_init.sql
0002_auth_and_roles.sql
0003_stock_function.sql
0004_invoice_arca_fields.sql
0005_checkout_and_emails.sql
0006_create_order_function.sql
0007_payment_constraints.sql
0008_invoice_issue_date.sql
0009_arca_padron.sql
0010_retry_order_payment.sql
0011_arca_voucher_lock.sql
0012_payment_transfer.sql
0013_receipt_purge.sql
0014_business_settings.sql
0015_invoice_pdf.sql
```

Si en algún momento agregás una migración nueva (`0016_...sql`), el
mismo mecanismo: se corre una sola vez, a mano, en el SQL Editor.

Los buckets de Storage no los crean las migraciones: hay que crearlos a
mano en el panel de Supabase, los dos **privados** —
`comprobantes` (comprobantes de transferencia que sube el cliente) y
`facturas` (PDF de los comprobantes emitidos).

### 2.3. Generar los tipos de TypeScript desde tu base real (opcional pero recomendado)

Esto te da autocompletado real de nombres de columnas en el editor, y
hace que TypeScript te avise en rojo si escribís mal el nombre de una
columna en algún lado.

```bash
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
npx supabase gen types typescript --linked > src/shared/types/database.ts
```

El `TU_PROJECT_REF` es la parte de tu URL de Supabase antes de
`.supabase.co` (ej: si tu URL es `https://abcdefgh.supabase.co`, el
ref es `abcdefgh`).

Después de generar los tipos, en estos 3 archivos volvé a agregar el
genérico `<Database>` que por ahora está sacado a propósito (para que
el proyecto compile aunque todavía no hayas generado los tipos reales):

- `src/infrastructure/database/supabase-browser.ts`
- `src/infrastructure/database/supabase-server.ts`
- `src/infrastructure/database/supabase-admin.ts`

Por ejemplo, en `supabase-browser.ts` cambiás `createBrowserClient(...)`
por `createBrowserClient<Database>(...)` y agregás el import
`import type { Database } from "@/shared/types/database";` arriba.

### 2.4. Crear tu primer usuario (super_admin)

Hasta que exista un `super_admin`, nadie puede dar de alta empleados
desde el panel (es intencional, por seguridad — nadie puede
auto-otorgarse permisos). Se hace **una sola vez**, a mano:

1. Corré `npm run dev` y andá a `http://localhost:3000/registro`.
2. Registrate como cliente normal, con tu email real.
3. Confirmá el email (Supabase te manda un correo de confirmación —
   revisá también spam).
4. En el **SQL Editor** de Supabase, ejecutá (reemplazando el email):

```sql
insert into employee_profiles (id, full_name, role)
select id, 'Tu Nombre', 'super_admin'
from auth.users
where email = 'tu-email@casaperiotti.com.ar';
```

5. Iniciá sesión con esa cuenta y entrá a `/admin`. Ya podés cargar
   productos, y más adelante dar de alta al resto de los empleados
   (esa pantalla de gestión de empleados queda para una fase
   siguiente — por ahora se hace también por SQL Editor, mismo patrón).

### 2.5. Correr el proyecto

```bash
npm run dev
```

Abrí `http://localhost:3000`.

## 3. Configurar el pago por transferencia

No hace falta ninguna credencial de terceros: el pago es por
transferencia bancaria y lo verifica una persona.

1. **Crear el bucket de comprobantes.** En el dashboard de Supabase →
   **Storage** → **New bucket**, nombre `comprobantes`, y dejalo
   **privado** (el toggle "Public bucket" APAGADO). Los comprobantes se
   sirven siempre con URLs firmadas de 5 minutos generadas desde el
   backend — nunca con una URL pública.
2. **Cargar los datos bancarios.** Entrá al panel como `admin` o
   `super_admin` → **Configuración de pago** (`/admin/configuracion-pago`)
   y completá alias y/o CBU, titular y banco. Con al menos uno de alias
   o CBU alcanza. Mientras no haya ninguno de los dos, el checkout no
   toma pedidos (evita reservar stock que nadie va a poder pagar).
   Estos datos viven en la base (tabla `payment_settings`), no en
   variables de entorno, así que se cambian sin deploy y cada cambio
   queda en `audit_logs`.
3. **Ajustar el plazo de pago** (opcional): `PAYMENT_TRANSFER_WINDOW_MINUTES`
   en las variables de entorno, por defecto 30 minutos. Ese mismo valor
   lo usan el reloj que ve el cliente y el proceso que cancela los
   pedidos vencidos — sale de un único lugar
   (`src/modules/payments/transfer-config.ts`), no se duplica.

### Cómo funciona, de punta a punta

1. El cliente confirma el pedido → se reserva el stock y arranca el
   plazo.
2. Ve el alias/CBU, el **monto exacto** y un **código de referencia**
   (`CP-000116`, derivado del número de pedido) con un reloj.
3. Transfiere y sube el comprobante (imagen o PDF, hasta 10 MB — se
   valida tipo y tamaño en el navegador *y* en el servidor).
4. El pedido queda en **"esperando confirmación de pago"**.
5. Un empleado con rol `ventas`, `admin` o `super_admin` lo ve en
   **Pedidos** (`/admin/pedidos`) con el comprobante adjunto, el monto y
   la hora del pedido bien visibles para cruzarlos con el homebanking
   (muchos clientes no ponen la referencia en la transferencia).
6. **Confirmar** dispara exactamente el mismo flujo que antes disparaba
   un pago aprobado: descuento real de stock, factura con ARCA y email
   al cliente. **Rechazar** libera la reserva de stock.

⚠️ Un pedido que ya tiene comprobante subido **nunca** se cancela
automáticamente, por más vencido que esté: el cliente pagó, aunque se
haya pasado del plazo. Lo resuelve una persona desde el panel.

## 4. Conectar ARCA (ambiente de pruebas)

1. Entrá a [app.afipsdk.com](https://app.afipsdk.com) y registrate gratis.
2. Sacá tu **Access Token** → `AFIPSDK_ACCESS_TOKEN`.
3. Dejá `ARCA_ENVIRONMENT=testing` — así el sistema usa un CUIT de
   prueba público que ya está habilitado para facturar en el ambiente
   de homologación de ARCA, sin que Casa Periotti necesite certificado
   propio todavía.
4. Cuando Casa Periotti tenga certificado digital real y punto de
   venta habilitado (esto se tramita con clave fiscal nivel 3, ver
   `docs/arca.md` más abajo), se cambia `ARCA_ENVIRONMENT=production`.
   El CUIT y el punto de venta **no** son variables de entorno: se
   cargan en el panel (paso siguiente).

### 4.1. Cargar los datos fiscales del negocio (obligatorio para facturar)

Toda factura tiene que mostrar impresos la razón social, el domicilio
comercial, el CUIT, la condición frente al IVA, Ingresos Brutos y la
fecha de inicio de actividades del emisor. Esos datos viven en la base
(tabla `business_settings`), no en variables de entorno, para que se
puedan corregir sin un deploy y para que cada cambio quede registrado
en `audit_logs`.

Entrá a **/admin/configuracion-fiscal** (solo `super_admin`) y cargá:

| Campo | Obligatorio | Se usa para |
|---|---|---|
| Razón social | Sí | Cabecera de la factura |
| Nombre de fantasía | No | Cabecera (además de la razón social) |
| CUIT | Sí | ARCA, código QR y código de barras |
| Condición frente al IVA | Sí | Decidir si corresponde Factura A o B |
| Domicilio comercial (calle y localidad) | Sí | Cabecera de la factura |
| Provincia y código postal | No | Cabecera |
| Ingresos Brutos | No | Cabecera (si falta se imprime "NR") |
| Inicio de actividades | No | Cabecera (si falta se imprime "NR") |
| Punto de venta de ARCA | Sí | Numeración de los comprobantes |
| Email y teléfono | No | Cabecera |

Mientras falte alguno de los obligatorios, la facturación corta con un
mensaje que dice exactamente qué falta, y el aviso también aparece
arriba en /admin/facturacion.

### 4.2. Bucket para los PDF de las facturas

ARCA no genera el comprobante impreso: solo devuelve el CAE. El PDF lo
arma el sistema y lo guarda en Storage. Creá en Supabase un bucket
llamado **`facturas`**, **privado** (sin acceso público) — se sirve solo
con URL firmada desde el backend, igual que `comprobantes`.

El PDF incluye la letra en recuadro, el detalle de items, el IVA según
la letra, el CAE con su vencimiento, el código QR y el código de barras
Interleaved 2 of 5 que exige la RG 1702. Desde /admin/facturacion se
puede imprimir y reenviar por email.

## 5. Conectar el email (opcional para probar, recomendado para producción)

1. Entrá a [resend.com](https://resend.com) y registrate (tiene plan gratis).
2. Verificá tu dominio (`casaperiotti.com.ar`) o usá el dominio de
   pruebas que te da Resend mientras desarrollás.
3. Sacá tu API Key → `RESEND_API_KEY`.

Si dejás `RESEND_API_KEY` vacío, el sistema sigue funcionando
normalmente — los emails simplemente no se envían, pero queda todo
registrado en la tabla `email_events` para no perder el rastro.

## 6. Liberar reservas de stock abandonadas (cron job)

Cuando un cliente crea un pedido (`create_order`) el stock se **reserva**
al toque, antes de que pague. Si nunca transfiere, esa reserva no se
libera sola: hay que vencerla.

`GET /api/cron/release-stale-reservations` recorre los pedidos en
`pending_payment` o `payment_processing` creados hace más de
`PAYMENT_TRANSFER_WINDOW_MINUTES` (`created_at`, el mismo punto desde el
que corre el reloj que ve el cliente) y llama a
`release_order_reservation(id, 'cancelled')` para cada uno — la misma
función de Postgres que usa el rechazo manual de un comprobante, así que
es idempotente y segura de correr las veces que haga falta.

**Nunca cancela un pedido que ya tiene comprobante subido**, por más
vencido que esté — esos quedan esperando revisión humana en
`/admin/pedidos`. La respuesta los informa aparte, en
`skippedWithReceipt`.

⚠️ **En desarrollo local nadie llama a este cron** (no hay Vercel Cron
corriendo tu `localhost`) — es normal ver `stock_reservado` > 0 en
`/admin/productos` después de abandonar unos cuantos checkouts de
prueba, no es un bug. Para esos casos hay un botón **"Liberar reservas
vencidas"** arriba de la tabla de productos que dispara exactamente la
misma lógica (`OrderService.releaseStaleReservations()`) a mano. En
producción, configurá el disparador externo siguiendo los pasos de
abajo — ahí sí corre solo cada 10 minutos sin que nadie tenga que
apretar nada.

### 6.1. Generar el secreto

```bash
openssl rand -hex 32
```

Guardá ese valor en `CRON_SECRET` (tanto en `.env.local` para probarlo
local como, más abajo, en las variables de entorno de Vercel).

### 6.2. Cron de Vercel (red de respaldo, diario)

El archivo `vercel.json` en la raíz ya define los dos crons. JSON no
admite comentarios, así que la aclaración queda acá: el plan **Hobby**
de Vercel solo permite **un cron por día**, así que ambos están en
`"0 4 * * *"` (4am UTC). Eso alcanza como red de respaldo, pero **no**
para hacer cumplir un plazo de 30 minutos — para eso está el
disparador externo de abajo.

```json
{
  "crons": [
    { "path": "/api/cron/release-stale-reservations", "schedule": "0 4 * * *" },
    { "path": "/api/cron/bill-unbilled-orders", "schedule": "0 4 * * *" }
  ]
}
```

Si el proyecto pasa a plan **Pro**, se puede subir a `"*/10 * * * *"` y
`"*/5 * * * *"` respectivamente y prescindir del disparador externo.

### 6.3. Disparador externo cada 10 minutos (el que hace cumplir el plazo)

Con un plazo de pago de 30 minutos, un cron diario dejaría el stock
reservado hasta 24 horas. La solución sin costo es un disparador
externo gratuito. Con [cron-job.org](https://cron-job.org):

1. Creá una cuenta y entrá a **Create cronjob**.
2. **URL** (exacta, con `https://` y sin barra final):

   ```
   https://casa-periotti.vercel.app/api/cron/release-stale-reservations
   ```

   (reemplazá el dominio si usás uno propio, ej.
   `https://casaperiotti.com.ar/api/cron/release-stale-reservations`)

3. **Schedule**: "Every 10 minutes" (o expresión `*/10 * * * *`).
4. **Advanced** → **Headers** → agregá un header:

   | Header          | Valor                    |
   | --------------- | ------------------------ |
   | `Authorization` | `Bearer TU_CRON_SECRET`  |

   Reemplazá `TU_CRON_SECRET` por el valor exacto que pusiste en la
   variable de entorno `CRON_SECRET` de Vercel. El endpoint compara ese
   header con `timingSafeEqual` y responde `401` si no coincide —
   cualquiera que no tenga el secreto no puede dispararlo.
5. **Method**: `GET`. Guardá y activalo.

Conviene hacer lo mismo con `/api/cron/bill-unbilled-orders` (cada 10
minutos también está bien) — usa el mismo `CRON_SECRET` y el mismo
header.

### 6.3.1. Probarlo a mano

```bash
curl -H "Authorization: Bearer TU_CRON_SECRET" \
  https://TU-DOMINIO/api/cron/release-stale-reservations
```

Responde algo así:

```json
{ "ok": true, "windowMinutes": 30, "checked": 2, "released": 1, "skippedWithReceipt": 1, "failed": 0 }
```

Sin el header (o con el secreto equivocado) responde `401`.

### 6.4. Segundo cron: recuperar facturación que no terminó de correr

Cuando un empleado confirma una transferencia (o se registra una venta
de mostrador), la facturación con ARCA y los emails corren **después**
de responder, con `after()` de Next.js, para no hacer esperar a nadie
por ARCA. En un entorno serverless eso no tiene garantía absoluta de
terminar (la función se puede cortar a mitad de camino). Si eso pasa, el
pedido queda `paid` pero sin factura `authorized`, sin que nadie se
entere.

`GET /api/cron/bill-unbilled-orders` busca esos casos (pedidos `paid`
de más de 3 minutos sin una factura autorizada) y reintenta
`fulfillPaidOrder()` — la misma función que usan la confirmación de pago
y el POS, nunca duplicada. Usa el mismo `CRON_SECRET` y el mismo
esquema de header `Authorization: Bearer` que el cron anterior. Se
prueba igual:

```bash
curl -H "Authorization: Bearer TU_CRON_SECRET" \
  https://TU-DOMINIO/api/cron/bill-unbilled-orders
```

Responde `{ "ok": true, "checked": N, "billed": N, "failed": 0 }`.

## Arquitectura

```
src/
├── app/                          → páginas y API routes (Next.js App Router)
│   ├── admin/                    → panel interno (protegido por rol)
│   ├── api/checkout/             → crea el pedido
│   ├── api/cron/release-stale-reservations/
│   │                              → cancela pedidos con el plazo vencido
│   └── api/cron/bill-unbilled-orders/
│                                  → reintenta facturación que no terminó de correr
│
├── modules/                      → lógica de negocio por dominio
│   ├── products/                 → catálogo, precios, CRUD admin
│   ├── stock/                    → ajustes manuales de inventario
│   ├── orders/                   → creación y estados del pedido
│   ├── payments/                 → transferencia bancaria (datos
│   │                                bancarios, comprobantes, verificación)
│   ├── billing/                  → ARCA
│   ├── emails/                   → Resend
│   ├── cart/                     → carrito (client-side)
│   └── auth/                     → sesión de clientes y empleados
│
├── infrastructure/database/      → clientes de Supabase (browser/server/admin)
└── shared/types/                 → tipos generados desde la base de datos
```

Cada módulo sigue el mismo patrón: la lógica de negocio vive en clases
`*Service`, las páginas y API routes solo las llaman — nunca tienen
lógica de negocio adentro.

## Cómo fluye una venta online, de punta a punta

```
Cliente agrega productos al carrito (localStorage, client-side)
  ↓
POST /api/checkout
  → función create_order() de Postgres: recalcula precios reales,
    verifica stock, reserva todo en UNA transacción atómica
  ↓
El cliente ve alias/CBU, monto exacto y referencia (CP-000116),
con el reloj del plazo corriendo
  ↓
Transfiere desde su homebanking y sube el comprobante
  → se valida tipo y tamaño (navegador + servidor)
  → se guarda en Storage privado y el pedido pasa a
    payment_processing ("esperando confirmación de pago")
  ↓
Un empleado lo revisa en /admin/pedidos
  → abre el comprobante con una URL firmada de 5 minutos
  → lo cruza con el homebanking por monto y hora
  ↓
 ┌─ Confirma ───────────────────────────────────┐
 │  confirm_order_paid() → descuenta stock real │
 │  BillingService → ARCA → CAE                 │
 │  EmailService → confirmación al cliente +    │
 │                 aviso interno a Casa Periotti│
 └──────────────────────────────────────────────┘
 ┌─ Rechaza ────────────────────────────────────┐
 │  release_order_reservation(id,               │
 │    'payment_failed') → libera el stock       │
 └──────────────────────────────────────────────┘
  ↓ (si nunca llegó el comprobante y venció el plazo)
Disparador externo cada 10 min → release_order_reservation(id, 'cancelled')
  (nunca toca pedidos que YA tienen comprobante subido)
```

## Seguridad — reglas que no se negocian

- El precio que ve el cliente en el navegador **nunca** se usa para
  cobrar. `create_order()` lo recalcula siempre desde la base de datos.
- El stock nunca se toca con un `UPDATE` directo. Todo pasa por
  funciones de Postgres que bloquean la fila del producto durante la
  operación — dos ventas simultáneas del mismo producto no pueden
  generar stock negativo.
- Un pedido nunca se factura dos veces ni se cobra dos veces: cada
  operación de pago y de facturación tiene una clave de idempotencia.
- Un pedido pasa a `paid` **solo** cuando una persona con rol
  `ventas`/`admin`/`super_admin` confirma la transferencia. No hay
  ningún camino automático que dé un pago por bueno.
- El bucket de comprobantes es **privado**. Se accede únicamente con
  URLs firmadas de 5 minutos generadas en el backend, y la subida pasa
  siempre por una Server Action que valida dueño del pedido, estado,
  plazo, tipo de archivo y tamaño — la validación del navegador es una
  comodidad, no una garantía.
- `SUPABASE_SERVICE_ROLE_KEY`, `AFIPSDK_ACCESS_TOKEN` y `CRON_SECRET`
  solo se usan en código de servidor, nunca se exponen al navegador.
- RLS con roles granulares: cada empleado solo puede escribir lo que
  su rol permite, verificado tanto en el código como en la base de
  datos. Además, cada página sensible del panel (`/admin/productos`,
  `/admin/clientes`, `/admin/facturacion`, `/admin/configuracion-pago`)
  vuelve a chequear el rol por su cuenta — no alcanza con que el link
  esté escondido en el menú.

## Pendientes marcados explícitamente en el código

Buscá estos dos textos en el proyecto — son las decisiones que
dependen de información que solo Casa Periotti (o su contador) puede
confirmar:

- `REQUIERE VALIDACIÓN CONTABLE/FISCAL`: qué tipo de comprobante
  (A/B/C) corresponde emitir, según la condición de IVA de la empresa.
- `REQUIERE INFORMACIÓN DEL NEGOCIO`: punto de venta habilitado en
  ARCA, estado del certificado digital.

Ninguno de los dos bloquea el desarrollo — todo se puede seguir
construyendo y probando en ambiente de testing mientras se confirman.
