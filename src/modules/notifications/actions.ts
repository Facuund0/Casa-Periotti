"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentCustomer, getCurrentEmployee } from "@/modules/auth/current-user";
import { PushService } from "./push-service";

/**
 * Alta y baja de las notificaciones push de un empleado, por dispositivo.
 * Se guarda con el cliente admin (la tabla solo deja leer y borrar lo
 * propio vía RLS), siempre para el empleado de la sesión: nunca se
 * recibe un employee_id del navegador.
 */

export interface PushActionResult {
  error?: string;
  ok?: boolean;
}

interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function parseSubscription(input: unknown): SubscriptionInput | null {
  if (!input || typeof input !== "object") return null;
  const sub = input as Partial<SubscriptionInput>;
  const endpoint = typeof sub.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const auth = typeof sub.keys?.auth === "string" ? sub.keys.auth : "";
  if (!endpoint.startsWith("https://") || endpoint.length > 1000 || !p256dh || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

/** Quién está activando: un empleado o un cliente. Los dos pueden. */
async function currentSubscriber(): Promise<{ id: string; type: "empleado" | "cliente" } | null> {
  const employee = await getCurrentEmployee();
  if (employee) return { id: employee.id, type: "empleado" };
  const customer = await getCurrentCustomer();
  if (customer) return { id: customer.id, type: "cliente" };
  return null;
}

export async function subscribeToPushAction(
  rawSubscription: unknown,
  userAgent?: string,
  origin?: string
): Promise<PushActionResult> {
  const subscriber = await currentSubscriber();
  if (!subscriber) return { error: "Necesitás iniciar sesión" };

  const subscription = parseSubscription(rawSubscription);
  if (!subscription) return { error: "El navegador no devolvió una suscripción válida" };

  const { error } = await createAdminClient()
    .from("push_subscriptions")
    .upsert(
      {
        user_id: subscriber.id,
        subscriber_type: subscriber.type,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: (userAgent ?? "").slice(0, 300) || null,
        // Desde qué copia del sitio se activó (el sitio real, un preview,
        // localhost): sus avisos salen con el icono y los links de esa copia.
        origin: (origin ?? "").slice(0, 200) || null,
        last_failure_at: null,
      },
      { onConflict: "endpoint" }
    );

  if (error) {
    console.error("[subscribeToPushAction]", error.message);
    return { error: "No se pudieron activar las notificaciones. Probá de nuevo." };
  }

  revalidatePath("/admin/notificaciones");
  revalidatePath("/mi-cuenta");
  return { ok: true };
}

export async function unsubscribeFromPushAction(endpoint: string): Promise<PushActionResult> {
  const subscriber = await currentSubscriber();
  if (!subscriber) return { error: "No autorizado" };

  const { error } = await createAdminClient()
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", String(endpoint).slice(0, 1000))
    // Solo puede borrar sus propios dispositivos.
    .eq("user_id", subscriber.id);

  if (error) {
    console.error("[unsubscribeFromPushAction]", error.message);
    return { error: "No se pudieron desactivar las notificaciones" };
  }

  revalidatePath("/admin/notificaciones");
  revalidatePath("/mi-cuenta");
  return { ok: true };
}

/**
 * Manda un aviso de prueba a los dispositivos del propio empleado, para
 * verificar que llegue sin tener que generar un pedido real.
 */
export async function sendTestPushAction(): Promise<PushActionResult & { sent?: number }> {
  const subscriber = await currentSubscriber();
  if (!subscriber) return { error: "No autorizado" };

  const { sent } = await new PushService(createAdminClient()).notifyUser(subscriber.id, {
    title: "Aviso de prueba",
    body: "Si ves esto, las notificaciones están funcionando en este dispositivo.",
    url: subscriber.type === "empleado" ? "/admin/notificaciones" : "/mi-cuenta",
    tag: `prueba-${Date.now()}`,
  });

  if (sent === 0) {
    return {
      error:
        "No se pudo entregar el aviso. Revisá que las notificaciones estén activadas en este dispositivo.",
    };
  }
  return { ok: true, sent };
}
