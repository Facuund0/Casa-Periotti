import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { deactivateProductAction, reactivateProductAction } from "@/modules/products/admin-actions";
import { StockAdjustForm } from "./stock-adjust-form";
import { ReleaseStaleReservationsButton } from "./release-stale-reservations-button";

export const dynamic = "force-dynamic"; // el panel siempre necesita datos frescos, no cachear

export default async function AdminProductsPage() {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "stock"].includes(employee.role)) {
    redirect("/admin");
  }

  const supabase = await createClient();

  const { data: products, error } = await supabase
    .from("products")
    .select("id, sku, name, stock_quantity, stock_reserved, stock_minimum, price_retail, price_wholesale, active")
    .order("name");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-bold">Productos y stock</h1>
        <div className="flex items-center gap-3">
          <ReleaseStaleReservationsButton />
          <Link
            href="/admin/productos/nuevo"
            className="neu-btn neu-btn-primary"
          >
            + Nuevo producto
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-neu bg-warning-soft p-4 text-sm text-warning">
          No se pudo conectar a Supabase todavía. Revisá tu .env.local. ({error.message})
        </div>
      )}

      <div className="neu-card overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="neu-table-head text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Producto</th>
              <th className="text-left px-4 py-3">SKU</th>
              <th className="text-right px-4 py-3">Stock disponible</th>
              <th className="text-right px-4 py-3">Reservado</th>
              <th className="text-right px-4 py-3">Minorista</th>
              <th className="text-right px-4 py-3">Mayorista</th>
              <th className="text-center px-4 py-3">Ajustar stock</th>
              <th className="text-center px-4 py-3">Estado</th>
              <th className="text-right px-4 py-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {(products ?? []).map((p) => {
              const available = p.stock_quantity - p.stock_reserved;
              const isLow = available <= p.stock_minimum;
              return (
                <tr key={p.id} className="neu-row">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-ink-muted">{p.sku}</td>
                  <td className={`px-4 py-3 text-right ${isLow ? "text-danger font-semibold" : ""}`}>
                    {available}
                    {isLow && <span className="block text-[10px] font-normal">stock bajo</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-muted">
                    {p.stock_reserved > 0 ? p.stock_reserved : "—"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    $ {Number(p.price_retail).toLocaleString("es-AR")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    $ {Number(p.price_wholesale).toLocaleString("es-AR")}
                  </td>
                  <td className="px-4 py-3">
                    <StockAdjustForm productId={p.id} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`neu-badge ${
                        p.active ? "bg-success-soft text-success" : "bg-surface-sunken text-ink-muted"
                      }`}
                    >
                      {p.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <Link href={`/admin/productos/${p.id}`} className="text-xs underline">
                      Editar
                    </Link>
                    {p.active ? (
                      <form action={deactivateProductAction.bind(null, p.id)} className="inline">
                        <button className="text-xs text-danger underline">Desactivar</button>
                      </form>
                    ) : (
                      <form action={reactivateProductAction.bind(null, p.id)} className="inline">
                        <button className="text-xs text-success underline">Reactivar</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {(!products || products.length === 0) && !error && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-ink-subtle">
                  Todavía no cargaste productos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
