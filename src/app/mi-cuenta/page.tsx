import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentCustomer, getCurrentEmployee } from "@/modules/auth/current-user";
import { logoutAction } from "@/modules/auth/actions";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  created: "Creado",
  pending_payment: "Esperando pago",
  payment_processing: "Procesando pago",
  paid: "Pagado",
  payment_failed: "Pago rechazado",
  preparing: "En preparación",
  ready_for_pickup: "Listo para retirar",
  shipped: "Enviado",
  completed: "Completado",
  cancelled: "Cancelado",
};

const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  minorista: "Minorista",
  mayorista: "Mayorista",
  mayorista_pendiente: "Mayorista (pendiente de aprobación)",
};

export default async function MiCuentaPage() {
  const customer = await getCurrentCustomer();
  const employee = await getCurrentEmployee();

  if (!customer && !employee) redirect("/login");

  const supabase = await createClient();
  const { data: orders } = customer
    ? await supabase
        .from("orders")
        .select("id, order_number, status, total, created_at")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200">
        <div className="mx-auto max-w-4xl px-4 py-4 flex items-center justify-between">
          <Link href="/">
            <h1 className="text-xl font-bold tracking-tight">CASA PERIOTTI</h1>
          </Link>
          <form action={logoutAction}>
            <button className="text-sm text-neutral-500 hover:underline">Cerrar sesión</button>
          </form>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-8 space-y-8">
        {employee && (
          <div className="rounded-lg border border-neutral-900 bg-white p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Tenés acceso al panel interno</p>
              <p className="text-xs text-neutral-500">Rol: {employee.role}</p>
            </div>
            <Link
              href="/admin"
              className="bg-neutral-900 text-white text-sm rounded-md px-4 py-2 hover:bg-neutral-800"
            >
              Ir al panel
            </Link>
          </div>
        )}

        {customer && (
          <>
            <div className="bg-white rounded-lg border border-neutral-200 p-6">
              <h2 className="text-sm font-semibold text-neutral-500 uppercase mb-3">Mis datos</h2>
              <p className="text-sm">{customer.fullName}</p>
              <p className="text-sm text-neutral-500">{customer.email}</p>
              <p className="text-xs text-neutral-500 mt-2">
                Tipo de cliente: {CUSTOMER_TYPE_LABELS[customer.customerType]}
              </p>
              {customer.customerType === "mayorista_pendiente" && (
                <p className="text-xs text-amber-700 mt-2">
                  Tu solicitud de precios mayoristas está pendiente de aprobación por Casa Periotti.
                </p>
              )}
            </div>

            <div>
              <h2 className="text-sm font-semibold text-neutral-500 uppercase mb-3">
                Mis pedidos
              </h2>
              <div className="bg-white rounded-lg border border-neutral-200 divide-y divide-neutral-100">
                {(orders ?? []).map((o) => (
                  <Link
                    key={o.id}
                    href={`/pedido/${o.id}`}
                    className="flex items-center justify-between p-4 hover:bg-neutral-50"
                  >
                    <div>
                      <p className="text-sm font-medium">Pedido #{o.order_number}</p>
                      <p className="text-xs text-neutral-500">
                        {new Date(o.created_at).toLocaleDateString("es-AR")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        $ {Number(o.total).toLocaleString("es-AR")}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {STATUS_LABELS[o.status] ?? o.status}
                      </p>
                    </div>
                  </Link>
                ))}
                {(!orders || orders.length === 0) && (
                  <p className="p-6 text-center text-sm text-neutral-400">
                    Todavía no hiciste ningún pedido.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
