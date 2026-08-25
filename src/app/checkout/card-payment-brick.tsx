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
    // Device ID: lo genera el propio SDK JS v2 apenas se instancia
    // `new MercadoPago(...)` (no hace falta agregar el script de
    // seguridad aparte). Es un factor clave para la aprobación de pagos.
    MP_DEVICE_SESSION_ID?: string;
  }
}

export interface CardPaymentSubmitData {
  token: string;
  payment_method_id: string;
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
  const [brickReady, setBrickReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerId = "cardPaymentBrick_container";

  useEffect(() => {
    if (!sdkReady) return;
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
          onSubmit: async (arg: unknown) => {
            const data =
              (arg as { formData?: CardPaymentSubmitData })?.formData ??
              (arg as CardPaymentSubmitData);
            // El Brick espera una Promise: si se rechaza, muestra un
            // error dentro del propio formulario y deja reintentar.
            await onSubmit({ ...data, deviceId: window.MP_DEVICE_SESSION_ID });
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
  }, [sdkReady, amount, payerEmail]);

  return (
    <div>
      <Script
        src="https://sdk.mercadopago.com/js/v2"
        onLoad={() => setSdkReady(true)}
        strategy="afterInteractive"
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
