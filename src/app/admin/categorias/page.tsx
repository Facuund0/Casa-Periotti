import { redirect } from "next/navigation";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { CategoryAdminService } from "@/modules/products/category-admin-service";
import { CategoryManager } from "./category-manager";

export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  const employee = await getCurrentEmployee();
  // Mismos roles que pueden editar productos.
  if (!employee || !["admin", "super_admin", "stock"].includes(employee.role)) {
    redirect("/admin");
  }

  // Cliente admin: el listado incluye las categorías inactivas, que la
  // RLS de lectura pública no devuelve.
  const categories = await new CategoryAdminService(createAdminClient(), employee).list();

  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Categorías</h1>
      <p className="text-sm text-neutral-500 mb-6 max-w-2xl">
        Las categorías activas son las que se ven en el catálogo. Una categoría con productos no se
        puede borrar: si no la usás más, <span className="font-medium">desactivala</span> — deja de
        aparecer en la web y los productos siguen intactos.
      </p>

      <CategoryManager categories={categories} />
    </div>
  );
}
