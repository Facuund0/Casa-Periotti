"use client";

import { useState, useTransition } from "react";
import { adjustStockAction } from "@/modules/products/admin-actions";

export function StockAdjustForm({ productId }: { productId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs underline text-ink-muted">
        Ajustar
      </button>
    );
  }

  return (
    <form
      className="flex flex-col gap-1 items-center"
      action={(formData) => {
        setError(null);
        startTransition(async () => {
          const result = await adjustStockAction(formData);
          if (result.error) {
            setError(result.error);
          } else {
            setOpen(false);
          }
        });
      }}
    >
      <input type="hidden" name="productId" value={productId} />
      <div className="flex gap-1">
        <select name="movementType" className="neu-input !px-1.5 !py-1 !text-xs">
          <option value="entrada_compra">+ Compra</option>
          <option value="ajuste">Ajuste</option>
          <option value="merma">Merma</option>
          <option value="devolucion">Devolución</option>
        </select>
        <input
          name="quantityDelta"
          type="number"
          placeholder="±cant."
          required
          className="neu-input w-16 !px-1.5 !py-1 !text-xs"
        />
      </div>
      <input
        name="reason"
        placeholder="Motivo"
        required
        className="neu-input !px-1.5 !py-1 !text-xs"
      />
      <div className="flex gap-1">
        <button
          type="submit"
          disabled={pending}
          className="text-xs bg-brand text-white rounded px-2 py-0.5 disabled:opacity-50"
        >
          {pending ? "..." : "Guardar"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-subtle">
          Cancelar
        </button>
      </div>
      {error && <p className="text-[10px] text-danger">{error}</p>}
    </form>
  );
}
