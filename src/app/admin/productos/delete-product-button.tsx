"use client";

import { useState, useTransition } from "react";
import { deleteProductAction } from "@/modules/products/admin-actions";

/**
 * Borrado definitivo de un producto, para el que se cargó mal.
 *
 * Pide confirmación aparte porque no se puede deshacer, y aclara ahí
 * mismo la diferencia con Desactivar. Si el producto ya se vendió, el
 * servidor lo rechaza y muestra por qué (ver deletePermanently).
 */
export function DeleteProductButton({ productId, name }: { productId: string; name: string }) {
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteProductAction(productId);
      if (result.error) setError(result.error);
      else setAsking(false);
    });
  }

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="text-xs text-danger underline"
      >
        Borrar
      </button>
    );
  }

  return (
    <div className="neu-inset mt-2 max-w-[320px] p-3 text-left">
      <p className="text-xs text-ink">
        ¿Borrar <span className="font-semibold">{name}</span> para siempre? Se va con sus imágenes y
        no se puede recuperar.
      </p>
      <p className="mt-1 text-[11px] text-ink-subtle">
        Si alguna vez se vendió, no se puede borrar: para eso está Desactivar, que lo saca de la web
        y del mostrador dejando el historial.
      </p>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="neu-btn neu-btn-danger !px-3 !py-1.5 !text-xs"
        >
          {pending ? "Borrando…" : "Sí, borrar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setAsking(false);
            setError(null);
          }}
          disabled={pending}
          className="px-2 text-xs text-ink-muted hover:underline disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] text-danger">{error}</p>}
    </div>
  );
}
