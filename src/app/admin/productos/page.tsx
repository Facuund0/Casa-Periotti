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
            className="bg-neutral-900 text-white text-sm rounded-md px-4 py-2 hover:bg-neutral-800"
          >
            + Nuevo producto
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 mb-4">
          No se pudo conectar a Supabase todavía. Revisá tu .env.local. ({error.message})
        </div>
      )}

      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
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
                <tr key={p.id} className="border-t border-neutral-100">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3 text-neutral-500">{p.sku}</td>
                  <td className={`px-4 py-3 text-right ${isLow ? "text-red-600 font-semibold" : ""}`}>
                    {available}
                    {isLow && <span className="block text-[10px] font-normal">stock bajo</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-500">
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
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        p.active ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"
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
                        <button className="text-xs text-red-600 underline">Desactivar</button>
                      </form>
                    ) : (
                      <form action={reactivateProductAction.bind(null, p.id)} className="inline">
                        <button className="text-xs text-green-700 underline">Reactivar</button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {(!products || products.length === 0) && !error && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-neutral-400">
                  Todavía no cargaste productos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
