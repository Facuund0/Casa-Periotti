import Link from "next/link";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentCustomer } from "@/modules/auth/current-user";
import { ProductService } from "@/modules/products/product-service";
import { firstParam } from "@/shared/utils/search-params";
import { ProductCard } from "../_components/product-card";
import { SiteHeader } from "../_components/site-header";

export const dynamic = "force-dynamic";

/** Resultados del buscador del catálogo: por nombre, marca o código. */
export default async function BuscarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = (firstParam((await searchParams).q) ?? "").trim().slice(0, 80);
  const [supabase, customer] = await Promise.all([createClient(), getCurrentCustomer()]);
  const products = q
    ? await new ProductService(supabase).searchCatalog(q, customer?.customerType ?? "minorista")
    : [];

  return (
    <main className="min-h-screen">
      <SiteHeader isLoggedIn={Boolean(customer)} searchQuery={q} />

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-6">
        {!q ? (
          <p className="text-sm text-ink-muted">Escribí qué buscás en el buscador de arriba.</p>
        ) : (
          <>
            <h1 className="mb-4 text-lg font-bold text-ink text-balance">
              {products.length === 0
                ? `No encontramos productos para “${q}”`
                : `${products.length} ${products.length === 1 ? "resultado" : "resultados"} para “${q}”`}
            </h1>

            {products.length === 0 ? (
              <div className="neu-flat p-6 text-center">
                <p className="text-sm text-ink-muted">
                  Probá con otra palabra, la marca o el código del producto.
                </p>
                <Link href="/" className="neu-btn neu-btn-primary mt-4">
                  Ver todo el catálogo
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
                {products.map((p) => (
                  <ProductCard key={p.id} product={p} customerType={customer?.customerType ?? null} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
