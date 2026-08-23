import { notFound } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { ProductService } from "@/modules/products/product-service";
import { getCurrentCustomer } from "@/modules/auth/current-user";
import { getAvailableStock } from "@/modules/products/types";
import { AddToCartButton } from "./add-to-cart-button";
import Link from "next/link";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const customer = await getCurrentCustomer();
  const productService = new ProductService(supabase);

  const product = await productService.getProductDetail(slug, customer?.customerType ?? "minorista");
  if (!product) notFound();

  const available = getAvailableStock(product);

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-4xl px-4 py-8">
        <Link href="/" className="text-sm text-neutral-500 hover:underline">
          ← Volver al catálogo
        </Link>

        <div className="grid md:grid-cols-2 gap-8 mt-4">
          <div className="aspect-square bg-neutral-100 rounded-lg" />

          <div>
            {product.brand && (
              <p className="text-xs text-neutral-500 uppercase">{product.brand}</p>
            )}
            <h1 className="text-2xl font-bold mt-1">{product.name}</h1>
            <p className="text-xs text-neutral-400 mt-1">SKU: {product.sku}</p>

            <p className="text-3xl font-bold mt-4">
              $ {product.displayPrice.toLocaleString("es-AR")}
              <span className="text-sm font-normal text-neutral-500"> / {product.unit}</span>
            </p>

            {customer?.customerType === "mayorista" && (
              <p className="text-xs text-green-700 mt-1">Precio mayorista aplicado</p>
            )}
            {!customer && (
              <p className="text-xs text-neutral-500 mt-1">
                <Link href="/login" className="underline">
                  Iniciá sesión
                </Link>{" "}
                para ver precios mayoristas si tenés cuenta habilitada.
              </p>
            )}

            {product.description && (
              <p className="text-sm text-neutral-600 mt-4">{product.description}</p>
            )}

            <p className="text-xs text-neutral-500 mt-2">
              {available > 0 ? `${available} disponibles` : "Sin stock por el momento"}
            </p>

            <div className="mt-6">
              <AddToCartButton
                productId={product.id}
                slug={product.slug}
                name={product.name}
                price={product.displayPrice}
                maxQuantity={available}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
