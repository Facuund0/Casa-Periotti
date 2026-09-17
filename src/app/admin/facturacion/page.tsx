import { redirect } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { InvoiceListService, invoiceFiltersSchema } from "@/modules/billing/invoice-list-service";
import { firstParam } from "@/shared/utils/search-params";
import { FilterForm } from "../_components/filter-form";
import { Pagination } from "../_components/pagination";
import { BusinessSettingsService } from "@/modules/billing/business-settings-service";
import { InvoiceRowActions } from "./invoice-row-actions";
import { ManualInvoiceForm } from "./manual-invoice-form";
import { suggestInvoicesAction } from "@/modules/search/suggest-actions";

import { formatDateTimeAR } from "@/shared/utils/argentina-time";
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
    fiscal: firstParam(raw.fiscal),
  });

  // Cliente de sesión: las facturas las lee el empleado con su propio
  // usuario, igual que antes — la RLS de invoices ya lo permite.
  const supabase = await createClient();
  // Listado y datos fiscales en paralelo. Sin datos fiscales cargados no
  // se puede emitir nada: conviene que quien entra a facturar lo vea acá y
  // no recién al fallar una venta.
  const [{ rows, total, page, pageCount, pageSize }, settings] = await Promise.all([
    new InvoiceListService(supabase).list(filters),
    new BusinessSettingsService(supabase).get().catch(() => null),
  ]);
  const missingFiscalData = BusinessSettingsService.missingFields(settings);

  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Facturación</h1>
      <p className="text-sm text-ink-muted mb-4">
        Comprobantes emitidos, del más reciente al más antiguo.
      </p>

      {missingFiscalData.length > 0 && (
        <div className="mb-4 rounded-neu bg-warning-soft p-3 text-sm font-medium text-warning">
          <p className="font-medium">No se puede facturar todavía.</p>
          <p className="mt-1">
            Faltan datos fiscales de Casa Periotti: {missingFiscalData.join(", ")}. Los carga un
            super_admin en Datos fiscales.
          </p>
        </div>
      )}

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
        suggest={suggestInvoicesAction}
        extraActive={Boolean(filters.fiscal)}
        extraFilters={
          <label className="flex items-center gap-2 py-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              name="fiscal"
              value="unverified"
              defaultChecked={filters.fiscal === "unverified"}
            />
            Solo condición fiscal no verificada
          </label>
        }
      />

      <div className="neu-card mb-8 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="neu-table-head text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Fecha</th>
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-left px-4 py-3">Condición IVA</th>
                <th className="text-left px-4 py-3">Comprobante</th>
                <th className="text-right px-4 py-3">Total</th>
                <th className="text-center px-4 py-3">Estado</th>
                <th className="text-center px-4 py-3">Ambiente</th>
                <th className="text-right px-4 py-3">Comprobante</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id} className="neu-row align-top">
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap text-ink-muted">
                    {formatDateTimeAR(inv.createdAt)}
                  </td>
                  <td className="px-4 py-3">{inv.customerName}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {inv.buyerIvaCondition ?? "—"}
                    {/* Se pidió con datos fiscales pero el padrón no permitió
                        verificar la condición: se emitió B. Si correspondía
                        A, se anula con nota de crédito y se reemite. */}
                    {inv.fiscalVerification === "unverified" && (
                      <span className="neu-badge mt-1 block w-fit bg-warning-soft text-warning">
                        Condición fiscal no verificada
                      </span>
                    )}
                    {inv.padronNote && (
                      <p
                        className={`text-[10px] mt-0.5 max-w-[220px] ${
                          inv.padronVerified ? "text-warning" : "text-ink-subtle"
                        }`}
                      >
                        {inv.padronVerified ? "⚠️ " : "○ "}
                        {inv.padronNote}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-muted whitespace-nowrap">
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
                      className={`neu-badge ${
                        inv.status === "authorized"
                          ? "bg-success-soft text-success"
                          : inv.status === "rejected"
                          ? "bg-danger-soft text-danger"
                          : "bg-surface-sunken text-ink-muted"
                      }`}
                    >
                      {STATUS_LABELS[inv.status] ?? inv.status}
                    </span>
                    {(inv.status === "rejected" || inv.status === "retry_pending") &&
                      inv.rejectionReason && (
                        <p
                          className={`text-[10px] mt-1 max-w-[160px] mx-auto ${
                            inv.status === "rejected" ? "text-danger" : "text-warning"
                          }`}
                        >
                          {inv.rejectionReason}
                        </p>
                      )}
                  </td>
                  <td className="px-4 py-3 text-center text-xs">
                    {inv.environment === "production" ? "Producción" : "Pruebas"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <InvoiceRowActions
                      invoiceId={inv.id}
                      canPrint={inv.status === "authorized" && Boolean(inv.cae)}
                    />
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
            fiscal: filters.fiscal,
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
      <details className="neu-card p-4">
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
