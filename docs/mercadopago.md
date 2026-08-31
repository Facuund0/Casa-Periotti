# Integración con Mercado Pago — estado antes de migrar a Orders API

Este documento congela el estado del módulo de pagos **antes** de migrar de
la API de Payments (`POST /v1/payments`) a la API de Orders (`POST
/v1/orders`), migración necesaria para poder implementar 3DS 2.0 (ver
"Motivo de la migración" al final). Sirve como referencia de qué hacía el
sistema y por qué, y como punto de vuelta si la migración necesita
revertirse.

Commit de este estado: ver el commit inmediatamente posterior a este
archivo en el historial — el mensaje señala explícitamente este punto de
retorno.

## 1. Flujo completo

```
1. Cliente arma el carrito y confirma en /checkout (CheckoutClient)
   → POST /api/checkout
   → OrderService.createFromCart() → RPC create_order() (Postgres)
     - Recalcula precios desde products (nunca confía en lo que mandó el
       navegador), bloquea filas de producto (`for update`), reserva
       stock (stock_reserved += cantidad, sin descontarlo todavía),
       crea la fila en `orders` (status='pending_payment') y sus
       `order_items` (con product_name_snapshot = nombre del producto
       en ese momento).

2. Con el pedido creado, se muestra el Card Payment Brick
   (CardPaymentBrick, src/app/checkout/card-payment-brick.tsx)
   - Carga el SDK JS v2 (sdk.mercadopago.com/js/v2)
   - Carga explícitamente el script de seguridad
     (mercadopago.com/v2/security.js, view="checkout") que genera
     window.MP_DEVICE_SESSION_ID (Device ID del navegador)
   - El Brick tokeniza los datos de la tarjeta en el navegador — el
     backend nunca ve el número de tarjeta, solo un token de un solo uso

3. onSubmit del Brick → CheckoutClient.handlePaymentSubmit()
   → POST /api/payments/process
     body: { orderId, token, paymentMethodId, issuerId, installments,
             identificationType, identificationNumber, deviceId }

4. route.ts (api/payments/process)
   - Confirma sesión (supabase.auth.getUser()) — payerEmail sale de
     user.email!, NUNCA del body que mandó el navegador
   - Confirma que el pedido pertenece a ese usuario
   - Llama a PaymentService.processCardPayment()

5. PaymentService.processCardPayment() (src/modules/payments/payment-service.ts)
   a. Si el pedido estaba en payment_failed, reintenta
      (OrderService.retryPayment → RPC retry_order_payment: re-reserva
      stock si sigue disponible, vuelve a pending_payment)
   b. Barrera de idempotencia en aplicación: si ya hay un pago
      pending/processing/approved para este orderId, aborta
      (PaymentAlreadyInProgressError)
   c. Inserta la fila en `payments` con status='processing' ANTES de
      llamar a Mercado Pago (idempotency_key = randomUUID())
   d. OrderService.markProcessing() → orders.status='payment_processing'
   e. buildApprovalExtras(): junta payer.first_name/last_name (de
      customer_profiles.full_name), items (de order_items +
      products.description) y address (si es delivery), en paralelo
   f. Payment.create() contra la API de Mercado Pago (ver campos en la
      sección 2), con requestOptions.meliSessionId = Device ID
   g. Actualiza la fila de `payments` con el resultado
   h. approved → OrderService.confirmPaid() (RPC confirm_order_paid:
      descuenta stock de verdad) + OrderFulfillmentService.fulfillPaidOrder()
      en background (after()) → factura + emails
      rejected → OrderService.releaseReservation(orderId, 'payment_failed')
      in_process/pending → no se toca nada, queda esperando el webhook

6. Mercado Pago notifica el cambio de estado (asíncrono, puede llegar
   antes o después de que el paso 5 termine de guardar la respuesta
   síncrona) → POST o GET a /api/webhooks/mercadopago
   - Valida firma HMAC (salvo IPN clásico, ver sección 3)
   - Registra el evento en `webhook_events` (event_id = x-request-id,
     único → una entrega duplicada exacta no se reprocesa)
   - PaymentService.reconcilePayment(dataId): vuelve a pedir el pago
     COMPLETO a la API de MP (nunca confía en el body de la
     notificación) y aplica el mismo tratamiento que el paso 5.g-h

7. Si el webhook nunca llega (típico en desarrollo local, MP no puede
   alcanzar localhost) hay dos redes de contención:
   - Botón manual "Consultar estado del pago" en /admin/pedidos
     (reconcilePaymentAction → mismo PaymentService.reconcilePayment())
   - Cron /api/cron/release-stale-reservations (cada pedido en
     pending_payment/payment_processing hace más de 30 min sin
     actividad libera su reserva de stock, vía
     OrderService.releaseStaleReservations())
```

## 2. Campos que se mandan a `Payment.create()` y por qué

Body de `POST /v1/payments` armado en
`payment-service.ts:processCardPayment()`:

