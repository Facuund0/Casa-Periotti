import { redirect } from "next/navigation";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { PaymentSettingsService } from "@/modules/payments/payment-settings-service";
import { getTransferWindowMinutes } from "@/modules/payments/transfer-config";
import { PaymentSettingsForm } from "./payment-settings-form";
import { PointSettings } from "./point-settings";

export const dynamic = "force-dynamic";

export default async function PaymentSettingsPage() {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin"].includes(employee.role)) {
    redirect("/admin");
  }

  const settings = await new PaymentSettingsService(createAdminClient()).get();
  const usable = PaymentSettingsService.isUsable(settings);

  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Configuración de pago</h1>
      <p className="text-sm text-ink-muted mb-6">
        Estos son los datos que ve el cliente en el checkout para transferir. Cada cambio queda
        registrado con el usuario que lo hizo.
      </p>

      {!usable && (
        <div className="mb-6 max-w-md rounded-neu bg-danger-soft p-3 text-sm font-medium text-danger">
          Todavía no hay alias ni CBU cargado, así que el checkout no está tomando pedidos. Cargá al
          menos uno de los dos.
        </div>
      )}

      <PaymentSettingsForm settings={settings} />

      <PointSettings
        enabled={settings?.pointEnabled ?? false}
        deviceId={settings?.pointDeviceId ?? null}
      />

      <div className="neu-inset mt-8 max-w-md p-4">
        <p className="text-sm font-medium mb-1">Plazo para pagar</p>
        <p className="text-xs text-ink-muted">
          Hoy es de <span className="font-medium">{getTransferWindowMinutes()} minutos</span> desde
          que el cliente confirma el pedido. Pasado ese plazo, si no subió comprobante, el stock
          reservado se libera solo. Si ya subió comprobante, el pedido nunca se cancela
          automáticamente: queda esperando revisión en Pedidos.
        </p>
        <p className="text-xs text-ink-subtle mt-2">
          Se cambia con la variable de entorno <code>PAYMENT_TRANSFER_WINDOW_MINUTES</code> (requiere
          redeploy), no desde acá.
        </p>
      </div>
    </div>
  );
}
