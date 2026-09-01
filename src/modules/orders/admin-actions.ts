"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { PaymentService } from "@/modules/payments/payment-service";
import { OrderFulfillmentService } from "./order-fulfillment-service";
import { OrderService } from "./order-service";

const ROLES_QUE_PUEDEN_RECONCILIAR = ["admin", "super_admin", "ventas"];
const ROLES_QUE_PUEDEN_LIBERAR_RESERVAS = ["admin", "super_admin", "stock", "ventas"];

// Mismo umbral que usa /api/cron/release-stale-reservations (ver el
// comentario ahí sobre la ventana de 40 min del challenge 3DS) — el
// botón manual del panel es una forma alternativa de disparar la misma
// limpieza, no una política distinta.
const STALE_THRESHOLD_MINUTES = 60;

export interface ReconcilePaymentActionResult {
  error?: string;
  ok?: boolean;
  status?: string;
}

/**
 * Botón "Consultar estado del pago" de /admin/pedidos. Reutiliza
 * PaymentService.reconcilePayment() — la misma consulta directa a
 * Mercado Pago y el mismo tratamiento del resultado que usa el
 * webhook — para pedidos donde el webhook nunca llegó (típico en
 * desarrollo local, donde MP no puede alcanzar localhost) o se perdió.
 */
export async function reconcilePaymentAction(orderId: string): Promise<ReconcilePaymentActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_RECONCILIAR.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const adminDb = createAdminClient();

  const { data: payment } = await adminDb
    .from("payments")
    .select("provider_payment_id")
    .eq("order_id", orderId)
    .eq("provider", "mercadopago")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!payment?.provider_payment_id) {
    return { error: "Este pedido no tiene un pago de Mercado Pago para consultar" };
  }

  try {
    const result = await new PaymentService(adminDb).reconcilePayment(payment.provider_payment_id);
    if (!result) {
      return { error: "Mercado Pago no encontró ese pago" };
    }

    if (result.status === "approved") {
      await new OrderFulfillmentService(adminDb).fulfillPaidOrder(result.orderId);
    }

    revalidatePath("/admin/pedidos");
    return { ok: true, status: result.status };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo consultar el pago" };
  }
}

export interface ReleaseStaleReservationsActionResult {
  error?: string;
  ok?: boolean;
  checked?: number;
  released?: number;
}

/**
 * Botón "Liberar reservas vencidas" de /admin/productos. Reutiliza
 * OrderService.releaseStaleReservations() — la misma función que usa
 * el cron /api/cron/release-stale-reservations — para cuando nadie
 * está disparando ese cron todavía (típico en desarrollo local).
 */
export async function releaseStaleReservationsAction(): Promise<ReleaseStaleReservationsActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_LIBERAR_RESERVAS.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const adminDb = createAdminClient();
  const orderService = new OrderService(adminDb);

  try {
    const result = await orderService.releaseStaleReservations(STALE_THRESHOLD_MINUTES);
    revalidatePath("/admin/productos");
    return { ok: true, checked: result.checked, released: result.released };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudieron liberar las reservas" };
  }
}
