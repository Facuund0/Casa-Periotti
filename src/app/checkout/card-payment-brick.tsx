"use client";

import { useEffect, useState } from "react";
import Script from "next/script";

// Tipado mínimo del SDK de Mercado Pago (no publica tipos oficiales para el browser)
interface MercadoPagoBrickController {
  unmount: () => void;
}
interface MercadoPagoInstance {
  bricks: () => {
    create: (
      type: "cardPayment",
      containerId: string,
      settings: Record<string, unknown>
    ) => Promise<MercadoPagoBrickController>;
  };
}
declare global {
  interface Window {
    MercadoPago?: new (publicKey: string) => MercadoPagoInstance;
    // Device ID: la documentación de MP dice que alcanza con el SDK JS
    // v2 para que se genere solo, pero no se pudo confirmar en un
    // navegador real que efectivamente quede seteado antes del submit
    // — por eso se agrega también, explícitamente, el script de
    // seguridad (ver más abajo) que la propia documentación indica
    // como forma directa de generarlo. Es un factor clave para la
    // aprobación de pagos; los console.log de esta pantalla y del
    // backend confirman en los logs si llegó con valor o no.
    MP_DEVICE_SESSION_ID?: string;
  }
}

export interface CardPaymentSubmitData {
  token: string;
  payment_method_id: string;
  // "credit_card" | "debit_card" — el Brick lo manda en additionalData
  // (segundo argumento de onSubmit), NO en formData/CardData (primer
  // argumento) — ver el onSubmit del Brick más abajo. La API de Orders
  // lo exige dentro de payment_method (confirmado contra la API real:
  // sin esto, POST /v1/orders responde 400 "missing properties: type"
  // — a diferencia de la API de Payments, donde no hacía falta).
  payment_type_id?: string;
  issuer_id?: string;
  installments: number;
  payer: {
    identification?: { type: string; number: string };
  };
  deviceId?: string;
}

