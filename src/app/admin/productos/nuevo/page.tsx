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
      <ProductForm
        categories={categories ?? []}
        action={createProductAction}
        showInitialStock
        // Se muestra el hueco de las imágenes aunque todavía no se
        // puedan cargar: si la sección no apareciera, no habría dónde
        // buscarla y no quedaría claro que el paso existe.
        imagesSlot={
          <div className="neu-inset p-4">
            <p className="text-sm font-medium text-ink">Imágenes</p>
            <p className="text-xs text-ink-muted mt-1">
              Se cargan una vez que el producto existe. Al guardar se abre la edición y ahí mismo
              vas a poder subirlas, ordenarlas y borrarlas.
            </p>
          </div>
        }
      />
    </div>
  );
}
