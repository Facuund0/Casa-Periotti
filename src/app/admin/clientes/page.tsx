import { redirect } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { approveWholesaleAction, rejectWholesaleAction } from "@/modules/products/admin-actions";

export const dynamic = "force-dynamic";

export default async function AdminCustomersPage() {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "ventas"].includes(employee.role)) {
    redirect("/admin");
  }

  const supabase = await createClient();

  const { data: pending } = await supabase
    .from("customer_profiles")
    .select("id, full_name, email, phone, cuit_dni, created_at")
    .eq("customer_type", "mayorista_pendiente")
    .order("created_at");

  const { data: wholesale } = await supabase
    .from("customer_profiles")
    .select("id, full_name, email, cuit_dni")
    .eq("customer_type", "mayorista")
    .order("full_name");

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-lg font-bold mb-1">Solicitudes de mayorista pendientes</h1>
        <p className="text-sm text-neutral-500 mb-4">
          Revisá el CUIT antes de aprobar — una vez aprobado, el cliente ve precios mayoristas
          en toda la web.
        </p>

        <div className="bg-white rounded-lg border border-neutral-200 divide-y divide-neutral-100">
          {(pending ?? []).map((c) => (
            <div key={c.id} className="p-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{c.full_name}</p>
                <p className="text-xs text-neutral-500">
                  {c.email} · {c.phone} · CUIT: {c.cuit_dni ?? "no informado"}
                </p>
              </div>
              <div className="flex gap-2">
                <form action={approveWholesaleAction.bind(null, c.id)}>
                  <button className="text-xs bg-neutral-900 text-white rounded-md px-3 py-1.5">
                    Aprobar
                  </button>
                </form>
                <form action={rejectWholesaleAction.bind(null, c.id)}>
                  <button className="text-xs border border-neutral-300 rounded-md px-3 py-1.5">
                    Rechazar
                  </button>
                </form>
              </div>
            </div>
          ))}
          {(!pending || pending.length === 0) && (
            <p className="p-6 text-center text-sm text-neutral-400">
              No hay solicitudes pendientes.
            </p>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-neutral-500 uppercase mb-3">
          Clientes mayoristas aprobados
        </h2>
        <div className="bg-white rounded-lg border border-neutral-200 divide-y divide-neutral-100">
          {(wholesale ?? []).map((c) => (
            <div key={c.id} className="p-4 text-sm">
              {c.full_name} · {c.email} · CUIT: {c.cuit_dni}
            </div>
          ))}
          {(!wholesale || wholesale.length === 0) && (
            <p className="p-6 text-center text-sm text-neutral-400">
              Todavía no hay clientes mayoristas aprobados.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
