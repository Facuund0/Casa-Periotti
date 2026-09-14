import { redirect } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { InvoiceListService, invoiceFiltersSchema } from "@/modules/billing/invoice-list-service";
import { firstParam } from "@/shared/utils/search-params";
import { FilterForm } from "../_components/filter-form";
import { Pagination } from "../_components/pagination";
import { ManualInvoiceForm } from "./manual-invoice-form";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  processing: "Procesando",
  authorized: "Autorizada",
  rejected: "Rechazada",
  retry_pending: "Reintentar",
  cancelled: "Cancelada",
};

export default async function AdminBillingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "facturacion"].includes(employee.role)) {
    redirect("/admin");
  }

  const raw = await searchParams;
  const filters = invoiceFiltersSchema.parse({
    from: firstParam(raw.from),
    to: firstParam(raw.to),
    status: firstParam(raw.status),
    q: firstParam(raw.q),
    page: firstParam(raw.page),
  });

  // Cliente de sesión: las facturas las lee el empleado con su propio
  // usuario, igual que antes — la RLS de invoices ya lo permite.
  const supabase = await createClient();
  const { rows, total, page, pageCount, pageSize } = await new InvoiceListService(supabase).list(
    filters
  );

  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Facturación</h1>
      <p className="text-sm text-neutral-500 mb-4">
        Comprobantes emitidos, del más reciente al más antiguo.
      </p>

      <FilterForm
        basePath="/admin/facturacion"
        from={filters.from}
        to={filters.to}
        status={filters.status}
        q={filters.q}
        statusOptions={[
          { value: "authorized", label: "Autorizada" },
          { value: "pending", label: "Pendiente (incluye procesando y reintentos)" },
          { value: "rejected", label: "Rechazada" },
          { value: "cancelled", label: "Cancelada" },
        ]}
        searchPlaceholder="Nombre del cliente o número de comprobante"
      />

      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden mb-8">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Fecha</th>
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-left px-4 py-3">Condición IVA</th>
                <th className="text-left px-4 py-3">Comprobante</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-center px-4 py-3">Estado</th>
                <th className="text-center px-4 py-3">Ambiente</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id} className="border-t border-neutral-100 align-top">
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap text-neutral-500">
                    {new Date(inv.createdAt).toLocaleString("es-AR")}
                  </td>
                  <td className="px-4 py-3">{inv.customerName}</td>
                  <td className="px-4 py-3 text-neutral-500">
                    {inv.buyerIvaCondition ?? "—"}
                    {inv.padronNote && (
                      <p
                        className={`text-[10px] mt-0.5 max-w-[220px] ${
                          inv.padronVerified ? "text-amber-600" : "text-neutral-400"
                        }`}
                      >
                        {inv.padronVerified ? "⚠️ " : "○ "}
                        {inv.padronNote}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">
                    {inv.voucherNumber
                      ? `${inv.invoiceType} ${String(inv.salesPoint).padStart(4, "0")}-${String(
                          inv.voucherNumber
                        ).padStart(8, "0")}`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                    $ {inv.total.toLocaleString("es-AR")}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${
                        inv.status === "authorized"
                          ? "bg-green-100 text-green-700"
                          : inv.status === "rejected"
                          ? "bg-red-100 text-red-700"
                          : "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {STATUS_LABELS[inv.status] ?? inv.status}
                    </span>
                    {(inv.status === "rejected" || inv.status === "retry_pending") &&
                      inv.rejectionReason && (
                        <p
                          className={`text-[10px] mt-1 max-w-[160px] mx-auto ${
                            inv.status === "rejected" ? "text-red-500" : "text-amber-600"
                          }`}
                        >
                          {inv.rejectionReason}
                        </p>
                      )}
                  </td>
                  <td className="px-4 py-3 text-center text-xs">
                    {inv.environment === "production" ? "Producción" : "Pruebas"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination
          basePath="/admin/facturacion"
          params={{
            from: filters.from,
            to: filters.to,
            status: filters.status,
            q: filters.q,
          }}
          page={page}
          pageCount={pageCount}
          total={total}
          pageSize={pageSize}
          emptyLabel="No hay facturas que coincidan con el filtro."
        />
      </div>

      {/* Sección secundaria y colapsada a propósito: no es el camino
          normal para facturar una venta (ver aviso dentro del form). */}
      <details className="bg-white rounded-lg border border-neutral-200 p-4">
        <summary className="text-sm font-medium cursor-pointer">
          Facturación manual (fletes, servicios, anticipos — no productos)
        </summary>
        <div className="mt-4">
          <ManualInvoiceForm />
        </div>
      </details>
    </div>
  );
}
