import { notFound } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { updateProductAction } from "@/modules/products/admin-actions";
import { ProductForm } from "../product-form";

export default async function EditarProductoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: product }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select(
        "sku, name, slug, description, brand, category_id, price_retail, price_wholesale, vat_rate, unit, stock_minimum"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("categories").select("id, name").eq("active", true).order("display_order"),
  ]);

  if (!product) notFound();

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
          priceRetail: Number(product.price_retail),
          priceWholesale: Number(product.price_wholesale),
          vatRate: Number(product.vat_rate),
          unit: product.unit,
          stockMinimum: product.stock_minimum,
        }}
      />
    </div>
  );
}