| Campo | Origen | Por qué |
|---|---|---|
| `transaction_amount` | `order.total` (recalculado en el pedido, nunca del navegador) | Evita que el cliente manipule el monto desde el checkout |
| `token` | Brick (tokenización en el navegador) | El backend nunca ve el número de tarjeta |
| `description` | `Pedido Casa Periotti #{orderNumber}` | Referencia legible para el vendedor |
| `installments`, `payment_method_id`, `issuer_id` | Brick | Elegidos por el comprador en el formulario |
| `notification_url` | `APP_BASE_URL` + `/api/webhooks/mercadopago` (omitido si no hay `APP_BASE_URL`, típico en local) | Para que MP pueda notificar cambios de estado asíncronos |
| `external_reference` | `order.id` | Correlacionar el pago del lado de MP con el pedido propio; es la vía de respaldo de `reconcilePayment()` si `provider_payment_id` no llegó a guardarse |
| `statement_descriptor` | Constante `"CASA PERIOTTI"` | Texto que ve el comprador en el resumen de su tarjeta |
| `payer.email` | `user.email!` (Supabase auth, autenticado) | Requerido por la API; nunca viene del body que manda el navegador |
| `payer.first_name` / `last_name` | `customer_profiles.full_name` (partido por espacios) | Recomendado por la herramienta de Calidad de Integración de MP para mejorar aprobación |
| `payer.identification` | Form del checkout (`identificationType`/`identificationNumber`) | Requerido por ARCA por encima de cierto monto; también ayuda al scoring de MP |
| `payer.address` | `orders.shipping_address_street/city` (solo si `fulfillment_method='delivery'`) | Señal adicional de legitimidad para el motor de riesgo de MP |
| `additional_info.items` | `order_items` (id, `product_name_snapshot` como título, `products.description`, cantidad, precio unitario) | Recomendado por la Calidad de Integración; **el título es el nombre del producto, nunca el del comprador** — confirmado leyendo `create_order()` (usa `products.name`) |
| `requestOptions.idempotencyKey` | `randomUUID()` generado antes de insertar la fila en `payments` | Evita que un reintento de red duplique el cobro — el mismo key en un reintento real hace que MP devuelva el mismo pago en vez de crear uno nuevo |
| `requestOptions.meliSessionId` | `window.MP_DEVICE_SESSION_ID` del navegador, viajando como `deviceId` en el body del POST a `/api/payments/process` | Se traduce al header `X-Meli-Session-Id` — uno de los factores de mayor peso para la aprobación según la Calidad de Integración de MP |

Deliberadamente **no** se manda `binary_mode` — ver sección 3.

## 3. Problemas encontrados: causa y solución

### 3.1 `binary_mode` rechazaba pagos que solo necesitaban revisión

- **Síntoma**: pagos legítimos que hubieran quedado `in_process`
  (`status_detail: pending_contingency`) salían rechazados directamente.
- **Causa**: `binary_mode: true` fuerza a MP a resolver siempre a
  approved/rejected, sin estado intermedio — convierte en rechazo
  cualquier pago que necesitaba unos segundos/minutos de revisión.
- **Solución**: se sacó `binary_mode` del body. Sin él, esos pagos quedan
  `in_process` (`mapMercadoPagoStatus` los traduce a `"processing"`) y se
  resuelven solos después: el `notification_url` dispara el webhook
  cuando MP decide, y si nunca llega, el cron
  `release-stale-reservations` libera la reserva a los 30 minutos.

### 3.2 El webhook solo soportaba el formato nuevo

- **Síntoma**: notificaciones IPN clásicas (`GET ?topic=payment&id=123`)
  no se procesaban.
- **Causa**: el handler solo sabía leer `type` + `data.id` (formato
  Webhooks actual, POST con body JSON).
- **Solución**: el handler acepta GET y POST, y busca `type`/`topic` e
  `id`/`data.id` tanto en query params como en el body. Se distingue el
  IPN clásico porque el `dataId` solo vino del `id` clásico, nunca de
  `data.id` (`isLegacyIpnFormat`).

### 3.3 IPN clásico no tiene firma HMAC que validar

- **Síntoma**: con `MERCADOPAGO_WEBHOOK_SECRET` configurado, toda
  notificación IPN clásica se rechazaba por "firma inválida" — ese
  formato nunca manda `x-signature`.
- **Causa**: el formato IPN clásico (histórico, de compatibilidad) no
  incluye firma en absoluto; no es un bug de parseo, es que ese formato
  no es firmable.
- **Solución**: se omite la validación HMAC específicamente para IPN
  clásico. La autenticidad se confirma de otra forma: `reconcilePayment()`
  vuelve a consultar el `dataId` directo contra la API de MP con el
  access token propio — esa API solo devuelve el pago si pertenece a la
  cuenta (si no, 404), lo cual ya prueba legitimidad sin necesidad de HMAC.

### 3.4 Device ID ausente (`security:none` en el `tracking_id` que devuelve MP)

- **Síntoma**: pagos rechazados con `cc_rejected_high_risk`; el
  `tracking_id` que MP computa en la respuesta mostraba `security:none`
  incluso en pagos posteriores al deploy que agregó el script de
  seguridad.
