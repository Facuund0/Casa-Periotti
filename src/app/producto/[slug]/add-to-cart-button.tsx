"use client";

import { useState } from "react";
import { useCart } from "@/modules/cart/cart-context";
import { normalizeQuantity } from "@/shared/utils/quantity";

export function AddToCartButton({
  productId,
  slug,
  name,
  price,
  maxQuantity,
  decimals = false,
  unit,
  imagePath,
}: {
  productId: string;
  slug: string;
  name: string;
  price: number;
  maxQuantity: number;
  /** Productos que se miden (m³, kg, metros): se puede pedir 2,5. */
  decimals?: boolean;
  unit?: string;
  imagePath?: string | null;
}) {
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  if (maxQuantity <= 0) {
    return (
      <button disabled className="neu-btn w-full !py-3">
        Sin stock
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <input
        type="number"
        min={decimals ? 0.001 : 1}
        step={decimals ? "any" : 1}
        max={maxQuantity}
        value={quantity}
        onChange={(e) => {
          const wanted = normalizeQuantity(Number(e.target.value), decimals);
          if (wanted !== null) setQuantity(Math.min(maxQuantity, wanted));
        }}
        aria-label={unit ? `Cantidad en ${unit}` : "Cantidad"}
        className="neu-input w-24 !py-3 text-center tabular-nums"
      />
      <button
        onClick={() => {
          addItem({ productId, slug, name, unitPrice: price, imagePath }, quantity);
          setAdded(true);
          setTimeout(() => setAdded(false), 1500);
        }}
        className={`neu-btn flex-1 !py-3 ${added ? "" : "neu-btn-primary"}`}
      >
        {added ? "¡Agregado!" : "Agregar al carrito"}
      </button>
    </div>
  );
}
