import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { readThreshold } from "@/modules/billing/sale-fiscal-guard";
import { PosSaleForm } from "./pos-sale-form";

export const dynamic = "force-dynamic";
// La factura se emite después de responder (after()); este es el tiempo
// máximo que tiene para terminar, contando el reintento de ARCA.
export const maxDuration = 60;

export default async function AdminVentaPage() {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "ventas"].includes(employee.role)) {
    redirect("/admin");
  }

  const adminDb = createAdminClient();

  // La terminal Point solo se ofrece si está configurada: sin eso, la
  // pantalla queda exactamente como antes.
  const [threshold, { data: settings }] = await Promise.all([
    readThreshold(adminDb),
    adminDb.from("payment_settings").select("point_enabled, point_device_id").eq("id", 1).maybeSingle(),
  ]);
  const pointEnabled = Boolean(settings?.point_enabled && settings?.point_device_id);

  return (
    <div>
      <h1 className="text-lg font-bold mb-6">Venta de mostrador</h1>
      <PosSaleForm anonymousInvoiceThreshold={threshold} pointEnabled={pointEnabled} />
    </div>
  );
}
