"use client";

import { useState } from "react";
import { useCart } from "@/modules/cart/cart-context";

export function AddToCartButton({
  productId,
  slug,
  name,
  price,
  maxQuantity,
  imagePath,
}: {
  productId: string;
  slug: string;
  name: string;
  price: number;
  maxQuantity: number;
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
        min={1}
        max={maxQuantity}
        value={quantity}
        onChange={(e) => setQuantity(Math.min(maxQuantity, Math.max(1, Number(e.target.value))))}
        aria-label="Cantidad"
        className="neu-input w-20 !py-3 text-center tabular-nums"
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
