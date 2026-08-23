import { redirect } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentEmployee } from "@/modules/auth/current-user";
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

export default async function AdminBillingPage() {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "facturacion"].includes(employee.role)) {
    redirect("/admin");
  }

  const supabase = await createClient();

  const { data: invoices } = await supabase
    .from("invoices")
    .select(
      "id, invoice_type, sales_point, voucher_number, cae, status, total, customer_name, buyer_iva_condition, environment, created_at, rejection_reason, padron_verified, padron_note"
    )
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div>
      <h1 className="text-lg font-bold mb-6">Facturación</h1>

      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-3">Cliente</th>
              <th className="text-left px-4 py-3">Condición IVA</th>
              <th className="text-left px-4 py-3">Comprobante</th>
              <th className="text-right px-4 py-3">Total</th>
              <th className="text-center px-4 py-3">Estado</th>
              <th className="text-center px-4 py-3">Ambiente</th>
            </tr>
          </thead>
          <tbody>
            {(invoices ?? []).map((inv) => (
              <tr key={inv.id} className="border-t border-neutral-100">
                <td className="px-4 py-3">{inv.customer_name}</td>
                <td className="px-4 py-3 text-neutral-500">
                  {inv.buyer_iva_condition ?? "—"}
                  {inv.padron_note && (
                    <p
                      className={`text-[10px] mt-0.5 max-w-[220px] ${
                        inv.padron_verified ? "text-amber-600" : "text-neutral-400"
                      }`}
                    >
                      {inv.padron_verified ? "⚠️ " : "○ "}
                      {inv.padron_note}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-neutral-500">
                  {inv.voucher_number
                    ? `${inv.invoice_type} ${String(inv.sales_point).padStart(4, "0")}-${String(
                        inv.voucher_number
                      ).padStart(8, "0")}`
                    : "—"}
                </td>
                <td className="px-4 py-3 text-right">$ {Number(inv.total).toLocaleString("es-AR")}</td>
                <td className="px-4 py-3 text-center">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      inv.status === "authorized"
                        ? "bg-green-100 text-green-700"
                        : inv.status === "rejected"
                        ? "bg-red-100 text-red-700"
                        : "bg-neutral-100 text-neutral-500"
                    }`}
                  >
                    {STATUS_LABELS[inv.status] ?? inv.status}
                  </span>
                  {inv.status === "rejected" && inv.rejection_reason && (
                    <p className="text-[10px] text-red-500 mt-1 max-w-[160px]">
                      {inv.rejection_reason}
                    </p>
                  )}
                </td>
                <td className="px-4 py-3 text-center text-xs">
                  {inv.environment === "production" ? "Producción" : "Pruebas"}
                </td>
              </tr>
            ))}
            {(!invoices || invoices.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-neutral-400">
                  Todavía no se generó ninguna factura.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
