"use client";

import { useState, useTransition } from "react";
import {
  confirmTransferPaymentAction,
  rejectTransferPaymentAction,
} from "@/modules/orders/admin-actions";

/**
 * Confirmar o rechazar una transferencia desde /admin/pedidos.
 *
 * Confirmar dispara el mismo flujo que un pago aprobado: descuenta
 * stock, factura con ARCA y manda el email al cliente. Por eso pide
 * confirmación explícita antes — no es una acción que convenga poder
 * disparar con un clic accidental.
 */
export function VerifyPaymentButtons({ orderId }: { orderId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; ok?: boolean; note?: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  function handleConfirm() {
    setResult(null);
    startTransition(async () => {
      const res = await confirmTransferPaymentAction(orderId);
      setResult(res);
      if (res.ok) setConfirming(false);
    });
  }

  function handleReject() {
    setResult(null);
    startTransition(async () => {
      const res = await rejectTransferPaymentAction(orderId, reason);
      setResult(res);
      if (res.ok) setRejecting(false);
    });
  }

  if (result?.ok) {
    return (
      <p className="text-xs text-green-700 text-right max-w-[220px]">
        {result.note ?? "Listo. El pedido se actualizó."}
      </p>
    );
  }

  return (
    <div className="text-right space-y-2">
      {!confirming && !rejecting && (
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="text-xs bg-neutral-900 text-white rounded-md px-3 py-1.5"
          >
            Confirmar pago
          </button>
          <button
            type="button"
            onClick={() => setRejecting(true)}
            className="text-xs border border-neutral-300 rounded-md px-3 py-1.5 hover:bg-neutral-50"
          >
            Rechazar
          </button>
        </div>
      )}

      {confirming && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-left max-w-[280px]">
          <p className="text-xs text-neutral-700 mb-2">
            ¿Verificaste la transferencia en el homebanking? Al confirmar se descuenta el stock, se
            emite la factura y se le avisa al cliente.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={pending}
              className="text-xs bg-neutral-900 text-white rounded-md px-3 py-1.5 disabled:opacity-50"
            >
              {pending ? "Confirmando..." : "Sí, confirmar"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="text-xs text-neutral-500 px-2 hover:underline disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {rejecting && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-left max-w-[280px]">
          <p className="text-xs text-neutral-700 mb-2">
            Se libera el stock reservado. Contá brevemente por qué (queda registrado):
          </p>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: no figura la transferencia"
            className="w-full border border-neutral-300 rounded-md px-2 py-1.5 text-xs mb-2"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleReject}
              disabled={pending || reason.trim().length < 3}
              className="text-xs bg-red-600 text-white rounded-md px-3 py-1.5 disabled:opacity-50"
            >
              {pending ? "Rechazando..." : "Rechazar pago"}
            </button>
            <button
              type="button"
              onClick={() => setRejecting(false)}
              disabled={pending}
              className="text-xs text-neutral-500 px-2 hover:underline disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {result?.error && (
        <p className="text-[10px] text-red-600 max-w-[280px] text-right">{result.error}</p>
      )}
    </div>
  );
}
