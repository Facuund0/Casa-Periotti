import { notFound } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { ProductService } from "@/modules/products/product-service";
import { getCurrentCustomer } from "@/modules/auth/current-user";
import { getAvailableStock } from "@/modules/products/types";
import { AddToCartButton } from "./add-to-cart-button";
import { ProductThumb } from "@/app/_components/product-thumb";
import { SiteHeader } from "@/app/_components/site-header";
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
    <main className="min-h-screen">
      <SiteHeader isLoggedIn={Boolean(customer)} />

      <div className="mx-auto max-w-4xl px-4 pb-16 pt-4">
        <Link href="/" className="neu-chip">
          ← Volver al catálogo
        </Link>

        <div className="mt-5 grid gap-6 md:grid-cols-2 md:gap-8">
          <div className="space-y-2">
            <ProductThumb
              storagePath={product.images[0]?.storagePath}
              alt={product.name}
              className="aspect-square rounded-neu-lg"
              sizes="(max-width: 768px) 100vw, 50vw"
              priority
            />
            {/* Las demás imágenes, si hay. Sin visor: son fotos de
                catálogo de corralón, no hace falta un lightbox. */}
            {product.images.length > 1 && (
              <div className="grid grid-cols-4 gap-2">
                {product.images.slice(1).map((image) => (
                  <ProductThumb
                    key={image.id}
                    storagePath={image.storagePath}
                    alt={image.altText ?? product.name}
                    className="aspect-square rounded-neu"
                    sizes="12vw"
                  />
                ))}
              </div>
            )}
          </div>

          <div className="neu-card p-5 sm:p-6">
            {product.brand && (
              <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                {product.brand}
              </p>
            )}
            <h1 className="mt-1 text-2xl font-bold text-ink">{product.name}</h1>
            <p className="mt-1 text-xs text-ink-subtle">SKU: {product.sku}</p>

            <p className="mt-4 text-3xl font-bold text-brand">
              $ {product.displayPrice.toLocaleString("es-AR")}
              <span className="text-sm font-normal text-ink-subtle"> / {product.unit}</span>
            </p>

            {customer?.customerType === "mayorista" &&
              (product.wholesaleMinQuantity > 1 ? (
                <p className="mt-2 text-sm text-ink-muted">
                  <span className="neu-badge bg-success-soft text-success">
                    Mayorista $ {product.priceWholesale.toLocaleString("es-AR")}
                  </span>{" "}
                  llevando {product.wholesaleMinQuantity} o más en el mismo pedido. Con menos, va a
                  precio minorista.
                </p>
              ) : (
                <span className="neu-badge mt-2 bg-success-soft text-success">
                  Precio mayorista aplicado
                </span>
              ))}
            {!customer && (
              <p className="mt-2 text-xs text-ink-muted">
                <Link href="/login" className="font-medium text-brand hover:underline">
                  Iniciá sesión
                </Link>{" "}
                para ver precios mayoristas si tenés cuenta habilitada.
              </p>
            )}

            {product.description && (
              <p className="mt-4 text-sm text-ink-muted">{product.description}</p>
            )}

            <p className="mt-4">
              <span
                className={`neu-badge ${
                  available > 0 ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
                }`}
              >
                {available > 0 ? `${available} disponibles` : "Sin stock por el momento"}
              </span>
            </p>

            <div className="mt-6">
              <AddToCartButton
                productId={product.id}
                slug={product.slug}
                name={product.name}
                price={product.displayPrice}
                maxQuantity={available}
                decimals={product.decimalQuantity}
                unit={product.unit}
                imagePath={product.images[0]?.storagePath}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
