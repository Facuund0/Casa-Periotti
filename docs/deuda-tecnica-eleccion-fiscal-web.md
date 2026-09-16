# Deuda técnica: la elección fiscal de las compras web vive en el perfil

Estado: **conocida, mitigada con un aviso, sin resolver de fondo.**

## Qué pasa

En el checkout web, el cliente elige el comprobante: Consumidor Final (por
defecto) o "Factura con datos fiscales" (CUIT). Esa elección se guarda en
`customer_profiles` (`invoice_with_fiscal_data`, `cuit_dni`, `dni`) justo antes
de crear el pedido, en `saveInvoicePreferenceAction`.

La factura no se emite en ese momento. Se emite cuando un empleado confirma la
transferencia, que puede ser horas después, o más tarde todavía si la emisión
falla y la reintenta el cron `bill-unbilled-orders`. En ese momento
`BillingService.billOrder()` lee la elección **del perfil**, no del pedido.

Consecuencia: si el cliente hace otra compra con una elección distinta antes de
que se confirme el pago de la anterior, **la compra anterior se factura con la
elección nueva**.

Ejemplo: el pedido #200 se hace con CUIT, y antes de que se confirme su
transferencia el cliente compra el #201 como Consumidor Final. Cuando se
confirma el #200, sale como Consumidor Final.

La revalidación contra el padrón al emitir no cambia esto. Decide la letra a
partir del CUIT, pero el CUIT sale del perfil.

## Por qué existe

La elección no tiene dónde vivir en el pedido sin tocar su creación. Los
pedidos web los crea la función de Postgres `create_order()` (migración 0006),
que también reserva stock. Guardar la elección por pedido requiere modificar
esa función o el camino que la llama, y se decidió no tocarlo por ahora: el
caso es poco probable (dos compras con distinta elección fiscal mientras la
primera sigue sin pago confirmado) y un error ahí afectaría precios o stock de
todas las ventas.

## Mitigación actual

Si el cliente tiene pedidos que todavía no tienen factura, el checkout muestra
un aviso destacado antes de confirmar. Cuentan los pedidos en `pending_payment`
o `payment_processing`, y los `paid` sin factura autorizada, que son los que
reintenta el cron `bill-unbilled-orders`. El aviso aparece cuando
elige factura con datos fiscales, o cuando pasa a Consumidor Final teniendo
guardada una elección con datos fiscales. Indica qué pedidos se van a facturar
con la elección nueva. Ver `checkout-client.tsx` y `checkout/page.tsx`.

El aviso solo informa: esos pedidos se siguen facturando con el perfil vigente
en el momento de emitir, incluido un reintento del cron. Se resuelve de fondo
con la elección guardada por pedido (abajo).

## Qué haría falta para resolverlo

Guardar la elección **por pedido** en el momento de la compra, y que la
facturación lea esa fila en lugar del perfil:

1. Usar la tabla `order_fiscal_choices` (migración 0018), que ya existe y la
   usa el mostrador: tipo de comprobante pedido, CUIT o DNI, y condición y razón
   social devueltas por el padrón al momento de la venta.
2. Escribirla en `/api/checkout` después de `createFromCart()`. Si la escritura
   falla, el pedido ya reservó stock y habría que cancelarlo o reintentar. Ese
   es el punto delicado, y el motivo por el que no se hizo.
3. En `billOrder()`, leer primero `order_fiscal_choices` y usar el perfil solo
   para pedidos anteriores al cambio.
4. Quitar el aviso del checkout.

La revalidación contra el padrón al emitir se mantiene igual: la fila guarda
qué pidió el cliente, y la letra la sigue decidiendo el padrón al emitir.

## Relación con las ventas de mostrador

Resuelto para el mostrador con la migración 0018: la elección fiscal y el mail
del comprador sin cuenta se guardan en `order_fiscal_choices` al registrar la
venta, y `billOrder()` y `fulfillPaidOrder()` los leen de ahí, también en los
reintentos del cron. Para la web alcanza con escribir esa misma tabla desde
`/api/checkout` (paso 2 de arriba).
