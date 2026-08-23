"use client";

import { useState } from "react";
import { useCart } from "@/modules/cart/cart-context";

export function AddToCartButton({
  productId,
  slug,
  name,
  price,
  maxQuantity,
}: {
  productId: string;
  slug: string;
  name: string;
  price: number;
  maxQuantity: number;
}) {
  const { addItem } = useCart();
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  if (maxQuantity <= 0) {
    return (
      <button disabled className="w-full bg-neutral-200 text-neutral-500 rounded-md py-2.5 text-sm">
        Sin stock
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={1}
        max={maxQuantity}
        value={quantity}
        onChange={(e) => setQuantity(Math.min(maxQuantity, Math.max(1, Number(e.target.value))))}
        className="w-16 border border-neutral-300 rounded-md px-2 py-2 text-sm text-center"
      />
      <button
        onClick={() => {
          addItem({ productId, slug, name, unitPrice: price }, quantity);
          setAdded(true);
          setTimeout(() => setAdded(false), 1500);
        }}
        className="flex-1 bg-neutral-900 text-white rounded-md py-2.5 text-sm font-medium hover:bg-neutral-800"
      >
        {added ? "¡Agregado!" : "Agregar al carrito"}
      </button>
    </div>
  );
}
