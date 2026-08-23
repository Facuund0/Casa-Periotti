import { createClient } from "@/infrastructure/database/supabase-server";
import { createProductAction } from "@/modules/products/admin-actions";
import { ProductForm } from "../product-form";

export default async function NuevoProductoPage() {
  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name")
    .eq("active", true)
    .order("display_order");

  return (
    <div>
      <h1 className="text-lg font-bold mb-6">Nuevo producto</h1>
      <ProductForm categories={categories ?? []} action={createProductAction} showInitialStock />
    </div>
  );
}
