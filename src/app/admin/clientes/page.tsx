import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { approveWholesaleAction, rejectWholesaleAction } from "@/modules/products/admin-actions";
import { CustomerFiscalService } from "@/modules/customers/customer-fiscal-service";
import { formatCuit, isValidCuit } from "@/shared/utils/cuit";
import { firstParam } from "@/shared/utils/search-params";
import { CustomerFiscalEditor } from "./customer-fiscal-editor";
import { SmartSearch } from "@/app/_components/smart-search";
import { suggestCustomersAction } from "@/modules/search/suggest-actions";

export const dynamic = "force-dynamic";

const CUSTOMER_TYPE_LABELS: Record<string, string> = {
  minorista: "Minorista",
  mayorista: "Mayorista",
  mayorista_pendiente: "Mayorista pendiente",
};

export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "ventas"].includes(employee.role)) {
    redirect("/admin");
  }

  const raw = await searchParams;
  const q = firstParam(raw.q)?.slice(0, 80);

  const supabase = await createClient();

  const [{ data: pending }, { data: wholesale }, customers] = await Promise.all([
    supabase
      .from("customer_profiles")
      .select("id, full_name, email, phone, cuit_dni, created_at")
      .eq("customer_type", "mayorista_pendiente")
      .order("created_at"),
    supabase
      .from("customer_profiles")
      .select("id, full_name, email, cuit_dni")
      .eq("customer_type", "mayorista")
      .order("full_name"),
    new CustomerFiscalService(createAdminClient(), employee).search(q),
  ]);

  return (
    <div className="space-y-10">
      <section>
        <h1 className="mb-1 text-lg font-bold text-ink">Solicitudes de mayorista pendientes</h1>
        <p className="mb-4 text-sm text-ink-muted">
          Revisá el CUIT antes de aprobar — una vez aprobado, el cliente ve precios mayoristas en
          toda la web.
        </p>

        <div className="neu-card">
          {(pending ?? []).map((c) => (
            <div key={c.id} className="neu-row flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{c.full_name}</p>
                <p className="text-xs text-ink-muted">
                  {c.email} · {c.phone} · CUIT: {c.cuit_dni ? formatCuit(c.cuit_dni) : "no informado"}
                </p>
                {/* Un CUIT inválido no es de nadie: aprobarlo le da precios
                    mayoristas a una cuenta que no se puede facturar. */}
                <span
                  className={`neu-badge mt-1.5 ${
                    isValidCuit(c.cuit_dni) ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
                  }`}
                >
                  {isValidCuit(c.cuit_dni) ? "CUIT válido" : "CUIT inválido"}
                </span>
              </div>
              <div className="flex gap-2">
                <form action={approveWholesaleAction.bind(null, c.id)}>
                  <button className="neu-btn neu-btn-primary !px-3 !py-1.5 !text-xs">Aprobar</button>
                </form>
                <form action={rejectWholesaleAction.bind(null, c.id)}>
                  <button className="neu-btn !px-3 !py-1.5 !text-xs">Rechazar</button>
                </form>
              </div>
            </div>
          ))}
          {(!pending || pending.length === 0) && (
            <p className="p-6 text-center text-sm text-ink-subtle">No hay solicitudes pendientes.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
          Clientes mayoristas aprobados
        </h2>
        <div className="neu-card">
          {(wholesale ?? []).map((c) => (
            <div
              key={c.id}
              className="neu-row flex flex-wrap items-center justify-between gap-2 p-4 text-sm"
            >
              <span className="text-ink">
                {c.full_name} <span className="text-ink-muted">· {c.email}</span>
              </span>
              <span className="flex items-center gap-2 text-xs text-ink-muted">
                CUIT: {c.cuit_dni ? formatCuit(c.cuit_dni) : "—"}
                {!isValidCuit(c.cuit_dni) && (
                  <span className="neu-badge bg-danger-soft text-danger">CUIT inválido</span>
                )}
              </span>
            </div>
          ))}
          {(!wholesale || wholesale.length === 0) && (
            <p className="p-6 text-center text-sm text-ink-subtle">
              Todavía no hay clientes mayoristas aprobados.
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-bold text-ink">Datos fiscales de clientes</h2>
        <p className="mb-4 max-w-2xl text-sm text-ink-muted">
          El CUIT guardado se precarga cuando el cliente pide factura con datos fiscales. La letra de
          la factura no sale de acá: la decide el padrón de ARCA en cada compra, y la condición que
          ves es la última que informó. Si alguien cargó mal su CUIT, corregilo acá. Cada cambio
          queda registrado con tu usuario.
        </p>

        <form
          method="get"
          action="/admin/clientes"
          className="neu-card mb-4 flex flex-wrap items-end gap-3 p-4"
        >
          <label className="min-w-[220px] flex-1 text-xs text-ink-muted">
            <span className="mb-1 block">Buscar cliente</span>
            <SmartSearch
              id="clientes-q"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Nombre, email o CUIT/DNI"
              suggest={suggestCustomersAction}
              submitOnSelect
              className="neu-input !py-1.5"
            />
          </label>
          <button className="neu-btn neu-btn-primary !px-4 !py-2 !text-xs">Buscar</button>
          {q && (
            <Link href="/admin/clientes" className="px-1 py-2 text-xs text-ink-muted hover:underline">
              Limpiar
            </Link>
          )}
        </form>

        <div className="neu-card">
          {customers.map((c) => (
            <div key={c.id} className="neu-row flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{c.fullName}</p>
                <p className="text-xs text-ink-muted">{c.email}</p>
                <span className="neu-badge mt-1.5 bg-secondary-soft text-ink-muted">
                  {CUSTOMER_TYPE_LABELS[c.customerType] ?? c.customerType}
                </span>
              </div>
              <CustomerFiscalEditor
                customerId={c.id}
                initialCuit={c.cuitDni}
                initialCondition={c.ivaCondition}
              />
            </div>
          ))}
          {customers.length === 0 && (
            <p className="p-6 text-center text-sm text-ink-subtle">
              {q ? "No hay clientes que coincidan con la búsqueda." : "Todavía no hay clientes."}
            </p>
          )}
        </div>
        {!q && customers.length > 0 && (
          <p className="mt-2 text-xs text-ink-subtle">
            Se muestran los {customers.length} clientes más recientes. Usá el buscador para encontrar
            a otro.
          </p>
        )}
      </section>
    </div>
  );
}
