"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/modules/cart/cart-context";
import { ProductThumb } from "@/app/_components/product-thumb";
import { Logo } from "@/app/_components/logo";
import { useState } from "react";

export default function CarritoPage() {
  const { items, updateQuantity, removeItem, estimatedTotal } = useCart();
  const router = useRouter();
  const [goingToCheckout, setGoingToCheckout] = useState(false);

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-20 bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="rounded-neu-sm" aria-label="Casa Periotti — inicio">
            <Logo size="md" />
          </Link>
          <Link href="/" className="neu-chip">
            Seguir comprando
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 pb-16 pt-4">
        <h1 className="mb-5 text-xl font-bold text-ink">Tu carrito</h1>

        {items.length === 0 ? (
          <div className="neu-flat p-10 text-center">
            <p className="text-sm text-ink-muted">Todavía no agregaste productos.</p>
            <Link href="/" className="neu-btn neu-btn-primary mt-5">
              Ir al catálogo
            </Link>
          </div>
        ) : (
          <>
            <ul className="space-y-3">
              {items.map((item) => (
                <li key={item.productId} className="neu-card p-3 sm:p-4">
                  {/* En celular la fila se apila: nombre arriba, y
                      cantidad / importe / quitar en una línea abajo. */}
                  <div className="flex items-start gap-3 sm:items-center sm:gap-4">
                    <ProductThumb
                      storagePath={item.imagePath}
                      alt={item.name}
                      className="h-16 w-16 shrink-0 rounded-neu"
                      sizes="64px"
                    />
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/producto/${item.slug}`}
                        className="text-sm font-medium text-ink hover:text-brand"
                      >
                        {item.name}
                      </Link>
                      <p className="mt-0.5 text-xs text-ink-subtle">
                        $ {item.unitPrice.toLocaleString("es-AR")} c/u
                      </p>

                      <div className="mt-3 flex items-center justify-between gap-3 sm:hidden">
                        <QuantityInput
                          value={item.quantity}
                          onChange={(q) => updateQuantity(item.productId, q)}
                        />
                        <p className="text-sm font-bold tabular-nums text-ink">
                          $ {(item.unitPrice * item.quantity).toLocaleString("es-AR")}
                        </p>
                        <button
                          onClick={() => removeItem(item.productId)}
                          className="text-xs font-medium text-danger hover:underline"
                        >
                          Quitar
                        </button>
                      </div>
                    </div>

                    <div className="hidden items-center gap-4 sm:flex">
                      <QuantityInput
                        value={item.quantity}
                        onChange={(q) => updateQuantity(item.productId, q)}
                      />
                      <p className="w-24 text-right text-sm font-bold tabular-nums text-ink">
                        $ {(item.unitPrice * item.quantity).toLocaleString("es-AR")}
                      </p>
                      <button
                        onClick={() => removeItem(item.productId)}
                        className="text-xs font-medium text-danger hover:underline"
                      >
                        Quitar
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>

            <div className="neu-card mt-5 p-4 sm:p-5">
              <div className="flex items-end justify-between gap-4">
                <p className="text-xs text-ink-subtle">
                  El precio final se recalcula en el checkout (incluye IVA).
                </p>
                <div className="text-right">
                  <p className="text-xs text-ink-subtle">Estimado</p>
                  <p className="text-2xl font-bold tabular-nums text-brand">
                    $ {estimatedTotal.toLocaleString("es-AR")}
                  </p>
                </div>
              </div>

              <button
                disabled={goingToCheckout}
                onClick={() => {
                  setGoingToCheckout(true);
                  router.push("/checkout");
                }}
                className="neu-btn neu-btn-primary mt-4 w-full !py-3"
              >
                {goingToCheckout ? "Redirigiendo..." : "Continuar a checkout"}
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function QuantityInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (quantity: number) => void;
}) {
  return (
    <input
      type="number"
      min={1}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="Cantidad"
      className="neu-input w-20 !px-2 !py-1.5 text-center tabular-nums"
    />
  );
}
