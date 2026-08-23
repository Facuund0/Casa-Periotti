import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/modules/auth/current-user";

export default async function AdminIndexPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  // Cada rama de acá coincide exactamente con el chequeo de permiso que
  // hace la página de destino, para no generar un ida-y-vuelta infinito
  // entre /admin y esa página si el rol no encaja.
  if (["admin", "super_admin", "stock"].includes(employee.role)) redirect("/admin/productos");
  if (employee.role === "ventas") redirect("/admin/clientes");
  if (employee.role === "facturacion") redirect("/admin/facturacion");

  // No debería llegar acá con los roles actuales (admin, super_admin,
  // ventas, stock, facturacion ya están todos cubiertos arriba), pero
  // por las dudas: nunca redirigir de vuelta a una sección protegida,
  // para no correr riesgo de un loop.
  redirect("/");
}