export function CardPaymentBrick({
  amount,
  payerEmail,
  onSubmit,
}: {
  amount: number;
  payerEmail?: string;
  onSubmit: (data: CardPaymentSubmitData) => Promise<void>;
}) {
  const [sdkReady, setSdkReady] = useState(false);
  const [securityScriptReady, setSecurityScriptReady] = useState(false);
  const [brickReady, setBrickReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerId = "cardPaymentBrick_container";

  useEffect(() => {
    if (!sdkReady || !securityScriptReady) return;
    const publicKey = process.env.NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY;

    if (!publicKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- error de configuración detectado recién al montar el SDK externo
      setError(
        "Falta configurar NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY en .env.local (Public Key de prueba de tu cuenta de Mercado Pago)."
      );
      return;
    }
    if (!window.MercadoPago) return;

    // create() es asincrónico: si el efecto se limpia antes de que
    // resuelva (React monta los efectos dos veces en desarrollo), el
    // cleanup de abajo corre ANTES de tener un controller para
    // desmontar. Sin este flag, ese controller queda huérfano montado
    // en vez de desmontarse — de ahí el "Cargando formulario de
    // pago..." que se queda colgado de forma intermitente.
    let cancelled = false;
    let controller: MercadoPagoBrickController | null = null;

    const mp = new window.MercadoPago(publicKey);

    mp.bricks()
      .create("cardPayment", containerId, {
        initialization: {
          amount,
          payer: payerEmail ? { email: payerEmail } : undefined,
        },
        customization: { visual: { style: { theme: "default" } } },
        callbacks: {
          onReady: () => {
            setBrickReady(true);
          },
          onError: (err: unknown) => {
            console.error("Card Payment Brick error:", err);
            setError("Hubo un problema al cargar el formulario de pago. Recargá la página.");
          },
          onSubmit: async (arg: unknown, additionalDataArg?: unknown) => {
            const data =
              (arg as { formData?: CardPaymentSubmitData })?.formData ??
              (arg as CardPaymentSubmitData);
            const deviceId = window.MP_DEVICE_SESSION_ID;
            // Verificación explícita: si esto muestra "(undefined)" en
            // producción, el Device ID no está llegando a Mercado Pago
            // pese al script de seguridad — hay que revisar si algo lo
            // está bloqueando (adblock, CSP, script.js no cargó a tiempo).
            console.log("[CardPaymentBrick] window.MP_DEVICE_SESSION_ID al enviar el pago:", deviceId ?? "(undefined)");

            // paymentTypeId ("credit_card"/"debit_card") NO viene en el
            // primer argumento (CardData/formData) — confirmado contra
            // la documentación técnica oficial del SDK
            // (github.com/mercadopago/sdk-js, docs/bricks/card-payment.md):
            // onSubmit(cardData, additionalData) recibe DOS argumentos
            // separados, y paymentTypeId vive en additionalData (junto
            // con bin/lastFourDigits/cardholderName). Antes de este fix
            // solo se leía el primer argumento, por eso payment_type_id
            // siempre llegaba undefined al backend.
            const additionalData = additionalDataArg as { paymentTypeId?: string } | undefined;
            const paymentTypeId = additionalData?.paymentTypeId;
            console.log(
              "[CardPaymentBrick] paymentTypeId (additionalData) al enviar el pago:",
              paymentTypeId ?? "(undefined)"
            );

            // El Brick espera una Promise: si se rechaza, muestra un
            // error dentro del propio formulario y deja reintentar.
            await onSubmit({ ...data, payment_type_id: paymentTypeId, deviceId });
          },
        },
      })
      .then((created) => {
        if (cancelled) {
          // El efecto ya se limpió mientras create() estaba en vuelo:
          // se desmonta enseguida en vez de dejarlo huérfano.
          created.unmount();
          return;
        }
        controller = created;
      });

    return () => {
      cancelled = true;
      controller?.unmount();
      controller = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkReady, securityScriptReady, amount, payerEmail]);

  return (
    <div>
      <Script
        src="https://sdk.mercadopago.com/js/v2"
        onLoad={() => setSdkReady(true)}
        strategy="afterInteractive"
      />
      {/* Genera window.MP_DEVICE_SESSION_ID (Device ID) — según la
          documentación de MP no haría falta si ya se usa el SDK JS v2,
          pero se agrega explícitamente porque en la práctica llegaba
          undefined al submit. El efecto que monta el Brick espera a que
          este script termine de cargar (securityScriptReady) antes de
          crearlo, para que el valor esté disponible al pagar. */}
      <Script
        src="https://www.mercadopago.com/v2/security.js"
        onLoad={() => {
          // onLoad dispara apenas termina de DESCARGARSE security.js,
          // pero en la práctica window.MP_DEVICE_SESSION_ID puede tardar
          // un instante más en quedar seteado (el script hace trabajo
          // interno asincrónico antes de exponerlo) — confirmado en
          // producción: pagos posteriores al deploy de este script
          // igual llegaron a Mercado Pago con "security:none" en el
          // tracking_id. Se sondea la variable en vez de confiar solo
          // en el evento, para no montar el Brick antes de que exista.
          let attempts = 0;
          const maxAttempts = 20; // ~4s a 200ms cada uno
          const poll = () => {
            attempts += 1;
            if (window.MP_DEVICE_SESSION_ID || attempts >= maxAttempts) {
              if (!window.MP_DEVICE_SESSION_ID) {
                console.warn(
                  `[CardPaymentBrick] window.MP_DEVICE_SESSION_ID no quedó seteado tras ${
                    maxAttempts * 200
                  }ms de cargado security.js — el pago va a salir sin Device ID.`
                );
              }
              setSecurityScriptReady(true);
              return;
            }
            setTimeout(poll, 200);
          };
          poll();
        }}
        strategy="afterInteractive"
        // "view" no es un atributo HTML estándar, así que no está en el
        // tipado de next/script — lo pide igual la documentación de MP.
        {...({ view: "checkout" } as Record<string, string>)}
      />
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm p-3 mb-3">
          {error}
        </div>
      )}
      {!brickReady && !error && (
        <p className="text-sm text-neutral-400 mb-3">Cargando formulario de pago...</p>
      )}
      <div id={containerId} />
    </div>
  );
}
