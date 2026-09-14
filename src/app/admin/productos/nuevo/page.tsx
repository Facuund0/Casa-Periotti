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
      <h1 className="text-lg font-bold mb-1">Nuevo producto</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Al guardarlo se abre la edición, donde podés cargarle las imágenes.
      </p>
      <ProductForm categories={categories ?? []} action={createProductAction} showInitialStock />
    </div>
  );
}
