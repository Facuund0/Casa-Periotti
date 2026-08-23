import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { logoutAction } from "@/modules/auth/actions";

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
  const canManageEmployees = employee.role === "super_admin";

  return (
    <div className="min-h-screen flex bg-neutral-50">
      <aside className="w-60 bg-white border-r border-neutral-200 p-4 flex flex-col">
        <div className="mb-6">
          <p className="font-bold text-sm">CASA PERIOTTI</p>
          <p className="text-xs text-neutral-500">Panel interno</p>
        </div>

        <nav className="flex-1 space-y-1 text-sm">
          {canSell && (
            <Link href="/admin/venta" className="block rounded-md px-3 py-2 hover:bg-neutral-100">
              Venta de mostrador
            </Link>
          )}
          {canManageOrders && (
            <Link href="/admin/pedidos" className="block rounded-md px-3 py-2 hover:bg-neutral-100">
              Pedidos
            </Link>
          )}
          {canManageProducts && (
            <Link href="/admin/productos" className="block rounded-md px-3 py-2 hover:bg-neutral-100">
              Productos y stock
            </Link>
          )}
          {canManageCustomers && (
            <Link href="/admin/clientes" className="block rounded-md px-3 py-2 hover:bg-neutral-100">
              Clientes
            </Link>
          )}
          {canManageBilling && (
            <Link href="/admin/facturacion" className="block rounded-md px-3 py-2 hover:bg-neutral-100">
              Facturación
            </Link>
          )}
          {canManageEmployees && (
            <Link href="/admin/empleados" className="block rounded-md px-3 py-2 hover:bg-neutral-100">
              Empleados
            </Link>
          )}
        </nav>

        <div className="border-t border-neutral-100 pt-4 mt-4">
          <p className="text-xs text-neutral-500 mb-2">
            {employee.fullName} · <span className="uppercase">{employee.role}</span>
          </p>
          <form action={logoutAction}>
            <button className="text-xs text-neutral-500 hover:underline">Cerrar sesión</button>
          </form>
        </div>
      </aside>

      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
