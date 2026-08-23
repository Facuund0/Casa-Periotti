"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/modules/cart/cart-context";
import { useState } from "react";

export default function CarritoPage() {
  const { items, updateQuantity, removeItem, estimatedTotal } = useCart();
  const router = useRouter();
  const [goingToCheckout, setGoingToCheckout] = useState(false);

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-xl font-bold mb-6">Tu carrito</h1>

        {items.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-neutral-500">Todavía no agregaste productos.</p>
            <Link href="/" className="inline-block mt-4 text-sm underline">
              Ir al catálogo
            </Link>
          </div>
        ) : (
          <>
            <div className="divide-y divide-neutral-100 border-t border-b border-neutral-100">
              {items.map((item) => (
                <div key={item.productId} className="flex items-center gap-4 py-4">
                  <div className="w-16 h-16 bg-neutral-100 rounded-md shrink-0" />
                  <div className="flex-1">
                    <Link href={`/producto/${item.slug}`} className="text-sm font-medium hover:underline">
                      {item.name}
                    </Link>
                    <p className="text-xs text-neutral-500">
                      $ {item.unitPrice.toLocaleString("es-AR")} c/u
                    </p>
                  </div>
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) => updateQuantity(item.productId, Number(e.target.value))}
                    className="w-16 border border-neutral-300 rounded-md px-2 py-1 text-sm text-center"
                  />
                  <p className="w-24 text-right text-sm font-medium">
                    $ {(item.unitPrice * item.quantity).toLocaleString("es-AR")}
                  </p>
                  <button
                    onClick={() => removeItem(item.productId)}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Quitar
                  </button>
                </div>
              ))}
            </div>

            <div className="flex justify-between items-center mt-6">
              <p className="text-xs text-neutral-400">
                El precio final se recalcula en el checkout (incluye IVA).
              </p>
              <p className="text-lg font-bold">
                Estimado: $ {estimatedTotal.toLocaleString("es-AR")}
              </p>
            </div>

            <button
              disabled={goingToCheckout}
              onClick={() => {
                setGoingToCheckout(true);
                router.push("/checkout");
              }}
              className="w-full mt-4 bg-neutral-900 text-white rounded-md py-3 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
            >
              {goingToCheckout ? "Redirigiendo..." : "Continuar a checkout"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
