# Casa Periotti — Sistema web + facturación

E-commerce con precios minorista/mayorista, pago con tarjeta (Mercado Pago)
y facturación electrónica (ARCA), para el corralón Casa Periotti en
Sunchales, Santa Fe.

## Estado actual

- ✅ Catálogo público con precios minorista/mayorista (Sanitarios, Piscinas,
  Electricidad, Ferretería, Artefactos, Construcción, Línea Solar, Combos)
- ✅ Auth de clientes: registro, login, pedido de mayorista con aprobación
- ✅ Panel interno `/admin` con roles (admin, ventas, stock, facturación,
  super_admin) — CRUD de productos, ajuste de stock, aprobación de
  mayoristas, facturación manual
- ✅ Carrito + checkout con reserva de stock atómica (sin condiciones de
  carrera, todo en una transacción de Postgres)
- ✅ Pago con tarjeta embebido (Mercado Pago Card Payment Brick) + webhook
  con validación de firma e idempotencia
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
```

Si en algún momento agregás una migración nueva (`0008_...sql`), el
mismo mecanismo: se corre una sola vez, a mano, en el SQL Editor.

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

## 3. Conectar Mercado Pago (modo prueba)

1. Entrá a [mercadopago.com.ar/developers/panel](https://www.mercadopago.com.ar/developers/panel).
2. Creá una aplicación (o usá una existente).
3. En **Credenciales de prueba**, copiá:
   - **Access Token** → `MERCADOPAGO_ACCESS_TOKEN`
   - **Public Key** → `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY`
4. Para probar pagos de verdad en modo sandbox, Mercado Pago te da
   tarjetas de prueba específicas (buscá "tarjetas de prueba Mercado
   Pago Argentina" en su documentación — cambian de vez en cuando, por
   eso no las dejo hardcodeadas acá).
5. Para el webhook: en la misma app, sección **Webhooks → Configurar
   notificaciones**, agregá la URL `https://TU-DOMINIO/api/webhooks/mercadopago`
   (mientras desarrollás local, podés usar una herramienta como ngrok
   para exponer tu `localhost` con una URL pública temporal). Copiá el
   **Secret** que te muestra ahí → `MERCADOPAGO_WEBHOOK_SECRET`.

Mientras no tengas el webhook configurado, los pagos síncronos
(aprobado/rechazado en el momento) van a funcionar igual — lo único
que no vas a poder probar es la confirmación asincrónica para pagos
que quedan "pendientes" unos segundos.

## 4. Conectar ARCA (ambiente de pruebas)

