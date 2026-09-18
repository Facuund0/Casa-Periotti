"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { CustomerAccountService } from "./customer-account-service";

/**
 * Cobranzas y permisos de la cuenta corriente, desde /admin/cuentas.
 *
 * Nada de acá toca ventas, stock ni facturación: solo movimientos de la
 * cuenta del cliente y el permiso de fiarle.
 */

const ROLES_QUE_PUEDEN_COBRAR = ["admin", "super_admin", "ventas"];
/** Habilitar fiado y poner límites es decisión de quien maneja la plata. */
const ROLES_QUE_PUEDEN_HABILITAR = ["admin", "super_admin"];

export interface AccountActionResult {
  error?: string;
  ok?: boolean;
  note?: string;
}

/** Acepta "1.234,56" y "1234.56". Devuelve null si no es un número usable. */
function parseAmount(raw: FormDataEntryValue | null): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const clean =
    text.includes(",") && text.includes(".")
      ? text.replace(/\./g, "").replace(",", ".")
      : text.replace(",", ".");
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

export async function registerAccountPaymentAction(
  formData: FormData
): Promise<AccountActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_COBRAR.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const customerId = String(formData.get("customerId") ?? "");
  const amount = parseAmount(formData.get("amount"));
  if (!customerId) return { error: "Falta el cliente" };
  if (amount === null || amount <= 0) return { error: "Poné un importe mayor a 0" };

  const rawMethod = String(formData.get("method") ?? "");
  const method = ["efectivo", "transferencia", "tarjeta", "otro"].includes(rawMethod)
    ? (rawMethod as "efectivo" | "transferencia" | "tarjeta" | "otro")
    : null;

  try {
    const { balance } = await new CustomerAccountService(createAdminClient()).registerPayment({
      customerId,
      amount,
      method,
      note: String(formData.get("note") ?? ""),
      employeeId: employee.id,
    });
    revalidatePath("/admin/cuentas");
    revalidatePath("/admin/reportes");
    return {
      ok: true,
      note:
        balance > 0
          ? `Pago registrado. Queda debiendo $ ${balance.toLocaleString("es-AR", { minimumFractionDigits: 2 })}.`
          : balance === 0
            ? "Pago registrado. La cuenta queda al día."
            : `Pago registrado. Queda a favor del cliente $ ${Math.abs(balance).toLocaleString("es-AR", { minimumFractionDigits: 2 })}.`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar el pago" };
  }
}

export async function registerAccountAdjustmentAction(
  formData: FormData
): Promise<AccountActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_HABILITAR.includes(employee.role)) {
    return { error: "Solo un administrador puede hacer ajustes" };
  }

  const customerId = String(formData.get("customerId") ?? "");
  const amount = parseAmount(formData.get("amount"));
  const note = String(formData.get("note") ?? "");
  if (!customerId) return { error: "Falta el cliente" };
  if (amount === null || amount === 0) return { error: "Poné un importe distinto de 0" };
  if (!note.trim()) return { error: "Escribí el motivo del ajuste" };

  try {
    await new CustomerAccountService(createAdminClient()).registerAdjustment({
      customerId,
      amount,
      note,
      employeeId: employee.id,
    });
    revalidatePath("/admin/cuentas");
    return { ok: true, note: "Ajuste registrado." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo registrar el ajuste" };
  }
}

export async function updateCustomerCreditAction(
  formData: FormData
): Promise<AccountActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_HABILITAR.includes(employee.role)) {
    return { error: "Solo un administrador puede habilitar la cuenta corriente" };
  }

  const customerId = String(formData.get("customerId") ?? "");
  if (!customerId) return { error: "Falta el cliente" };

  const enabled = formData.get("enabled") === "on";
  const rawLimit = String(formData.get("limit") ?? "").trim();
  const limit = rawLimit ? parseAmount(rawLimit) : null;
  if (rawLimit && (limit === null || limit < 0)) {
    return { error: "El límite tiene que ser un número mayor o igual a 0" };
  }

  try {
    await new CustomerAccountService(createAdminClient()).setCreditSettings({
      customerId,
      enabled,
      limit,
      employeeId: employee.id,
    });
    revalidatePath("/admin/cuentas");
    return {
      ok: true,
      note: enabled ? "Cuenta corriente habilitada." : "Cuenta corriente deshabilitada.",
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo guardar" };
  }
}
