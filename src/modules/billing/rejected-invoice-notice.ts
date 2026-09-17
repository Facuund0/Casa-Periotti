import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pushNotifications } from "@/modules/notifications/push-service";

/**
 * Aviso push cuando ARCA rechaza una factura. Se llama desde
 * BillingService y está acá aparte por una razón: la facturación puede
 * correr dentro de after() (una confirmación de pago o una venta de
 * mostrador) o fuera de un pedido HTTP (el cron diario), y after() solo
 * existe en el primer caso. Acá se intenta usarlo y, si no hay pedido,
 * se manda directo.
 *
 * Nunca tira ni demora la facturación: el rechazo ya quedó registrado en
 * la factura antes de llamar a esto.
 */
export function notifyInvoiceRejected(
  adminDb: SupabaseClient,
  params: { orderId: string | null; reason: string | null }
): void {
  const send = async () => {
    try {
      let orderNumber: number | null = null;
      if (params.orderId) {
        const { data } = await adminDb
          .from("orders")
          .select("order_number")
          .eq("id", params.orderId)
          .maybeSingle();
        orderNumber = data?.order_number ?? null;
      }
      await pushNotifications.invoiceRejected(adminDb, { orderNumber, reason: params.reason });
    } catch (err) {
      console.error("[rejected-invoice-notice] No se pudo notificar el rechazo:", err);
    }
  };

  try {
    // Import dinámico: si no hay pedido HTTP en curso (cron), after() tira
    // y se manda el aviso en el momento.
    import("next/server")
      .then(({ after }) => after(send))
      .catch(() => void send());
  } catch {
    void send();
  }
}
