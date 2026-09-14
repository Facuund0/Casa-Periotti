import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { logoutAction } from "@/modules/auth/actions";
import { Logo } from "../_components/logo";
import { AdminNavLink } from "./_components/admin-nav-link";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const employee = await getCurrentEmployee();

  // Segunda barrera además del proxy: cada Server Component que
  // necesite datos sensibles vuelve a verificar por su cuenta.
  if (!employee) redirect("/login");

  const canManageProducts = ["admin", "super_admin", "stock"].includes(employee.role);
  const canManageCustomers = ["admin", "super_admin", "ventas"].includes(employee.role);
  const canSell = ["admin", "super_admin", "ventas"].includes(employee.role);
  const canManageOrders = ["admin", "super_admin", "ventas"].includes(employee.role);
  const canManageBilling = ["admin", "super_admin", "facturacion"].includes(employee.role);
  const canConfigurePayment = ["admin", "super_admin"].includes(employee.role);
  const canManageEmployees = employee.role === "super_admin";

  // Pedidos esperando que alguien verifique la transferencia. Es plata
  // que ya entró con el stock reservado, así que si hay alguno tiene
  // que verse sin tener que entrar a buscarlo.
  let pendingOrders = 0;
  if (canManageOrders) {
    const supabase = await createClient();
    const { count } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "payment_processing");
    pendingOrders = count ?? 0;
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* En celular el sidebar pasa a ser una barra arriba que scrollea
          en horizontal: un panel de 240px fijo dejaría la tabla sin
          lugar. */}
      <aside className="lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:p-4">
        <div className="flex items-center justify-between gap-3 px-4 pt-4 lg:px-2 lg:pt-2">
          <Link href="/admin" className="rounded-neu-sm">
            <Logo size="md" />
            <span className="mt-0.5 block text-[0.6875rem] font-medium text-ink-subtle">
              Panel interno
            </span>
          </Link>
          <Link href="/" className="neu-chip lg:hidden">
            Ver sitio
          </Link>
        </div>

        {pendingOrders > 0 && canManageOrders && (
          <Link
            href="/admin/pedidos"
            className="neu-card neu-interactive mx-4 mt-4 block p-3 lg:mx-0"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-warning">
              <span className="neu-badge bg-warning-soft text-warning">{pendingOrders}</span>
              {pendingOrders === 1 ? "pago a verificar" : "pagos a verificar"}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              El cliente subió el comprobante y el stock sigue reservado.
            </p>
          </Link>
        )}

        <nav className="flex gap-2 overflow-x-auto px-4 py-4 lg:mt-4 lg:flex-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
          {canSell && <AdminNavLink href="/admin/venta">Venta de mostrador</AdminNavLink>}
          {canManageOrders && (
            <AdminNavLink href="/admin/pedidos" badge={pendingOrders || undefined}>
              Pedidos
            </AdminNavLink>
          )}
          {canManageOrders && <AdminNavLink href="/admin/comprobantes">Comprobantes</AdminNavLink>}
          {canManageProducts && (
            <AdminNavLink href="/admin/productos">Productos y stock</AdminNavLink>
          )}
          {canManageProducts && <AdminNavLink href="/admin/categorias">Categorías</AdminNavLink>}
          {canManageCustomers && <AdminNavLink href="/admin/clientes">Clientes</AdminNavLink>}
          {canManageBilling && <AdminNavLink href="/admin/facturacion">Facturación</AdminNavLink>}
          {canConfigurePayment && (
            <AdminNavLink href="/admin/configuracion-pago">Configuración de pago</AdminNavLink>
          )}
          {canManageEmployees && (
            <AdminNavLink href="/admin/configuracion-fiscal">Datos fiscales</AdminNavLink>
          )}
          {canManageEmployees && <AdminNavLink href="/admin/empleados">Empleados</AdminNavLink>}
        </nav>

        <div className="hidden lg:block">
          <div className="neu-flat p-3">
            <p className="truncate text-xs font-medium text-ink">{employee.fullName}</p>
            <p className="text-[0.6875rem] uppercase tracking-wide text-ink-subtle">
              {employee.role}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <Link href="/" className="text-xs text-brand hover:underline">
                Ver sitio
              </Link>
              <form action={logoutAction}>
                <button className="text-xs text-ink-muted hover:underline">Cerrar sesión</button>
              </form>
            </div>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:py-8 lg:pr-8">
        {children}

        <div className="mt-8 flex items-center justify-between gap-3 lg:hidden">
          <p className="text-xs text-ink-subtle">
            {employee.fullName} · <span className="uppercase">{employee.role}</span>
          </p>
          <form action={logoutAction}>
            <button className="neu-chip">Cerrar sesión</button>
          </form>
        </div>
      </main>
    </div>
  );
}
