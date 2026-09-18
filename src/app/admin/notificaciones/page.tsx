import { redirect } from "next/navigation";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { isPushConfigured } from "@/modules/notifications/push-service";
import { PushManager, type PushDevice } from "./push-manager";

export const dynamic = "force-dynamic";

/** Qué avisos recibe cada rol (igual que ROLES_BY_AUDIENCE en push-service.ts). */
const ALERTS_BY_ROLE: Record<string, string[]> = {
  super_admin: ["Pedidos a confirmar", "Solicitudes de mayorista", "Facturas rechazadas por ARCA"],
  admin: ["Pedidos a confirmar", "Solicitudes de mayorista", "Facturas rechazadas por ARCA"],
  ventas: ["Pedidos a confirmar", "Solicitudes de mayorista"],
  facturacion: ["Facturas rechazadas por ARCA"],
  stock: [],
};

export default async function AdminNotificacionesPage() {
  const employee = await getCurrentEmployee();
  if (!employee) redirect("/login");

  const { data } = await createAdminClient()
    .from("push_subscriptions")
    .select("endpoint, user_agent, origin, created_at, last_success_at")
    .eq("user_id", employee.id)
    .order("created_at", { ascending: false });

  const devices: PushDevice[] = (data ?? []).map((d) => ({
    endpoint: d.endpoint,
    userAgent: d.user_agent,
    origin: d.origin,
    createdAt: d.created_at,
    lastSuccessAt: d.last_success_at,
  }));

  const alerts = ALERTS_BY_ROLE[employee.role] ?? [];

  return (
    <div>
      <h1 className="mb-1 text-lg font-bold text-ink">Notificaciones</h1>
      <p className="mb-6 max-w-2xl text-sm text-ink-muted">
        Avisos en el celular o la computadora cuando hay algo para resolver, sin tener que mirar el
        panel. Se activan por dispositivo: podés recibirlas en el celular y no en la computadora.
      </p>

      <div className="neu-card mb-6 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
          Según tu rol ({employee.role}) vas a recibir
        </p>
        {alerts.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">
            Tu rol no recibe ninguno de estos avisos. Podés activarlas igual: si más adelante te
            cambian el rol, ya te van a llegar.
          </p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm text-ink">
            {alerts.map((alert) => (
              <li key={alert}>· {alert}</li>
            ))}
          </ul>
        )}
      </div>

      <PushManager
        publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""}
        devices={devices}
        configured={isPushConfigured()}
        // Dominio del sitio real. Si algún día cambia, se ajusta con la
        // variable NEXT_PUBLIC_PRODUCTION_HOST en Vercel.
        productionHost={process.env.NEXT_PUBLIC_PRODUCTION_HOST ?? "casa-periotti.vercel.app"}
      />
    </div>
  );
}
