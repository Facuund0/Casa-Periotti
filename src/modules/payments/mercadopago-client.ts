import "server-only";
import { MercadoPagoConfig, Payment, Order } from "mercadopago";

/**
 * Wrapper delgado sobre el SDK oficial. No agrega lógica de negocio acá
 * (eso vive en PaymentService) — solo centraliza la configuración para
 * no repetir el access token por todos lados.
 *
 * IMPORTANTE: MERCADOPAGO_ACCESS_TOKEN nunca se expone al frontend.
 * En ambiente de pruebas, se usa el Access Token de prueba que te da
 * tu propia cuenta de Mercado Pago Developers (empieza con "TEST-").
 */
function getConfig() {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error(
      "Falta MERCADOPAGO_ACCESS_TOKEN en .env.local. Conseguilo en tu panel de Mercado Pago Developers (modo prueba)."
    );
  }
  return new MercadoPagoConfig({ accessToken, options: { timeout: 8000 } });
}

export function getPaymentClient() {
  return new Payment(getConfig());
}

// Order (API de Orders, POST /v1/orders): la API que hay que usar para
// poder pedir 3DS 2.0 — Payment.create() (arriba) no lo soporta. Los
// pagos nuevos se crean acá; getPaymentClient() se mantiene solo para
// reconciliar pagos que ya existían de antes de esta migración.
export function getOrderClient() {
  return new Order(getConfig());
}

/**
 * El SDK (MercadoPagoError y subclases, ver node_modules/mercadopago/dist/utils/errors/index.js)
 * descarta el body crudo de una respuesta de error: su constructor solo
 * guarda `message`/`error`/`causes` (este último leído de `body.cause`,
 * SINGULAR — el shape de la API de Payments). La API de Orders devuelve
 * el detalle real en `body.errors` (PLURAL, un array de
 * {code, message, details}) — un campo que el SDK ni siquiera lee. Sin
 * esto, cualquier 400/402 de Orders queda con `causes: []` y un mensaje
 * genérico ("MercadoPago API error"), sin nada para diagnosticar.
 * RestClient.fetch (node_modules/mercadopago/dist/utils/restClient/index.js)
 * llama al `fetch` global directo, sin ningún punto de inyección para
 * interceptar la respuesta desde afuera.
 *
 * Esta función envuelve `globalThis.fetch` SOLO durante la llamada que
 * recibe como `fn` — nunca cambia el comportamiento de esa llamada (dejar
 * pasar la respuesta real intacta, vía `.clone()` para no interferir con
 * la lectura que hace el propio SDK del mismo body). Filtra por el header
 * `X-Idempotency-Key` de ESTA llamada puntual (que el código que llama
 * ya manda siempre) para no confundir el body capturado con el de otra
 * llamada a Mercado Pago que ocurra en paralelo mientras el fetch global
 * está envuelto — dos emisiones concurrentes (dos pedidos distintos)
 * pueden estar llamando a la API al mismo tiempo.
 */
export async function withRawErrorBodyCapture<T>(idempotencyKey: string, fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  let rawErrorBody: string | null = null;

  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    const res = await originalFetch(...args);
    if (!res.ok) {
      const headers = new Headers(args[1]?.headers);
      if (headers.get("x-idempotency-key") === idempotencyKey) {
        try {
          rawErrorBody = await res.clone().text();
        } catch {
          // Sin body crudo disponible — se sigue solo con lo que ya
          // loguea el SDK (mensaje genérico, sin causas).
        }
      }
    }
    return res;
  }) as typeof fetch;

  try {
    return await fn();
  } catch (err) {
    if (rawErrorBody && err instanceof Error) {
      (err as Error & { rawResponseBody?: string }).rawResponseBody = rawErrorBody;
    }
    throw err;
  } finally {
    globalThis.fetch = originalFetch;
  }
}
