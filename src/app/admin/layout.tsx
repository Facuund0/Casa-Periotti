import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentEmployee, isLoggedIn } from "@/modules/auth/current-user";
import { logoutAction } from "@/modules/auth/actions";
import { Logo } from "../_components/logo";
import { AdminNavLink } from "./_components/admin-nav-link";
import { DismissibleAlert } from "./_components/dismissible-alert";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const employee = await getCurrentEmployee();

  // El proxy solo verifica que haya sesión. Acá se decide si es un
  // empleado activo; un cliente logueado vuelve al inicio. No alcanza con
  // el layout (no se re-renderiza al navegar dentro del panel): cada
  // página y cada Server Action vuelven a verificar por su cuenta.
  if (!employee) redirect((await isLoggedIn()) ? "/" : "/login");

  const canManageProducts = ["admin", "super_admin", "stock"].includes(employee.role);
  const canManageCustomers = ["admin", "super_admin", "ventas"].includes(employee.role);
  const canSell = ["admin", "super_admin", "ventas"].includes(employee.role);
  const canManageOrders = ["admin", "super_admin", "ventas"].includes(employee.role);
  const canManageBilling = ["admin", "super_admin", "facturacion"].includes(employee.role);
  const canConfigurePayment = ["admin", "super_admin"].includes(employee.role);
  const canManageEmployees = employee.role === "super_admin";
  // Los reportes muestran totales cobrados y medios de pago: solo quien
  // maneja la plata del negocio.
  const canSeeReports = ["admin", "super_admin"].includes(employee.role);
  // Quién prepara los pedidos web ya cobrados: ventas y depósito.
  const canPrepareOrders = ["admin", "super_admin", "ventas", "stock"].includes(employee.role);

  // Pedidos esperando que alguien verifique la transferencia. Es plata
  // que ya entró con el stock reservado, así que si hay alguno tiene
  // que verse sin tener que entrar a buscarlo.
  //
  // Facturas rechazadas por ARCA en los últimos 30 días, del ambiente
  // actual: como la factura se emite después de confirmar, un rechazo no
  // se ve en ese momento y tiene que saltar a la vista acá.
  const supabase = await createClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [pendingResult, rejectedResult, wholesaleResult, toPrepareResult] = await Promise.all([
    canManageOrders
      ? supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .eq("status", "payment_processing")
      : Promise.resolve({ count: 0 }),
    canManageBilling || canManageOrders
      ? supabase
          .from("invoices")
          // El conteo total y, en data, solo el rechazo más nuevo.
          .select("created_at", { count: "exact" })
          .eq("status", "rejected")
          .eq("environment", process.env.ARCA_ENVIRONMENT === "production" ? "production" : "testing")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(1)
      : Promise.resolve({ count: 0, data: [] as { created_at: string }[] }),
    // Clientes que se registraron pidiendo precio mayorista y esperan que
    // alguien revise su CUIT y los apruebe.
    canManageCustomers
      ? supabase
          .from("customer_profiles")
          .select("id", { count: "exact", head: true })
          .eq("customer_type", "mayorista_pendiente")
      : Promise.resolve({ count: 0 }),
    // Pedidos web cobrados que nadie empezó a armar. El join con payments
    // deja afuera las ventas de mostrador, que se entregan en el momento
    // y no hay que preparar.
    canPrepareOrders
      ? supabase
          .from("orders")
          .select("id, payments!inner(provider)")
          .eq("status", "paid")
          .neq("payments.provider", "pos")
          .limit(200)
      : Promise.resolve({ data: [] as { id: string }[] }),
  ]);
  const pendingWholesale = wholesaleResult.count ?? 0;
  // Versión del aviso de rechazadas: la fecha del rechazo más nuevo. Si
  // aparece uno posterior al que se cerró con la X, el aviso vuelve.
  const latestRejectedAt = rejectedResult.data?.[0]?.created_at ?? "";
  const pendingOrders = pendingResult.count ?? 0;
  const rejectedInvoices = rejectedResult.count ?? 0;
  // Un pedido puede tener más de una fila en payments (un rechazo y
  // después el pago bueno), así que se cuentan pedidos distintos.
  const ordersToPrepare = new Set((toPrepareResult.data ?? []).map((o) => o.id)).size;

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

        {pendingWholesale > 0 && canManageCustomers && (
          <Link
            href="/admin/clientes"
            className="neu-card neu-interactive mx-4 mt-4 block p-3 lg:mx-0"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-info">
              <span className="neu-badge bg-info-soft text-info">{pendingWholesale}</span>
              {pendingWholesale === 1 ? "mayorista para aprobar" : "mayoristas para aprobar"}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              Se registraron pidiendo precio mayorista. Revisá el CUIT y aprobalos en Clientes.
            </p>
          </Link>
        )}

        {rejectedInvoices > 0 && (canManageBilling || canManageOrders) && (
          <DismissibleAlert storageKey="casaperiotti:aviso-facturas-rechazadas" version={latestRejectedAt}>
          <Link
            href={canManageBilling ? "/admin/facturacion?status=rejected" : "/admin/pedidos"}
            className="neu-card neu-interactive mx-4 mt-4 block p-3 pr-9 lg:mx-0"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-danger">
              <span className="neu-badge bg-danger-soft text-danger">{rejectedInvoices}</span>
              {rejectedInvoices === 1 ? "factura rechazada" : "facturas rechazadas"}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {canManageBilling
                ? "La venta está cobrada pero ARCA rechazó el comprobante. Revisalas en Facturación."
                : "Hay ventas cobradas con la factura rechazada por ARCA. Avisale a facturación."}
            </p>
          </Link>
          </DismissibleAlert>
        )}

        <nav className="flex gap-2 overflow-x-auto px-4 py-4 lg:mt-4 lg:flex-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
          {canSell && <AdminNavLink href="/admin/venta">Venta de mostrador</AdminNavLink>}
          {canManageOrders && (
            <AdminNavLink href="/admin/pedidos" badge={pendingOrders || undefined}>
              Pedidos
            </AdminNavLink>
          )}
          {canPrepareOrders && (
            <AdminNavLink href="/admin/preparar" badge={ordersToPrepare || undefined}>
              Pedidos a preparar
            </AdminNavLink>
          )}
          {canManageOrders && <AdminNavLink href="/admin/comprobantes">Comprobantes</AdminNavLink>}
          {canManageProducts && (
            <AdminNavLink href="/admin/productos">Productos y stock</AdminNavLink>
          )}
          {canManageProducts && <AdminNavLink href="/admin/categorias">Categorías</AdminNavLink>}
          {canSeeReports && <AdminNavLink href="/admin/reportes">Reportes</AdminNavLink>}
          {canManageCustomers && (
            <AdminNavLink href="/admin/cuentas">Cuentas corrientes</AdminNavLink>
          )}
          {canManageCustomers && (
            <AdminNavLink href="/admin/clientes" badge={pendingWholesale || undefined}>
              Clientes
            </AdminNavLink>
          )}
          {canManageBilling && <AdminNavLink href="/admin/facturacion">Facturación</AdminNavLink>}
          {canConfigurePayment && (
            <AdminNavLink href="/admin/configuracion-pago">Configuración de pago</AdminNavLink>
          )}
          {canManageEmployees && (
            <AdminNavLink href="/admin/configuracion-fiscal">Datos fiscales</AdminNavLink>
          )}
          {canManageEmployees && <AdminNavLink href="/admin/empleados">Empleados</AdminNavLink>}
          <AdminNavLink href="/admin/notificaciones">Notificaciones</AdminNavLink>
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
