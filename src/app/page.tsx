import { createClient } from "@/infrastructure/database/supabase-server";
import { ProductService } from "@/modules/products/product-service";
import { getCurrentCustomer } from "@/modules/auth/current-user";
import Link from "next/link";
import { ProductThumb } from "./_components/product-thumb";
import { SiteHeader } from "./_components/site-header";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const customer = await getCurrentCustomer();
  const productService = new ProductService(supabase);

  let categories: Awaited<ReturnType<ProductService["getCategories"]>> = [];
  let products: Awaited<ReturnType<ProductService["getCatalog"]>> = [];
  let connectionError: string | null = null;

  try {
    categories = await productService.getCategories();
    products = await productService.getCatalog(customer?.customerType ?? "minorista");
  } catch (err) {
    connectionError =
      err instanceof Error ? err.message : "Error desconocido al conectar con Supabase";
  }

  return (
    <main className="min-h-screen">
      <SiteHeader isLoggedIn={Boolean(customer)} />

      <div className="mx-auto max-w-6xl px-4 pb-16">
        {connectionError && (
          <div className="neu-card mt-4 p-4 sm:p-5">
            <p className="text-sm font-semibold text-warning">
              Todavía no está conectado a Supabase.
            </p>
            <p className="mt-1.5 text-sm text-ink-muted">
              Completá <code className="neu-inset px-1.5 py-0.5 text-xs">.env.local</code> con tu
              Project URL y anon key, y corré la migración{" "}
              <code className="neu-inset px-1.5 py-0.5 text-xs">
                supabase/migrations/0001_init.sql
              </code>{" "}
              en el SQL Editor de tu proyecto.
            </p>
            <p className="mt-2 text-xs text-ink-subtle">Detalle técnico: {connectionError}</p>
          </div>
        )}

        {customer?.customerType === "mayorista" && (
          <div className="neu-card mt-4 flex items-center gap-2 px-4 py-3">
            <span className="neu-badge bg-success-soft text-success">Mayorista</span>
            <p className="text-sm text-ink-muted">
              Estás viendo precios mayoristas. En los productos con cantidad mínima, el precio
              mayorista aplica desde esa cantidad.
            </p>
          </div>
        )}

        <section className="pt-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            Categorías
          </h2>
          {categories.length === 0 && !connectionError ? (
            <p className="text-sm text-ink-subtle">No hay categorías cargadas todavía.</p>
          ) : (
            <div className="flex flex-wrap gap-2.5">
              {categories.map((cat) => (
                <Link key={cat.id} href={`/categoria/${cat.slug}`} className="neu-chip">
                  {cat.name}
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="pt-8">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            Productos
          </h2>

          {products.length === 0 && !connectionError && (
            <div className="neu-flat p-6 text-center">
              <p className="text-sm text-ink-muted">Todavía no hay productos cargados.</p>
              <p className="mt-1 text-xs text-ink-subtle">
                Se cargan desde el panel interno, en Productos y stock.
              </p>
            </div>
          )}

          {/* 2 columnas en celular: con el ancho de una tarjeta
              neumórfica más chica las sombras se pisan entre sí. */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
            {products.map((p) => (
              <Link
                key={p.id}
                href={`/producto/${p.slug}`}
                className="neu-card neu-interactive flex flex-col p-3 sm:p-4"
              >
                <ProductThumb
                  storagePath={p.images[0]?.storagePath}
                  alt={p.name}
                  className="mb-3 aspect-square rounded-neu"
                />
                {p.brand && (
                  <p className="text-[0.6875rem] font-medium uppercase tracking-wide text-ink-subtle">
                    {p.brand}
                  </p>
                )}
                <p className="line-clamp-2 text-sm font-medium text-ink">{p.name}</p>
                <p className="mt-auto pt-2 text-base font-bold text-brand sm:text-lg">
                  $ {p.displayPrice.toLocaleString("es-AR")}
                  <span className="text-xs font-normal text-ink-subtle"> / {p.unit}</span>
                </p>
                {/* Con mínimo, una unidad va a precio minorista: se aclara
                    desde cuántas aplica el mayorista (wholesale-pricing.ts). */}
                {customer?.customerType === "mayorista" && p.wholesaleMinQuantity > 1 && (
                  <p className="text-xs font-medium text-success">
                    Mayorista $ {p.priceWholesale.toLocaleString("es-AR")} desde {p.wholesaleMinQuantity} u.
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
