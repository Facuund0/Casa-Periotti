import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { ProductService } from "@/modules/products/product-service";
import { getCurrentCustomer } from "@/modules/auth/current-user";
import { ProductCard } from "@/app/_components/product-card";
import { SiteHeader } from "@/app/_components/site-header";

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const customer = await getCurrentCustomer();
  const productService = new ProductService(supabase);

  const categories = await productService.getCategories();
  const category = categories.find((c) => c.slug === slug);
  if (!category) notFound();

  const products = await productService.getCatalog(customer?.customerType ?? "minorista", slug);

  return (
    <main className="min-h-screen">
      <SiteHeader isLoggedIn={Boolean(customer)} />

      <div className="mx-auto max-w-6xl px-4 pb-16 pt-4">
        {/* La categoría abierta se dibuja hundida: es el mismo lenguaje
            que usa el panel para la sección activa. */}
        <div className="mb-6 flex flex-wrap gap-2.5">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/categoria/${cat.slug}`}
              aria-current={cat.slug === slug ? "page" : undefined}
              className={`neu-chip ${cat.slug === slug ? "neu-chip-active font-semibold" : ""}`}
            >
              {cat.name}
            </Link>
          ))}
        </div>

        <h1 className="mb-4 text-xl font-bold text-ink">{category.name}</h1>

        {products.length === 0 ? (
          <div className="neu-flat p-8 text-center">
            <p className="text-sm text-ink-muted">
              Todavía no hay productos cargados en esta categoría.
            </p>
            <Link href="/" className="neu-btn mt-4">
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
      </div>
    </main>
  );
}
