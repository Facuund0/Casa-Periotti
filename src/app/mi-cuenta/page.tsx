import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentCustomer, getCurrentEmployee } from "@/modules/auth/current-user";
import { SiteHeader } from "../_components/site-header";

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

/** Cada estado con su color, para que se distinga de un vistazo. */
const STATUS_TONE: Record<string, string> = {
  paid: "bg-success-soft text-success",
  completed: "bg-success-soft text-success",
  ready_for_pickup: "bg-success-soft text-success",
  pending_payment: "bg-warning-soft text-warning",
  payment_processing: "bg-info-soft text-info",
  preparing: "bg-info-soft text-info",
  shipped: "bg-info-soft text-info",
  payment_failed: "bg-danger-soft text-danger",
  cancelled: "bg-danger-soft text-danger",
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
    <main className="min-h-screen">
      <SiteHeader isLoggedIn showLogout />

      <div className="mx-auto max-w-4xl px-4 pb-16 pt-4 space-y-6">
        {employee && (
          <div className="neu-card flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
            <div>
              <p className="text-sm font-semibold text-ink">Tenés acceso al panel interno</p>
              <p className="text-xs text-ink-subtle">Rol: {employee.role}</p>
            </div>
            <Link href="/admin" className="neu-btn neu-btn-primary">
              Ir al panel
            </Link>
          </div>
        )}

        {customer && (
          <>
            <section className="neu-card p-5 sm:p-6">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                Mis datos
              </h2>
              <p className="text-base font-semibold text-ink">{customer.fullName}</p>
              <p className="text-sm text-ink-muted">{customer.email}</p>
              <p className="mt-3 flex items-center gap-2 text-xs text-ink-subtle">
                Tipo de cliente
                <span
                  className={`neu-badge ${
                    customer.customerType === "mayorista"
                      ? "bg-success-soft text-success"
                      : customer.customerType === "mayorista_pendiente"
                      ? "bg-warning-soft text-warning"
                      : "bg-secondary-soft text-ink-muted"
                  }`}
                >
                  {CUSTOMER_TYPE_LABELS[customer.customerType]}
                </span>
              </p>
              {customer.customerType === "mayorista_pendiente" && (
                <p className="mt-3 text-xs text-warning">
                  Tu solicitud de precios mayoristas está pendiente de aprobación por Casa
                  Periotti.
                </p>
              )}
            </section>

            <section>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                Mis pedidos
              </h2>

              {!orders || orders.length === 0 ? (
                <div className="neu-flat p-8 text-center">
                  <p className="text-sm text-ink-muted">Todavía no hiciste ningún pedido.</p>
                  <Link href="/" className="neu-btn neu-btn-primary mt-4">
                    Ver el catálogo
                  </Link>
                </div>
              ) : (
                <ul className="space-y-3">
                  {orders.map((o) => (
                    <li key={o.id}>
                      <Link
                        href={`/pedido/${o.id}`}
                        className="neu-card neu-interactive flex items-center justify-between gap-3 p-4"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink">
                            Pedido #{o.order_number}
                          </p>
                          <p className="text-xs text-ink-subtle">
                            {new Date(o.created_at).toLocaleDateString("es-AR")}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span
                            className={`neu-badge ${
                              STATUS_TONE[o.status] ?? "bg-secondary-soft text-ink-muted"
                            }`}
                          >
                            {STATUS_LABELS[o.status] ?? o.status}
                          </span>
                          <p className="text-sm font-bold tabular-nums text-ink">
                            $ {Number(o.total).toLocaleString("es-AR")}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