- **Causa raíz confirmada**: `onLoad` del script
  `mercadopago.com/v2/security.js` dispara apenas termina de
  **descargarse** el script — no cuando `window.MP_DEVICE_SESSION_ID`
  queda efectivamente seteado. El script hace trabajo interno
  asincrónico antes de exponer la variable, así que el Brick podía
  montarse (y el comprador podía llegar a pagar) antes de que el Device
  ID existiera.
- **Verificación**: se comprobó leyendo el `raw_response` guardado en
  `payments` para un pago real (creado horas después del deploy del
  script) que el `tracking_id` con `security:none` ya venía así en la
  respuesta **síncrona** de `Payment.create()` — no era un artefacto de
  una relectura posterior de la API. Se descartó también un bug del SDK:
  el mecanismo que traduce `requestOptions.meliSessionId` al header
  `X-Meli-Session-Id` (en `RestClient.fetch`, `node_modules/mercadopago`)
  es genérico y correcto — el problema estaba 100% en que la variable del
  navegador todavía no tenía valor al momento del submit.
- **Solución**: en vez de confiar en el evento `onLoad`, se sondea
  `window.MP_DEVICE_SESSION_ID` cada 200ms (hasta ~4s) antes de marcar
  `securityScriptReady` y montar el Brick. Si se agota el tiempo sin que
  la variable quede seteada, se loguea un warning y se sigue igual (para
  no bloquear el checkout indefinidamente).

### 3.5 `payer.email`/`first_name`/`last_name`/`identification`/`statement_descriptor` en `null` en la respuesta de MP

- **Síntoma**: un pago rechazado mostraba todos estos campos en `null` al
  consultarlo, pese a que el código los arma correctamente.
- **Investigación**: se confirmó con datos reales (no solo lectura de
  código) que **no** era una falla silenciosa de `buildApprovalExtras()`:
  para ese pedido puntual, `customer_profiles.full_name` tenía un nombre
  real y el email de auth estaba presente — la función tenía datos
  válidos para usar.
- **Conclusión (no 100% verificable sin una captura de red)**: la
  explicación más probable es que la API de Payments de MP no garantiza
  hacer eco de estos campos (son de escritura, para scoring de riesgo)
  en la respuesta — especialmente en pagos que el motor antifraude
  rechaza antes de autorizar. No se encontró ningún bug de código que lo
  explique.
- **Estado**: no se tocó código por este punto — quedó como hallazgo
  documentado, no como fix.

### 3.6 Título de un ítem mostraba el nombre de una persona ("Facundo Perez")

- **Síntoma**: parecía que el código estaba mandando el nombre del
  comprador como título de un ítem del pedido.
- **Investigación**: se verificó `create_order()` (función de Postgres,
  `supabase/migrations/0006_create_order_function.sql:130`) — usa
  `products.name`, nunca datos del comprador. Se consultó la tabla
  `products` para el producto en cuestión: el producto de prueba estaba
  literalmente nombrado `"Facundo Perez"`.
- **Conclusión**: no era un bug — era un producto de prueba con nombre
  de placeholder.

## 4. Decisiones tomadas

- **Card Payment Brick + API de Payments**, no Checkout Pro (redirect) ni
  Preferences — se prioriza tener el formulario embebido en el propio
  checkout.
- **Sin `binary_mode`**: se prefiere dejar pagos en revisión resolverse
  solos (webhook o cron) antes que rechazar de entrada algo que podía
  haberse aprobado.
- **La reserva de stock nunca depende directamente de qué pasó con
  Mercado Pago**: `PaymentService` traduce cualquier resultado a un
  estado propio (`approved`/`rejected`/`processing`/`pending` vía
  `mapMercadoPagoStatus`) y es ese estado el que dispara
  `confirmPaid`/`releaseReservation` — mantiene la lógica de pedidos
  desacoplada del proveedor de pago.
- **Nunca se confía en el body de una notificación de webhook**: todo
  cambio de estado se aplica solo después de volver a consultar el pago
  completo, directo contra la API, con el access token propio.
- **Idempotencia en dos capas**: a nivel aplicación (fila insertada antes
  de llamar a MP + chequeo de pago no-terminal existente) y a nivel base
  de datos (índice único `idx_payments_one_active_per_order`, migración
  0007) — ninguna de las dos alcanza sola para cubrir una carrera entre
  dos pestañas o un doble submit.
- **Ambos formatos de webhook soportados en paralelo** (Webhooks nuevo +
  IPN clásico), porque una misma cuenta puede recibir cualquiera de los
  dos según configuración, y no hay forma de elegir de antemano cuál va
  a llegar.

## 5. Motivo de la migración a Orders API

Soporte de Mercado Pago respondió (ticket sobre rechazos sistemáticos
`cc_rejected_high_risk`, 100% de las operaciones) que la integración
está correcta, pero que evitar ese rechazo sistemático requiere
implementar 3DS 2.0 — y 3DS 2.0 **solo está disponible en la API de
Orders (`POST /v1/orders`)**, no en la API de Payments que usa hoy este
código. De ahí la migración. El análisis de qué implica (archivos,
mapeo de campos, impacto en el webhook, qué se mantiene igual) vive en
la discusión previa a este commit — este documento describe el
"antes", no el "después".
