# Notificaciones push para empleados

Avisos en el celular o la computadora cuando hay algo para resolver en el
panel, sin tener que mirarlo. Solo para empleados: los clientes no reciben
notificaciones push.

## Los tres avisos

| Evento | Roles que lo reciben | Dónde se dispara | Link del aviso |
|---|---|---|---|
| El cliente subió el comprobante ("Ya transferí") | ventas, admin, super_admin | `uploadTransferReceiptAction` (`src/app/checkout/actions.ts`) | `/admin/pedidos` |
| Solicitud de precio mayorista | ventas, admin, super_admin | `signUpAction` (`src/modules/auth/actions.ts`) | `/admin/clientes` |
| ARCA rechazó una factura | facturacion, admin, super_admin | `BillingService.issueInvoice`, vía `rejected-invoice-notice.ts` | `/admin/facturacion?status=rejected` |

Los tres salen con `after()`, después de responder. Un fallo al notificar
nunca rompe la venta, la facturación ni el alta: `PushService.notify()` no
propaga excepciones, solo las registra.

## Solicitud de mayorista: limitación conocida

Hoy el precio mayorista **solo se puede pedir al registrarse**: lo marca el
disparador `handle_new_customer` (migración 0002), que pone
`customer_type = 'mayorista_pendiente'` cuando el alta viene con
`wants_wholesale`. Un cliente ya registrado no tiene forma de solicitarlo
después.

Si más adelante se agrega esa posibilidad (por ejemplo, un botón en Mi
cuenta), hay que llamar también a `pushNotifications.wholesaleRequest()`
desde esa acción, además de dejar el `customer_type` en
`mayorista_pendiente`.

## Claves VAPID y variables de entorno

Las claves se generan una sola vez:

```
npx web-push generate-vapid-keys
```

| Variable | Contenido |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | La clave pública (la usa el navegador al suscribirse) |
| `VAPID_PRIVATE_KEY` | La clave privada (secreta, solo servidor) |
| `VAPID_SUBJECT` | `mailto:` con un mail de contacto |

Van en Vercel (Production, Preview y Development) y en `.env.local`. Si
cambian, **todas las suscripciones dejan de servir** y cada empleado tiene
que activarlas de nuevo. Sin estas variables, la pantalla
`/admin/notificaciones` avisa que falta configurarlas y no se puede
activar nada.

## Suscripciones

Tabla `push_subscriptions` (migración 0020): una fila por dispositivo y
navegador de cada empleado. Que las notificaciones estén "activadas" es
que exista esa fila; al desactivarlas desde el panel, se borra.

Cuando el navegador contesta que una suscripción ya no vale (410 o 404),
el envío la borra en vez de reintentar. Los fallos temporales quedan
registrados en `last_failure_at`.

## iPhone y iPad

Apple solo entrega notificaciones web si el sitio está **agregado a la
pantalla de inicio**. La pantalla de notificaciones detecta iPhone y iPad
y muestra los pasos (Safari → Compartir → Agregar a inicio → abrir desde
el icono → activar). Sin eso, el empleado no recibe nada.

## Iconos: reemplazar los provisorios por el logo

Los iconos actuales son **provisorios**: un cuadrado con el azul de la
marca y las iniciales "CP", generados con un script. Para poner el logo
real alcanza con sobrescribir estos archivos, sin tocar código:

| Archivo | Tamaño | Dónde se usa |
|---|---|---|
| `public/icon-192.png` | 192×192 px | Icono del aviso y de la PWA |
| `public/icon-512.png` | 512×512 px | Pantalla de inicio y splash de Android |
| `public/apple-touch-icon.png` | 180×180 px | Pantalla de inicio en iPhone y iPad |

Recomendaciones para los definitivos: PNG cuadrado, fondo sólido (no
transparente, porque Android lo recorta en círculo) y el logo con margen
propio de alrededor del 10 % por lado.

El `public/logo.png` que usa el PDF de las facturas y el encabezado del
sitio es un archivo aparte y sigue pendiente.
