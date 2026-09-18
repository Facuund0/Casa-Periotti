"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { PaymentSettingsService } from "./payment-settings-service";
import { ReceiptAdminService } from "./receipt-admin-service";
import { paymentSettingsSchema, purgeReceiptSchema, viewReceiptSchema } from "./schemas";

// Los datos bancarios son a los que un cliente le va a transferir
// plata: solo admin y super_admin los pueden tocar, y cada cambio queda
// en audit_logs (ver PaymentSettingsService.update).
const ROLES_QUE_PUEDEN_CONFIGURAR_PAGO = ["admin", "super_admin"];

// Ver un comprobante es parte del trabajo de ventas; borrarlo destruye
// el respaldo de una venta, así que queda para admin y super_admin.
const ROLES_QUE_PUEDEN_VER_COMPROBANTES = ["admin", "super_admin", "ventas"];
const ROLES_QUE_PUEDEN_ELIMINAR_COMPROBANTES = ["admin", "super_admin"];

export interface UpdatePaymentSettingsResult {
  error?: string;
  ok?: boolean;
}

/**
 * Activa o desactiva el cobro con la terminal Point y elige el equipo.
 * No habla con Mercado Pago: eso lo hacen las acciones de point-actions.
 */
export async function savePointSettingsAction(input: {
  enabled: boolean;
  deviceId: string | null;
}): Promise<UpdatePaymentSettingsResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_CONFIGURAR_PAGO.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const deviceId = input.deviceId?.trim().slice(0, 120) || null;
  if (input.enabled && !deviceId) {
    return { error: "Elegí la terminal antes de activar el cobro con Point." };
  }

  try {
    await new PaymentSettingsService(createAdminClient()).updatePoint(
      { enabled: input.enabled, deviceId },
      employee.id
    );
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "No se pudo guardar la terminal Point",
    };
  }

  revalidatePath("/admin/configuracion-pago");
  revalidatePath("/admin/venta");
  return { ok: true };
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

export interface ViewReceiptResult {
  error?: string;
  url?: string;
}

/**
 * Devuelve una URL firmada para abrir un comprobante desde
 * /admin/comprobantes. Se genera de a una, cuando el empleado la pide:
 * el bucket es privado y no se firma nada que nadie vaya a mirar.
 */
export async function getReceiptSignedUrlAction(receiptId: string): Promise<ViewReceiptResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_VER_COMPROBANTES.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const parsed = viewReceiptSchema.safeParse({ receiptId });
  if (!parsed.success) return { error: "Comprobante inválido" };

  try {
    const url = await new ReceiptAdminService(createAdminClient()).getSignedUrl(
      parsed.data.receiptId
    );
    return { url };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "No se pudo abrir el comprobante",
    };
  }
}

export interface PurgeReceiptResult {
  error?: string;
  ok?: boolean;
}

/**
 * Borra el archivo de un comprobante del bucket y deja la fila marcada
 * como purgada (ver ReceiptAdminService.purge): queda el registro de que
 * el comprobante existió y de quién lo borró, en la fila y en
 * audit_logs.
 */
export async function purgeReceiptAction(receiptId: string): Promise<PurgeReceiptResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_ELIMINAR_COMPROBANTES.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const parsed = purgeReceiptSchema.safeParse({ receiptId });
  if (!parsed.success) return { error: "Comprobante inválido" };

  try {
    await new ReceiptAdminService(createAdminClient()).purge({
      receiptId: parsed.data.receiptId,
      employeeId: employee.id,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo eliminar el comprobante" };
  }

  revalidatePath("/admin/comprobantes");
  return { ok: true };
}