1. Entrá a [app.afipsdk.com](https://app.afipsdk.com) y registrate gratis.
2. Sacá tu **Access Token** → `AFIPSDK_ACCESS_TOKEN`.
3. Dejá `ARCA_ENVIRONMENT=testing` — así el sistema usa un CUIT de
   prueba público que ya está habilitado para facturar en el ambiente
   de homologación de ARCA, sin que Casa Periotti necesite certificado
   propio todavía.
4. Cuando Casa Periotti tenga certificado digital real y punto de
   venta habilitado (esto se tramita con clave fiscal nivel 3, ver
   `docs/arca.md` más abajo), se cambia `ARCA_ENVIRONMENT=production`,
   se completa `ARCA_CUIT`, y se ajusta `ARCA_DEFAULT_INVOICE_TYPE`
   según lo que confirme el contador.

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
al toque, antes de que pague. Si nunca completa el pago, esa reserva se
liberaba antes solo en tres casos: pago rechazado, webhook de Mercado
Pago con estado rechazado/cancelado, o error de red al llamar a
Mercado Pago. Un checkout simplemente **abandonado** (el cliente cierra
la pestaña) no caía en ninguno de esos casos, y el stock quedaba
bloqueado para siempre.

`GET /api/cron/release-stale-reservations` recorre los pedidos en
`pending_payment` o `payment_processing` con más de 30 minutos sin
actividad (`updated_at`) y llama a `release_order_reservation(id,
'cancelled')` para cada uno — la misma función de Postgres que ya usan
el webhook y el pago síncrono, así que es idempotente y segura de
correr las veces que haga falta.

⚠️ **En desarrollo local nadie llama a este cron** (no hay Vercel Cron
corriendo tu `localhost`) — es normal ver `stock_reservado` > 0 en
`/admin/productos` después de abandonar unos cuantos checkouts de
prueba, no es un bug. Para esos casos hay un botón **"Liberar reservas
vencidas"** arriba de la tabla de productos que dispara exactamente la
misma lógica (`OrderService.releaseStaleReservations()`) a mano. En
producción, configurá el cron real siguiendo los pasos de abajo — ahí
sí corre solo cada 15 minutos sin que nadie tenga que apretar nada.

### 6.1. Generar el secreto

```bash
openssl rand -hex 32
```

Guardá ese valor en `CRON_SECRET` (tanto en `.env.local` para probarlo
local como, más abajo, en las variables de entorno de Vercel).

### 6.2. Configurar el cron en Vercel

El archivo `vercel.json` en la raíz del proyecto ya define el cron:

```json
{
  "crons": [
    { "path": "/api/cron/release-stale-reservations", "schedule": "*/15 * * * *" },
    { "path": "/api/cron/bill-unbilled-orders", "schedule": "*/5 * * * *" }
  ]
}
```

Pasos:

1. En el dashboard de Vercel, andá a tu proyecto → **Settings →
   Environment Variables** y agregá `CRON_SECRET` con el mismo valor
   que generaste arriba (aplicado a Production, y a Preview si querés
   probarlo ahí también).
2. Desplegá el proyecto (`vercel.json` se detecta solo). Vercel crea el
   cron job automáticamente a partir de ese archivo — no hace falta
   configurar nada más manualmente en la UI.
3. Vercel llama a esa URL con el header `Authorization: Bearer
   $CRON_SECRET` **automáticamente** en cada disparo, siempre que la
   variable `CRON_SECRET` esté configurada en el proyecto — no hay que
   armar ese header a mano en ningún lado.
4. Podés ver las ejecuciones (y su log, incluyendo cuántos pedidos
   liberó) en **Project → Cron Jobs** dentro del dashboard de Vercel.

⚠️ En el plan **Hobby** de Vercel los cron jobs solo pueden dispararse
como máximo **una vez por día**, sin importar lo que diga el
`schedule` — para la cadencia de 15 minutos de este archivo hace falta
plan **Pro** o superior. Con Hobby, cambiá el `schedule` a algo como
`"0 3 * * *"` (una vez por día) sabiendo que el stock puede quedar
bloqueado más tiempo mientras tanto.

### 6.3. Probarlo a mano

```bash
curl -H "Authorization: Bearer TU_CRON_SECRET" \
  https://TU-DOMINIO/api/cron/release-stale-reservations
```

Responde `{ "ok": true, "checked": N, "released": N, "failed": 0 }`.
Sin el header (o con el secreto equivocado) responde `401`.

### 6.4. Segundo cron: recuperar facturación que no terminó de correr

`/api/payments/process` y el webhook de Mercado Pago facturan (ARCA) y
mandan los emails de confirmación **después** de responder — usan
`after()` de Next.js para no demorar esa respuesta esperando a ARCA. En
un entorno serverless eso no tiene garantía absoluta de terminar (la
función se puede cortar a mitad de camino). Si eso pasa, el pedido
queda `paid` pero sin factura `authorized`, sin que nadie se entere.

`GET /api/cron/bill-unbilled-orders` busca esos casos (pedidos `paid`
de más de 3 minutos sin una factura autorizada) y reintenta
`fulfillPaidOrder()` — la misma función que ya usan el pago síncrono y
el webhook, nunca duplicada. Usa el mismo `CRON_SECRET` y el mismo
esquema de header `Authorization: Bearer` que el cron anterior; ya está
declarado en `vercel.json` con una cadencia de 5 minutos (sujeto a la
misma limitación del plan Hobby mencionada arriba). Se prueba igual:

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
│   ├── api/payments/process/     → procesa el pago con tarjeta
│   ├── api/webhooks/mercadopago/ → confirmación asincrónica de pagos
│   ├── api/cron/release-stale-reservations/
│   │                              → libera stock de checkouts abandonados
│   └── api/cron/bill-unbilled-orders/
│                                  → reintenta facturación que no terminó de correr
│
├── modules/                      → lógica de negocio por dominio
│   ├── products/                 → catálogo, precios, CRUD admin
│   ├── stock/                    → ajustes manuales de inventario
│   ├── orders/                   → creación y estados del pedido
│   ├── payments/                 → Mercado Pago
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
Card Payment Brick tokeniza la tarjeta en el navegador
  (el número de tarjeta NUNCA toca el backend)
  ↓
POST /api/payments/process
  → PaymentService llama a la API de Pagos de Mercado Pago
  ↓
 ┌─ Aprobado ──────────────────────────────────┐
 │  confirm_order_paid() → descuenta stock real │
 │  BillingService → ARCA → CAE                 │
 │  EmailService → confirmación al cliente +     │
 │                 aviso interno a Casa Periotti │
 └───────────────────────────────────────────────┘
  ↓ (en paralelo, por si el paso anterior se cortó)
Webhook de Mercado Pago
  → re-consulta el pago real (nunca confía en el payload)
  → si todavía no se había confirmado, lo confirma ahora (idempotente)
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
- El webhook de Mercado Pago valida la firma HMAC antes de tocar
  cualquier dato, y **nunca** confía en el estado que viene en la
  notificación — siempre vuelve a consultar el pago real a la API.
- `SUPABASE_SERVICE_ROLE_KEY`, `MERCADOPAGO_ACCESS_TOKEN`,
  `AFIPSDK_ACCESS_TOKEN` y `CRON_SECRET` solo se usan en código de
  servidor, nunca se exponen al navegador.
- RLS con roles granulares: cada empleado solo puede escribir lo que
  su rol permite, verificado tanto en el código como en la base de
  datos. Además, cada página sensible del panel (`/admin/productos`,
  `/admin/clientes`, `/admin/facturacion`) vuelve a chequear el rol
  por su cuenta — no alcanza con que el link esté escondido en el menú.

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
