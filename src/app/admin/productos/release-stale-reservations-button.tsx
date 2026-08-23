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
        className="text-xs border border-neutral-300 rounded-md px-3 py-2 hover:bg-neutral-50 disabled:opacity-50"
      >
        {pending ? "Liberando..." : "Liberar reservas vencidas"}
      </button>
      {result?.error && <p className="text-[10px] text-red-600 mt-1 max-w-[200px]">{result.error}</p>}
      {result?.ok && (
        <p className="text-[10px] text-green-700 mt-1">
          {result.released} de {result.checked} pedidos abandonados liberados.
        </p>
      )}
    </div>
  );
}
