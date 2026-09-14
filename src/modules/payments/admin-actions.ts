"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { PaymentSettingsService } from "./payment-settings-service";
import { paymentSettingsSchema } from "./schemas";

// Los datos bancarios son a los que un cliente le va a transferir
// plata: solo admin y super_admin los pueden tocar, y cada cambio queda
// en audit_logs (ver PaymentSettingsService.update).
const ROLES_QUE_PUEDEN_CONFIGURAR_PAGO = ["admin", "super_admin"];

export interface UpdatePaymentSettingsResult {
  error?: string;
  ok?: boolean;
}

export async function updatePaymentSettingsAction(
  formData: FormData
): Promise<UpdatePaymentSettingsResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_CONFIGURAR_PAGO.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const parsed = paymentSettingsSchema.safeParse({
    alias: String(formData.get("alias") ?? ""),
    cbu: String(formData.get("cbu") ?? ""),
    accountHolder: String(formData.get("accountHolder") ?? ""),
    bankName: String(formData.get("bankName") ?? ""),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    await new PaymentSettingsService(createAdminClient()).update(
      {
        alias: parsed.data.alias?.trim() || null,
        cbu: parsed.data.cbu?.trim() || null,
        accountHolder: parsed.data.accountHolder?.trim() || null,
        bankName: parsed.data.bankName?.trim() || null,
      },
      employee.id
    );
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "No se pudo guardar la configuración de pago",
    };
  }

  revalidatePath("/admin/configuracion-pago");
  // El checkout muestra estos datos, así que se invalida también.
  revalidatePath("/checkout");
  return { ok: true };
}
