import { redirect } from "next/navigation";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { ReceiptAdminService } from "@/modules/payments/receipt-admin-service";
import { receiptFiltersSchema } from "@/modules/payments/schemas";
import { buildTransferReference } from "@/modules/payments/transfer-config";
import { firstParam } from "@/shared/utils/search-params";
import { FilterForm } from "../_components/filter-form";
import { Pagination } from "../_components/pagination";
import { ReceiptRowActions } from "./receipt-row-actions";

export const dynamic = "force-dynamic";

const REVIEW_LABELS: Record<string, string> = {
  pending: "Pendiente",
  approved: "Aprobado",
  rejected: "Rechazado",
};

const REVIEW_CLASSES: Record<string, string> = {
  pending: "bg-warning-soft text-warning",
  approved: "bg-success-soft text-success",
  rejected: "bg-danger-soft text-danger",
};

export default async function AdminReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "ventas"].includes(employee.role)) {
    redirect("/admin");
  }

  // Borrar un comprobante destruye el respaldo de una venta: ventas lo
  // ve, pero solo admin y super_admin lo pueden eliminar. La Server
  // Action vuelve a chequear esto por su cuenta — esto solo decide si se
  // muestra el botón.
  const canDelete = ["admin", "super_admin"].includes(employee.role);

  const raw = await searchParams;
  const filters = receiptFiltersSchema.parse({
    from: firstParam(raw.from),
    to: firstParam(raw.to),
    status: firstParam(raw.status),
    q: firstParam(raw.q),
    page: firstParam(raw.page),
  });

  // Cliente admin: el bucket es privado y los comprobantes se cruzan con
  // pedidos y clientes sin pasar por RLS.
  const { rows, total, page, pageCount, pageSize } = await new ReceiptAdminService(
    createAdminClient()
  ).list(filters);

  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Comprobantes de transferencia</h1>
      <p className="text-sm text-ink-muted mb-4">
        Todos los comprobantes que subieron los clientes, del más reciente al más antiguo. Los que
        están <span className="font-medium">pendientes</span> se confirman o rechazan desde{" "}
        <span className="font-medium">Pedidos</span>.
      </p>

      <FilterForm
        basePath="/admin/comprobantes"
        from={filters.from}
        to={filters.to}
        status={filters.status}
        q={filters.q}
        statusLabel="Revisión"
        statusOptions={[
          { value: "pending", label: "Pendiente" },
          { value: "approved", label: "Aprobado" },
          { value: "rejected", label: "Rechazado" },
        ]}
        searchPlaceholder="Número de pedido o nombre del cliente"
      />

      <div className="neu-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="neu-table-head text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Subido</th>
                <th className="text-left px-4 py-3">Pedido</th>
                <th className="text-left px-4 py-3">Cliente</th>
                <th className="text-right px-4 py-3">Monto</th>
                <th className="text-center px-4 py-3">Revisión</th>
                <th className="text-right px-4 py-3">Comprobante</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="neu-row align-top">
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">
                    {new Date(r.uploadedAt).toLocaleString("es-AR")}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {r.orderNumber ? (
                      <>
                        <span className="font-medium">#{r.orderNumber}</span>
                        <span className="block text-[10px] font-mono text-ink-subtle">
                          {buildTransferReference(r.orderNumber)}
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{r.customerName ?? "Cliente sin perfil"}</td>
                  <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                    {r.amount === null ? "—" : `$ ${r.amount.toLocaleString("es-AR")}`}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`neu-badge ${
                        REVIEW_CLASSES[r.reviewStatus] ?? "bg-surface-sunken text-ink-muted"
                      }`}
                    >
                      {REVIEW_LABELS[r.reviewStatus] ?? r.reviewStatus}
                    </span>
                    {r.reviewStatus === "rejected" && r.rejectionReason && (
                      <p className="text-[10px] text-danger mt-1 max-w-[160px] mx-auto">
                        {r.rejectionReason}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ReceiptRowActions
                      receiptId={r.id}
                      orderNumber={r.orderNumber}
                      canDelete={canDelete}
                      purged={Boolean(r.purgedAt)}
                      reviewPending={r.reviewStatus === "pending"}
                    />
                    {r.purgedAt && (
                      <p className="text-[10px] text-ink-subtle text-right mt-1">
                        {new Date(r.purgedAt).toLocaleString("es-AR")}
                        {r.purgedByName ? ` · ${r.purgedByName}` : ""}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination
          basePath="/admin/comprobantes"
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
          emptyLabel="No hay comprobantes que coincidan con el filtro."
        />
      </div>
    </div>
  );
}
