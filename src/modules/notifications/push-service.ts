import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";

/**
 * Notificaciones push a los empleados (Web Push con claves VAPID).
 *
 * Reglas de este módulo:
 *  - NUNCA tira una excepción hacia afuera: un aviso que no sale no puede
 *    romper una venta, una facturación ni una aprobación. Mismo criterio
 *    que los mails.
 *  - Se llama con after() desde la acción que genera el evento, así el
 *    envío no demora la respuesta.
 *  - Si el navegador contesta que la suscripción ya no vale (410 Gone o
 *    404), se borra en vez de reintentar para siempre.
 *  - Cada aviso lleva el link a la pantalla del panel donde se resuelve.
 */

export type PushAudience = "pedidos" | "facturacion";

/** Qué roles reciben cada tipo de aviso. */
const ROLES_BY_AUDIENCE: Record<PushAudience, string[]> = {
  // Pedidos a confirmar y solicitudes de mayorista.
  pedidos: ["ventas", "admin", "super_admin"],
  // Facturas rechazadas por ARCA.
  facturacion: ["facturacion", "admin", "super_admin"],
};

export interface PushMessage {
  title: string;
  body: string;
  /** Ruta interna del panel donde se resuelve (por ejemplo "/admin/pedidos"). */
  url: string;
  /**
   * Identifica al aviso. Tiene que ser ÚNICO por evento: con un tag
   * repetido, el aviso nuevo REEMPLAZA al anterior en la bandeja y en el
   * celular puede pasar desapercibido. Se repite solo cuando el evento es
   * el mismo (por ejemplo, dos intentos de facturar el mismo pedido).
   */
  tag: string;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** true si están cargadas las tres variables VAPID. */
export function isPushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT
  );
}

function configureWebPush(): boolean {
  if (!isPushConfigured()) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  return true;
}

export class PushService {
  constructor(private readonly adminDb: SupabaseClient) {}

  /**
   * Manda el aviso a todos los dispositivos de los empleados activos con
   * el rol que corresponde. Devuelve cuántos se entregaron, para el log.
   */
  async notify(audience: PushAudience, message: PushMessage): Promise<{ sent: number; removed: number }> {
    try {
      if (!configureWebPush()) {
        console.warn(
          "[PushService] Faltan las claves VAPID (NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT): no se envían notificaciones."
        );
        return { sent: 0, removed: 0 };
      }

      const { data: employees, error: employeesError } = await this.adminDb
        .from("employee_profiles")
        .select("id")
        .eq("active", true)
        .in("role", ROLES_BY_AUDIENCE[audience]);
      if (employeesError) throw new Error(employeesError.message);

      const employeeIds = (employees ?? []).map((e) => e.id);
      if (!employeeIds.length) return { sent: 0, removed: 0 };

      const { data: subscriptions, error: subsError } = await this.adminDb
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .in("employee_id", employeeIds);
      if (subsError) throw new Error(subsError.message);
      if (!subscriptions?.length) return { sent: 0, removed: 0 };

      const payload = JSON.stringify(message);
      const results = await Promise.all(
        (subscriptions as SubscriptionRow[]).map((sub) => this.deliver(sub, payload))
      );

      const sent = results.filter((r) => r === "sent").length;
      const removed = results.filter((r) => r === "removed").length;
      return { sent, removed };
    } catch (err) {
      // Un aviso nunca rompe la operación que lo generó.
      console.error("[PushService] No se pudieron enviar las notificaciones:", err);
      return { sent: 0, removed: 0 };
    }
  }

  /**
   * Manda un aviso solo a los dispositivos de UN empleado. Lo usa el
   * botón de prueba de /admin/notificaciones.
   */
  async notifyEmployee(employeeId: string, message: PushMessage): Promise<{ sent: number; removed: number }> {
    try {
      if (!configureWebPush()) return { sent: 0, removed: 0 };
      const { data: subscriptions, error } = await this.adminDb
        .from("push_subscriptions")
        .select("id, endpoint, p256dh, auth")
        .eq("employee_id", employeeId);
      if (error) throw new Error(error.message);
      if (!subscriptions?.length) return { sent: 0, removed: 0 };

      const payload = JSON.stringify(message);
      const results = await Promise.all(
        (subscriptions as SubscriptionRow[]).map((sub) => this.deliver(sub, payload))
      );
      return {
        sent: results.filter((r) => r === "sent").length,
        removed: results.filter((r) => r === "removed").length,
      };
    } catch (err) {
      console.error("[PushService] No se pudo enviar el aviso de prueba:", err);
      return { sent: 0, removed: 0 };
    }
  }

  private async deliver(sub: SubscriptionRow, payload: string): Promise<"sent" | "removed" | "failed"> {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        {
          TTL: 60 * 60 * 6,
          // Prioridad alta: en Android, los avisos de urgencia normal
          // pueden quedar en cola mientras el teléfono está en reposo.
          urgency: "high",
        }
      );
      await this.adminDb
        .from("push_subscriptions")
        .update({ last_success_at: new Date().toISOString() })
        .eq("id", sub.id);
      return "sent";
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // 410 Gone / 404: el navegador revocó la suscripción (se desinstaló
      // la app, se limpiaron los datos del sitio). No sirve reintentar.
      if (status === 410 || status === 404) {
        await this.adminDb.from("push_subscriptions").delete().eq("id", sub.id);
        return "removed";
      }
      console.error(`[PushService] Falló el envío a una suscripción (status ${status ?? "?"}):`, err);
      await this.adminDb
        .from("push_subscriptions")
        .update({ last_failure_at: new Date().toISOString() })
        .eq("id", sub.id);
      return "failed";
    }
  }
}

/**
 * Atajos de los tres avisos del sistema. Los llama la acción que genera
 * el evento, siempre dentro de after().
 */
export const pushNotifications = {
  orderToConfirm(adminDb: SupabaseClient, params: { orderNumber: number; total: number; customerName: string | null }) {
    return new PushService(adminDb).notify("pedidos", {
      title: `Nuevo pedido a confirmar #${params.orderNumber}`,
      body: `${params.customerName ?? "Cliente"} subió el comprobante por $ ${params.total.toLocaleString("es-AR")}. Verificá la transferencia.`,
      url: "/admin/pedidos",
      tag: `pedido-${params.orderNumber}`,
    });
  },

  wholesaleRequest(adminDb: SupabaseClient, params: { customerName: string }) {
    return new PushService(adminDb).notify("pedidos", {
      title: "Nueva solicitud de mayorista",
      body: `${params.customerName} se registró pidiendo precio mayorista. Revisá el CUIT y aprobalo.`,
      url: "/admin/clientes",
      // Con el momento incluido: dos solicitudes distintas no se tapan.
      tag: `mayorista-${Date.now()}`,
    });
  },

  invoiceRejected(
    adminDb: SupabaseClient,
    params: { orderNumber: number | null; reason: string | null }
  ) {
    const where = params.orderNumber ? ` del pedido #${params.orderNumber}` : "";
    return new PushService(adminDb).notify("facturacion", {
      title: "ARCA rechazó una factura",
      body: `La venta${where} está cobrada pero sin comprobante válido.${
        params.reason ? ` Motivo: ${params.reason.slice(0, 120)}` : ""
      }`,
      url: "/admin/facturacion?status=rejected",
      tag: `factura-rechazada-${params.orderNumber ?? "manual"}-${Date.now()}`,
    });
  },
};
