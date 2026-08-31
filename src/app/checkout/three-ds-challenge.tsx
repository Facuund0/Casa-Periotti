"use client";

import { useEffect, useRef, useState } from "react";

export type ThreeDsOutcome =
  | { status: "approved"; statusDetail: string | null }
  | { status: "rejected"; statusDetail: string | null }
  | { status: "cancelled"; statusDetail: string | null }
  | { status: "processing" | "pending"; statusDetail: string | null };

// Cuántas veces (y con qué espera entre cada una) se reintenta
// /api/payments/confirm-3ds después del postMessage "COMPLETE" antes de
// resignarse a mostrar el mismo mensaje de "pendiente" que usa el resto
// del checkout. COMPLETE solo avisa que el desafío terminó del lado del
// banco — Mercado Pago puede tardar un instante más en terminar de
// resolver la orden, así que una sola consulta inmediata no alcanza.
const POLL_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 1500;

export function ThreeDsChallenge({
  orderId,
  challengeUrl,
  onResolved,
}: {
  orderId: string;
  challengeUrl: string;
  onResolved: (outcome: ThreeDsOutcome) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const resolvedRef = useRef(false);
  const confirmingRef = useRef(false);
  const onResolvedRef = useRef(onResolved);

  useEffect(() => {
    onResolvedRef.current = onResolved;
  }, [onResolved]);

  useEffect(() => {
    async function confirm() {
      if (resolvedRef.current || confirmingRef.current) return;
      confirmingRef.current = true;
      setConfirming(true);
      try {
        for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
          try {
            const res = await fetch("/api/payments/confirm-3ds", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ orderId }),
            });
            const data = await res.json();
            if (res.ok && data.status && data.status !== "processing" && data.status !== "pending") {
              resolvedRef.current = true;
              onResolvedRef.current(data as ThreeDsOutcome);
              return;
            }
          } catch {
            // Falla de red en un intento puntual: se sigue reintentando
            // hasta agotar POLL_ATTEMPTS.
          }
          if (attempt < POLL_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
          }
        }
        if (!resolvedRef.current) {
          onResolvedRef.current({ status: "pending", statusDetail: null });
        }
      } finally {
        confirmingRef.current = false;
        setConfirming(false);
      }
    }

    function handleMessage(e: MessageEvent) {
      // El origen del iframe es el del banco/ACS, no el nuestro — no se
      // puede validar contra window.location.origin. Se confía en la
      // forma del mensaje (status: "COMPLETE") nada más como disparador
      // para volver a consultar; el resultado real siempre sale de
      // confirm-3ds contra la API de Mercado Pago, nunca del mensaje.
      if (e?.data?.status === "COMPLETE") confirm();
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [orderId]);

  return (
    <div>
      <p className="text-sm text-neutral-600 mb-3">
        {confirming
          ? "Confirmando el resultado con tu banco..."
          : "Tu banco necesita verificar tu identidad para autorizar este pago. Completá el paso de abajo sin cerrar ni recargar esta página."}
      </p>
      <iframe
        src={challengeUrl}
        title="Verificación de tu banco"
        className="w-full border border-neutral-200 rounded-md"
        style={{ height: 420 }}
      />
      <p className="text-xs text-neutral-400 mt-2">Tenés hasta 40 minutos para completar este paso.</p>
    </div>
  );
}
