# Cobrar con la terminal Point desde el sistema

Sirve para que el monto de una venta de mostrador aparezca solo en la
terminal Point Smart, en vez de tipearlo a mano y después registrarlo
aparte.

## Qué pasa cuando se cobra

1. El empleado arma la venta y elige el medio de pago **Tarjeta (Point)**.
2. Al confirmar, se crea el pedido y **se reserva el stock** (la misma
   función `create_order` de siempre), y se le manda el monto a la
   terminal. Todavía no hay venta cobrada.
3. El cliente pasa la tarjeta y elige débito, crédito o cuotas **en el
   equipo** — eso no se decide desde el sistema a propósito, es donde se
   decide hoy.
4. La pantalla pregunta cada 2 segundos cómo salió. Cuando se aprueba,
   el servidor registra el pago, descuenta el stock
   (`confirm_order_paid`), emite la factura y manda los mails: el mismo
   camino que una venta en efectivo.
5. Si se rechaza, se cancela o vence, el stock reservado vuelve con la
   misma función que usa un pago rechazado de la web.

## Lo que se guarda

- `payments`: una fila con `provider = 'pos'` y
  `payment_method_id = 'point'`. Para los reportes, el cierre de caja y
  el ticket es una venta de mostrador como cualquier otra.
- `point_payment_intents` (migración 0029): en qué quedó cada cobro, con
  `intent_id` guardando el id de la **order** de Mercado Pago (la tabla se
  creó con la API vieja, donde eso era un "payment intent"), y
  el id del pago en Mercado Pago, si fue débito o crédito y en cuántas
  cuotas. Sirve para conciliar contra la liquidación y —más importante—
  para que **un cobro aprobado no se pierda** si se cierra la pantalla:
  la próxima consulta lo encuentra y confirma la venta.

### Si la pantalla se cierra en el medio

El cobro no se pierde. El estado vive en la base, así que:

- Al volver a abrir esa venta, la consulta lo encuentra y la confirma.
- Si nadie vuelve, el cron `/api/cron/release-stale-reservations` llama a
  `resolveStale()`: le pregunta a Mercado Pago por cada cobro colgado y
  **si la tarjeta se cobró, confirma la venta**; si no, libera el stock y
  saca el monto de la terminal.
- Ese mismo cron **nunca** cancela por su cuenta un pedido con un cobro
  Point abierto (`releaseStaleReservations` los deja afuera). Si Mercado
  Pago no responde, el pedido queda reservado esperando el próximo
  intento: una reserva de más es un problema chico, cancelar una venta ya
  cobrada no lo es.

## Configuración (una vez)

El orden importa, y los dos primeros pasos NO se hacen desde este
sistema: son de Mercado Pago y del equipo.

1. **Crear una sucursal y una caja** en el panel de Mercado Pago (o por
   API). Una caja admite una sola terminal en modo PDV: con dos equipos
   hacen falta dos cajas.
2. **Asociar la terminal** a esa sucursal y esa caja, desde la app de
   Mercado Pago en el celular, escaneando el QR que muestra el equipo.
   La terminal pide elegir sucursal y caja durante ese proceso.
3. En **Panel → Configuración de pago → Cobro con la terminal Point**,
   tocar **Buscar terminales** y elegir la del mostrador. La lista
   muestra el modo y la sucursal/caja de cada equipo.
4. Ponerla en **modo integrado (PDV)**. En ese modo el equipo ya no se
   usa tipeando montos: los recibe del sistema.
5. Activar el cobro y guardar. Si se cambió algo del equipo, reiniciarlo.

### Por qué falla si falta el paso 1 o 2

Sin sucursal y caja asociadas, la API acepta la orden y devuelve su id,
pero **nunca se la manda a la terminal**: la orden queda en estado
`created` y en el mostrador parece que el sistema no hizo nada. Es el
error más difícil de diagnosticar de toda la integración, porque no hay
ningún mensaje de error. Por eso el sistema ahora lo verifica antes de
cobrar y lo muestra en la lista de terminales.

### Un cobro por terminal

La terminal admite **un solo cobro en cola**. Si queda uno abierto, el
siguiente falla con `409 already_queued_order_on_terminal`. El sistema
resuelve los suyos antes de cada cobro (`clearQueue`), pero uno generado
desde el menú del propio equipo hay que cancelarlo en el equipo.

Mientras no haya una terminal elegida y activada, el medio de pago **no
aparece** en la venta de mostrador y todo funciona como antes.

## Qué versión de la API usa (importante)

Mercado Pago tiene **dos** APIs de Point y la vieja quedó bloqueada para
las cuentas nuevas:

| | Vieja ("mp-point-legacy") | Actual (la que usamos) |
|---|---|---|
| Terminales | `GET /point/integration-api/devices` | `GET /terminals/v1/list` |
| Modo integrado | `PATCH /point/integration-api/devices/{id}` | `PATCH /terminals/v1/setup` |
| Cobrar | `POST .../payment-intents` | `POST /v1/orders` con `type: "point"` |
| Estado | `GET .../payment-intents/{id}` | `GET /v1/orders/{id}` |
| Cancelar | `DELETE .../payment-intents/{id}` | `POST /v1/orders/{id}/cancel` |
| Monto | en centavos (`121050`) | en pesos, string (`"1210.50"`) |

Si en algún momento vuelve a aparecer un **403
`PA_UNAUTHORIZED_RESULT_FROM_POLICIES`**, lo primero a mirar es si la
llamada está yendo a la API vieja. Con la credencial de una cuenta nueva,
la vieja responde 403 aunque el token sea correcto; eso no es un problema
de permisos de la cuenta.

Los estados de la order son `created`, `at_terminal`, `action_required`,
`processed` (cobrado), `failed`, `canceled`, `expired` y `refunded`. Solo
`processed` confirma la venta.

## Requisito importante: la credencial

La integración usa `MERCADOPAGO_ACCESS_TOKEN`, el mismo token que el
resto de Mercado Pago. Tiene que ser el **token de producción de la
cuenta dueña de la terminal**.

Con un token de prueba (usuario `TESTUSER…`) la API responde bien pero
la lista de terminales viene vacía: los usuarios de prueba no tienen
equipos. Si "Buscar terminales" no encuentra nada y la terminal está
prendida, eso es lo primero a revisar.

## Qué NO cambió

- El cobro en efectivo, por transferencia, con tarjeta tipeada a mano y
  en cuenta corriente sigue exactamente igual (`PosService`).
- `PosService` rechaza el medio de pago `point` a propósito: ese camino
  registra el pago *antes* de cobrar, y acá hay que esperar la tarjeta.
- La facturación, el stock y los emails son los mismos servicios. Lo
  único distinto es el orden: el cobro pasa entre la reserva y la
  confirmación.

## Límites conocidos

- **Las cuotas las elige el cliente en el equipo.** El sistema las
  registra (quedan en `point_payment_intents`), pero no las impone. Si
  alguna vez se quiere fijar "3 cuotas sin interés" desde el sistema, la
  API lo permite mandando el tipo de pago al crear el cobro.
- **No hay devolución desde el panel.** Una devolución se hace hoy por
  Mercado Pago. Si se necesita, la API tiene endpoint de refund.
- **No hay webhook.** La pantalla pregunta el estado mientras el cobro
  está en curso, que es lo que alcanza con un empleado esperando frente
  al equipo. Si en algún momento hay varias cajas o se quiere cobrar
  desde el celular y cerrar la pantalla, conviene sumar el webhook.
