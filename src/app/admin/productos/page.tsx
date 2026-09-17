import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { deactivateProductAction, reactivateProductAction } from "@/modules/products/admin-actions";
import { StockAdjustForm } from "./stock-adjust-form";
import { ReleaseStaleReservationsButton } from "./release-stale-reservations-button";
import { SmartSearch } from "@/app/_components/smart-search";
import { suggestAdminProductsAction } from "@/modules/search/suggest-actions";
import { firstParam } from "@/shared/utils/search-params";

export const dynamic = "force-dynamic"; // el panel siempre necesita datos frescos, no cachear

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "stock"].includes(employee.role)) {
    redirect("/admin");
  }

  const q = (firstParam((await searchParams).q) ?? "").trim().slice(0, 80);
  const supabase = await createClient();
  const select =
    "id, sku, name, stock_quantity, stock_reserved, stock_minimum, price_retail, price_wholesale, active";

  // Con búsqueda: por nombre o SKU, con ilike() separados y los comodines
  // escapados (lo tipeado nunca va dentro de un filtro .or()).
  let products: ProductRow[] | null;
  let error: { message: string } | null;
  if (q) {
    const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const [byName, bySku] = await Promise.all([
      supabase.from("products").select(select).ilike("name", pattern).order("name"),
      supabase.from("products").select(select).ilike("sku", pattern).order("name"),
    ]);
    error = byName.error ?? bySku.error;
    const merged = new Map<string, ProductRow>();
    for (const p of [...(byName.data ?? []), ...(bySku.data ?? [])]) merged.set(p.id, p);
    products = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  } else {
    ({ data: products, error } = await supabase.from("products").select(select).order("name"));
  }

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

      <form method="get" action="/admin/productos" className="neu-card mb-4 flex flex-wrap items-end gap-3 p-4">
        <label htmlFor="productos-q" className="min-w-[220px] flex-1 text-xs text-ink-muted">
          <span className="mb-1 block">Buscar producto</span>
          <SmartSearch
            id="productos-q"
            name="q"
            defaultValue={q}
            placeholder="Nombre o SKU"
            suggest={suggestAdminProductsAction}
            submitOnSelect
            className="neu-input !py-1.5"
          />
        </label>
        <button className="neu-btn neu-btn-primary !px-4 !py-2 !text-xs">Buscar</button>
        {q && (
          <Link href="/admin/productos" className="px-1 py-2 text-xs text-ink-muted hover:underline">
            Limpiar
          </Link>
        )}
      </form>

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
                  {q ? `No hay productos que coincidan con “${q}”.` : "Todavía no cargaste productos."}
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

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  stock_quantity: number;
  stock_reserved: number;
  stock_minimum: number;
  price_retail: number;
  price_wholesale: number;
  active: boolean;
}
