import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { ProductService } from "@/modules/products/product-service";
import { getCurrentCustomer } from "@/modules/auth/current-user";

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
    <main className="min-h-screen bg-white">
      <header className="border-b border-neutral-200">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <Link href="/">
            <h1 className="text-xl font-bold tracking-tight">CASA PERIOTTI</h1>
            <p className="text-xs text-neutral-500">Sunchales, Santa Fe</p>
          </Link>
          <nav className="text-sm space-x-4">
            <Link href="/carrito" className="hover:underline">Carrito</Link>
            {customer ? (
              <Link href="/mi-cuenta" className="hover:underline">Mi cuenta</Link>
            ) : (
              <>
                <Link href="/login" className="hover:underline">Ingresar</Link>
                <Link href="/registro" className="hover:underline">Registrarme</Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-wrap gap-2 mb-6">
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/categoria/${cat.slug}`}
              className={`rounded-full border px-4 py-1.5 text-sm ${
                cat.slug === slug
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-300 hover:bg-neutral-100"
              }`}
            >
              {cat.name}
            </Link>
          ))}
        </div>

        <h2 className="text-lg font-bold mb-4">{category.name}</h2>

        {products.length === 0 && (
          <p className="text-sm text-neutral-400">
            Todavía no hay productos cargados en esta categoría.
          </p>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {products.map((p) => (
            <Link
              key={p.id}
              href={`/producto/${p.slug}`}
              className="rounded-lg border border-neutral-200 p-3 hover:shadow-md transition-shadow"
            >
              <div className="aspect-square bg-neutral-100 rounded-md mb-2" />
              <p className="text-sm font-medium line-clamp-2">{p.name}</p>
              <p className="text-sm text-neutral-500 mt-1">
                $ {p.displayPrice.toLocaleString("es-AR")}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
