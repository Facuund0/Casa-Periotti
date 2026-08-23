import { createClient } from "@/infrastructure/database/supabase-server";
import { ProductService } from "@/modules/products/product-service";
import { getCurrentCustomer } from "@/modules/auth/current-user";
import Link from "next/link";

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
    <main className="min-h-screen bg-white">
      <header className="border-b border-neutral-200">
        <div className="mx-auto max-w-6xl px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">CASA PERIOTTI</h1>
            <p className="text-xs text-neutral-500">Sunchales, Santa Fe</p>
          </div>
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

      {connectionError && (
        <div className="mx-auto max-w-6xl px-4 py-4">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-semibold">Todavía no está conectado a Supabase.</p>
            <p className="mt-1">
              Completá <code className="bg-amber-100 px-1 rounded">.env.local</code> con tu
              Project URL y anon key, y corré la migración{" "}
              <code className="bg-amber-100 px-1 rounded">supabase/migrations/0001_init.sql</code>{" "}
              en el SQL Editor de tu proyecto.
            </p>
            <p className="mt-2 text-xs text-amber-700">Detalle técnico: {connectionError}</p>
          </div>
        </div>
      )}

      <section className="mx-auto max-w-6xl px-4 py-6">
        <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide mb-3">
          Categorías
        </h2>
        <div className="flex flex-wrap gap-2">
          {categories.length === 0 && !connectionError && (
            <p className="text-sm text-neutral-400">No hay categorías cargadas todavía.</p>
          )}
          {categories.map((cat) => (
            <Link
              key={cat.id}
              href={`/categoria/${cat.slug}`}
              className="rounded-full border border-neutral-300 px-4 py-1.5 text-sm hover:bg-neutral-100"
            >
              {cat.name}
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-6">
        <h2 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide mb-3">
          Productos
        </h2>
        {products.length === 0 && !connectionError && (
          <p className="text-sm text-neutral-400">
            Todavía no cargaste productos. Podés hacerlo desde el SQL Editor de Supabase o
            desde el panel interno (fase siguiente).
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
