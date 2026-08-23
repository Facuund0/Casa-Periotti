"use client";

import { useState, useTransition } from "react";
import { reconcilePaymentAction } from "@/modules/orders/admin-actions";

const STATUS_LABELS: Record<string, string> = {
  approved: "Aprobado — pedido confirmado",
  rejected: "Rechazado — stock liberado",
  cancelled: "Cancelado — stock liberado",
  processing: "Sigue en revisión en Mercado Pago",
  pending: "Sigue pendiente en Mercado Pago",
};

export function ReconcilePaymentButton({ orderId }: { orderId: string }) {
  const [result, setResult] = useState<{ error?: string; ok?: boolean; status?: string } | null>(
    null
  );
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      const res = await reconcilePaymentAction(orderId);
      setResult(res);
    });
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="text-xs bg-neutral-900 text-white rounded-md px-3 py-1.5 disabled:opacity-50"
      >
        {pending ? "Consultando..." : "Consultar estado del pago"}
      </button>
      {result?.error && <p className="text-[10px] text-red-600 mt-1 max-w-[220px]">{result.error}</p>}
      {result?.ok && (
        <p className="text-[10px] text-green-700 mt-1">
          {STATUS_LABELS[result.status ?? ""] ?? result.status}
        </p>
      )}
    </div>
  );
}
