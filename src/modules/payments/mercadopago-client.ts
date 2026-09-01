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
