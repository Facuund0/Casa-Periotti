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
  el id del pago en Mercado Pago, si fue débito o crédito y en cuántas
  cuotas. Sirve para conciliar contra la liquidación y —más importante—
  para que **un cobro aprobado no se pierda** si se cierra la pantalla:
  la próxima consulta lo encuentra y confirma la venta.

Si la pantalla se cierra y el cobro nunca se aprueba, el pedido queda
reservado y lo cancela solo el cron de reservas vencidas
(`/api/cron/release-stale-reservations`), igual que un checkout web
abandonado.

## Configuración (una vez)

En **Panel → Configuración de pago → Cobro con la terminal Point**:

1. Prender la terminal, con la sesión de la cuenta de Mercado Pago
   iniciada.
2. **Buscar terminales**: lista los equipos de la cuenta.
3. Ponerla en **modo integrado (PDV)**. En ese modo el equipo ya no se
   usa tipeando montos: los recibe del sistema.
4. Activar el cobro y guardar.

Mientras no haya una terminal elegida y activada, el medio de pago **no
aparece** en la venta de mostrador y todo funciona como antes.

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
