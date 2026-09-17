import Link from "next/link";
import type { ProductWithDisplayPrice } from "@/modules/products/product-service";
import type { CustomerType } from "@/modules/products/types";
import { ProductThumb } from "./product-thumb";

/** Tarjeta de producto del catálogo, igual en el inicio, las categorías y la búsqueda. */
export function ProductCard({
  product: p,
  customerType,
}: {
  product: ProductWithDisplayPrice;
  customerType: CustomerType | null;
}) {
  return (
    <Link href={`/producto/${p.slug}`} className="neu-card neu-interactive flex flex-col p-3 sm:p-4">
      <ProductThumb
        storagePath={p.images[0]?.storagePath}
        alt={p.name}
        className="mb-3 aspect-square rounded-neu"
      />
      {p.brand && (
        <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-subtle">{p.brand}</p>
      )}
      <p className="line-clamp-2 text-sm font-medium text-ink">{p.name}</p>
      <p className="mt-auto pt-2 text-base font-bold text-brand sm:text-lg">
        $ {p.displayPrice.toLocaleString("es-AR")}
        <span className="text-xs font-normal text-ink-subtle"> / {p.unit}</span>
      </p>
      {/* Con mínimo, una unidad va a precio minorista: se aclara desde
          cuántas aplica el mayorista (wholesale-pricing.ts). */}
      {customerType === "mayorista" && p.wholesaleMinQuantity > 1 && (
        <p className="text-xs font-medium text-success">
          Mayorista $ {p.priceWholesale.toLocaleString("es-AR")} desde {p.wholesaleMinQuantity} u.
        </p>
      )}
    </Link>
  );
}
