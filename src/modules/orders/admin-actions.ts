"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { TransferPaymentService } from "@/modules/payments/transfer-payment-service";
import { confirmTransferSchema, rejectTransferSchema } from "@/modules/payments/schemas";
import { getTransferWindowMinutes } from "@/modules/payments/transfer-config";
import { OrderService } from "./order-service";

const ROLES_QUE_PUEDEN_VERIFICAR_PAGOS = ["admin", "super_admin", "ventas"];
const ROLES_QUE_PUEDEN_LIBERAR_RESERVAS = ["admin", "super_admin", "stock", "ventas"];

export interface VerifyTransferActionResult {
  error?: string;
  ok?: boolean;
  note?: string;
}

/**
 * Botón "Confirmar pago" de /admin/pedidos: el empleado ya verificó la
 * transferencia en el homebanking. Dispara el MISMO flujo que disparaba
 * un pago aprobado de Mercado Pago (confirmPaid + facturación ARCA +
 * emails) — ver TransferPaymentService.confirmTransfer(), esa lógica no
 * se duplica acá.
 */
export async function confirmTransferPaymentAction(
  orderId: string
): Promise<VerifyTransferActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_VERIFICAR_PAGOS.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const parsed = confirmTransferSchema.safeParse({ orderId });
  if (!parsed.success) return { error: "Pedido inválido" };

  const adminDb = createAdminClient();

  try {
    const result = await new TransferPaymentService(adminDb).confirmTransfer({
      orderId: parsed.data.orderId,
      employeeId: employee.id,
    });

    revalidatePath("/admin/pedidos");
    return {
      ok: true,
      note: result.alreadyPaid
        ? "Este pedido ya estaba confirmado — no se volvió a facturar."
        : undefined,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo confirmar el pago" };
  }
}

/**
 * Botón "Rechazar" de /admin/pedidos: no apareció la transferencia, o
 * el comprobante no corresponde. Libera la reserva de stock con el
 * mismo RPC que usaba un pago rechazado de Mercado Pago.
 */
export async function rejectTransferPaymentAction(
  orderId: string,
  reason: string
): Promise<VerifyTransferActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_VERIFICAR_PAGOS.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const parsed = rejectTransferSchema.safeParse({ orderId, reason });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const adminDb = createAdminClient();

  try {
    await new TransferPaymentService(adminDb).rejectTransfer({
      orderId: parsed.data.orderId,
      employeeId: employee.id,
      reason: parsed.data.reason,
    });

    revalidatePath("/admin/pedidos");
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo rechazar el pago" };
  }
}

export interface ReleaseStaleReservationsActionResult {
  error?: string;
  ok?: boolean;
  checked?: number;
  released?: number;
  skippedWithReceipt?: number;
}

/**
 * Botón "Liberar reservas vencidas" de /admin/productos. Reutiliza
 * OrderService.releaseStaleReservations() — la misma función que usa
 * el cron /api/cron/release-stale-reservations, con la misma ventana
 * (getTransferWindowMinutes()), para que el botón manual no aplique una
 * política distinta a la del servidor.
 */
export async function releaseStaleReservationsAction(): Promise<ReleaseStaleReservationsActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_LIBERAR_RESERVAS.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const adminDb = createAdminClient();
  const orderService = new OrderService(adminDb);

  try {
    const result = await orderService.releaseStaleReservations(getTransferWindowMinutes());
    revalidatePath("/admin/productos");
    return {
      ok: true,
      checked: result.checked,
      released: result.released,
      skippedWithReceipt: result.skippedWithReceipt,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudieron liberar las reservas" };
  }
}
