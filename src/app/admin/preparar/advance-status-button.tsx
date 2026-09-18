"use client";

import { useState, useTransition } from "react";
import { advanceOrderStatusAction } from "@/modules/orders/fulfillment-status-actions";
import type { OrderStatus } from "@/modules/orders/types";

/**
 * Botones para mover un pedido pagado a lo largo de la entrega. No
 * piden confirmación: no cobran, no facturan y no tocan stock, y si
 * alguien se equivoca, el estado se vuelve a mover desde acá.
 */
export function AdvanceStatusButtons({
  orderId,
  options,
}: {
  orderId: string;
  options: { to: OrderStatus; label: string; primary?: boolean }[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handle(to: OrderStatus) {
    setError(null);
    startTransition(async () => {
      const res = await advanceOrderStatusAction(orderId, to);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="text-right">
      <div className="flex flex-wrap justify-end gap-2">
        {options.map((option) => (
          <button
            key={option.to}
            type="button"
            onClick={() => handle(option.to)}
            disabled={pending}
            className={`neu-btn !px-3 !py-1.5 !text-xs ${option.primary ? "neu-btn-primary" : ""}`}
          >
            {pending ? "Guardando…" : option.label}
          </button>
        ))}
      </div>
      {error && <p className="mt-1 max-w-[260px] text-[10px] text-danger">{error}</p>}
    </div>
  );
}
