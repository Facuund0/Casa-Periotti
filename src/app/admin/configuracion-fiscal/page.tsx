import { redirect } from "next/navigation";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { BusinessSettingsService } from "@/modules/billing/business-settings-service";
import { BusinessSettingsForm } from "./business-settings-form";

export const dynamic = "force-dynamic";

export default async function AdminFiscalSettingsPage() {
  const employee = await getCurrentEmployee();
  // Solo super_admin: estos datos determinan qué dice y cómo se numera
  // cada comprobante que emite el negocio.
  if (!employee || employee.role !== "super_admin") {
    redirect("/admin");
  }

  const service = new BusinessSettingsService(createAdminClient());
  const settings = await service.get().catch(() => null);

  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Datos fiscales</h1>
      <p className="text-sm text-neutral-500 mb-6 max-w-2xl">
        Los datos del emisor que ARCA exige en todo comprobante impreso. Se usan para facturar y se
        imprimen en el PDF de cada factura. Los campos marcados con{" "}
        <span className="text-red-500">*</span> son obligatorios para poder emitir; cada cambio
        queda registrado con tu usuario.
      </p>

      <BusinessSettingsForm
        settings={settings}
        missing={BusinessSettingsService.missingFields(settings)}
      />
    </div>
  );
}
