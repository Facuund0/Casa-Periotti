"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";

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

export async function subscribeToPushAction(
  rawSubscription: unknown,
  userAgent?: string
): Promise<PushActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { error: "Solo los empleados reciben notificaciones" };

  const subscription = parseSubscription(rawSubscription);
  if (!subscription) return { error: "El navegador no devolvió una suscripción válida" };

  const { error } = await createAdminClient()
    .from("push_subscriptions")
    .upsert(
      {
        employee_id: employee.id,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        user_agent: (userAgent ?? "").slice(0, 300) || null,
        last_failure_at: null,
      },
      { onConflict: "endpoint" }
    );

  if (error) {
    console.error("[subscribeToPushAction]", error.message);
    return { error: "No se pudieron activar las notificaciones. Probá de nuevo." };
  }

  revalidatePath("/admin/notificaciones");
  return { ok: true };
}

export async function unsubscribeFromPushAction(endpoint: string): Promise<PushActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { error: "No autorizado" };

  const { error } = await createAdminClient()
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", String(endpoint).slice(0, 1000))
    // Solo puede borrar sus propios dispositivos.
    .eq("employee_id", employee.id);

  if (error) {
    console.error("[unsubscribeFromPushAction]", error.message);
    return { error: "No se pudieron desactivar las notificaciones" };
  }

  revalidatePath("/admin/notificaciones");
  return { ok: true };
}
