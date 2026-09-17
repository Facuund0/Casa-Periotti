import { notFound, redirect } from "next/navigation";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { createClient } from "@/infrastructure/database/supabase-server";
import { updateProductAction } from "@/modules/products/admin-actions";
import { netFromGross } from "@/modules/products/pricing";
import { ProductForm } from "../product-form";
import { ProductImagesManager } from "../product-images-manager";

export default async function EditarProductoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Verificación propia, no depende del layout ni del proxy: mismo permiso
  // que el listado de productos.
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "stock"].includes(employee.role)) {
    redirect("/admin");
  }

  const { id } = await params;
  const supabase = await createClient();

  const [{ data: product }, { data: categories }, { data: images }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "sku, name, slug, description, brand, category_id, price_retail, price_wholesale, vat_rate, unit, stock_minimum"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("categories").select("id, name").eq("active", true).order("display_order"),
    supabase
      .from("product_images")
      .select("id, storage_path, alt_text, display_order")
      .eq("product_id", id)
      .order("display_order"),
  ]);

  if (!product) notFound();

  // Los precios se guardan CON IVA (de eso dependen los pedidos y la
  // facturación); el formulario los edita netos, así que acá se
  // convierten para mostrarlos. Ver pricing.ts.
  const vatRate = Number(product.vat_rate);

  return (
    <div>
      <h1 className="text-lg font-bold mb-6">Editar producto</h1>
      <ProductForm
        categories={categories ?? []}
        action={updateProductAction.bind(null, id)}
        defaultValues={{
          sku: product.sku,
          name: product.name,
          slug: product.slug,
          description: product.description,
          brand: product.brand,
          categoryId: product.category_id,
          priceRetailNet: netFromGross(Number(product.price_retail), vatRate),
          priceWholesaleNet: netFromGross(Number(product.price_wholesale), vatRate),
          vatRate,
          unit: product.unit,
          stockMinimum: product.stock_minimum,
        }}
        imagesSlot={
          <ProductImagesManager
            productId={id}
            images={(images ?? []).map((img) => ({
              id: img.id,
              storagePath: img.storage_path,
              altText: img.alt_text,
              displayOrder: img.display_order,
            }))}
          />
        }
      />
    </div>
  );
}
