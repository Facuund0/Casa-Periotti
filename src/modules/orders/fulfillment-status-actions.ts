"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { canTransition, type OrderStatus } from "./types";

/**
 * Avanzar la preparación de un pedido ya pagado: "En preparación",
 * "Listo para retirar" / "Enviado" y "Entregado".
 *
 * Esto NO toca stock ni facturación. El stock se descontó al confirmar
 * el pago (confirmPaid) y la factura se emitió ahí mismo; acá solo se
 * mueve en qué punto de la entrega está el pedido.
 *
 * Cancelar no está en esta acción a propósito: cancelar sí devuelve
 * stock y tiene su propio camino (rechazo del pago en /admin/pedidos).
 */

const ROLES_QUE_PUEDEN_PREPARAR = ["admin", "super_admin", "ventas", "stock"];

/** Los únicos destinos permitidos desde acá, además de los de la máquina de estados. */
const DESTINOS_PERMITIDOS: OrderStatus[] = [
  "preparing",
  "ready_for_pickup",
  "shipped",
  "completed",
];

export interface AdvanceStatusResult {
  error?: string;
  ok?: boolean;
}

export async function advanceOrderStatusAction(
  orderId: string,
  to: OrderStatus
): Promise<AdvanceStatusResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_PREPARAR.includes(employee.role)) {
    return { error: "No autorizado" };
  }
  if (!DESTINOS_PERMITIDOS.includes(to)) {
    return { error: "Ese cambio de estado no se hace desde esta pantalla" };
  }

  const adminDb = createAdminClient();

  const { data: order, error: readError } = await adminDb
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .single();
  if (readError || !order) return { error: "No se encontró el pedido" };

  const from = order.status as OrderStatus;
  if (from === to) return { ok: true };
  if (!canTransition(from, to)) {
    return { error: `Un pedido en "${from}" no puede pasar a "${to}"` };
  }

  // El .eq("status", from) es a propósito: si otro empleado ya movió el
  // pedido desde que se cargó la pantalla, este update no encuentra
  // nada y no pisa el cambio del otro.
  const { data: updated, error: updateError } = await adminDb
    .from("orders")
    .update({ status: to })
    .eq("id", orderId)
    .eq("status", from)
    .select("id");
  if (updateError) return { error: `No se pudo actualizar: ${updateError.message}` };
  if (!updated?.length) {
    return { error: "Otro empleado ya cambió este pedido. Recargá la pantalla." };
  }

  // Queda quién lo movió y cuándo, igual que los cambios de estado que
  // hacen los RPC de pago.
  await adminDb.from("order_status_history").insert({
    order_id: orderId,
    from_status: from,
    to_status: to,
    changed_by: employee.id,
  });

  revalidatePath("/admin/preparar");
  return { ok: true };
}
