"use client";

import { useState, useTransition } from "react";
import { releaseStaleReservationsAction } from "@/modules/orders/admin-actions";

export function ReleaseStaleReservationsButton() {
  const [result, setResult] = useState<{ error?: string; ok?: boolean; checked?: number; released?: number } | null>(
    null
  );
  const [pending, startTransition] = useTransition();

  function handleClick() {
    setResult(null);
    startTransition(async () => {
      const res = await releaseStaleReservationsAction();
      setResult(res);
    });
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="neu-btn !px-3 !py-2 !text-xs"
      >
        {pending ? "Liberando..." : "Liberar reservas vencidas"}
      </button>
      {result?.error && <p className="text-[10px] text-danger mt-1 max-w-[200px]">{result.error}</p>}
      {result?.ok && (
        <p className="text-[10px] text-success mt-1">
          {result.released} de {result.checked} pedidos abandonados liberados.
        </p>
      )}
    </div>
  );
}
