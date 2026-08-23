import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { PosSaleForm } from "./pos-sale-form";

export const dynamic = "force-dynamic";

export default async function AdminVentaPage() {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "ventas"].includes(employee.role)) {
    redirect("/admin");
  }

  return (
    <div>
      <h1 className="text-lg font-bold mb-6">Venta de mostrador</h1>
      <PosSaleForm />
    </div>
  );
}
