import { redirect } from "next/navigation";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { OrderAdminDetailService } from "@/modules/orders/order-admin-detail-service";
import type { OrderStatus } from "@/modules/orders/types";
import { formatDateTimeAR } from "@/shared/utils/argentina-time";
import { OrderDetailBody, OrderSummaryChips } from "../_components/order-detail";
import { AdvanceStatusButtons } from "./advance-status-button";

export const dynamic = "force-dynamic";

/**
 * Pedidos web ya cobrados que todavía hay que entregar. Antes, una vez
 * confirmado el pago el pedido desaparecía del panel y no quedaba
 * ninguna pantalla que dijera qué falta armar.
 *
 * Las ventas de mostrador NO aparecen: se cobran y se entregan en el
 * momento, así que no hay nada que preparar. Se las reconoce por el
 * pago con provider 'pos'.
 *
 * Esta pantalla solo mueve el estado de entrega (ver
 * fulfillment-status-actions.ts): no cobra, no factura y no toca stock.
 */

/** En este orden se muestran: primero lo que nadie empezó a armar. */
const GROUPS: { status: OrderStatus; title: string; hint: string }[] = [
  {
    status: "paid",
    title: "Para armar",
    hint: "Pagados y sin empezar. El stock ya está descontado.",
  },
  { status: "preparing", title: "En preparación", hint: "Alguien los está armando." },
  {
    status: "ready_for_pickup",
    title: "Listos para retirar",
    hint: "Esperando que el cliente pase por el local.",
  },
  { status: "shipped", title: "Enviados", hint: "En camino, esperando la entrega." },
];

/**
 * Cuántos pedidos se muestran. El detalle de cada uno (productos,
 * importes, dirección) viaja en el HTML aunque esté plegado, así que una
 * lista larga hace la página pesada y lenta. Los más viejos primero, que
 * son los que hay que atender.
 */
const MAX_ORDERS = 30;

type OrderRow = {
  id: string;
  order_number: number;
  total: number;
  status: OrderStatus;
  created_at: string;
  fulfillment_method: "pickup" | "delivery";
};

export default async function AdminPrepararPage() {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "ventas", "stock"].includes(employee.role)) {
    redirect("/admin");
  }

  // Cliente admin: hace falta cruzar pedidos, pagos, ítems y perfiles de
  // cliente, y eso no pasa por RLS.
  const adminDb = createAdminClient();

  const { data: rows } = await adminDb
    .from("orders")
    .select("id, order_number, total, status, created_at, fulfillment_method")
    .in(
      "status",
      GROUPS.map((g) => g.status)
    )
    // Los más viejos primero: es el que más está esperando.
    .order("created_at", { ascending: true });

  const allOrders = (rows ?? []) as OrderRow[];

  // Los pagos de mostrador se consultan sobre todos los candidatos, pero
  // el detalle (que es lo que pesa) solo de los que se van a mostrar.
  const allIds = allOrders.map((o) => o.id);
  const { data: posPayments } = allIds.length
    ? await adminDb.from("payments").select("order_id").in("order_id", allIds).eq("provider", "pos")
    : { data: [] as { order_id: string }[] };
  const fromCounter = new Set((posPayments ?? []).map((p) => p.order_id));

  const webOrders = allOrders.filter((o) => !fromCounter.has(o.id));
  const pending = webOrders.slice(0, MAX_ORDERS);
  const hidden = webOrders.length - pending.length;

  const details = await new OrderAdminDetailService(adminDb).getMany(pending.map((o) => o.id));

  return (
    <div>
      <h1 className="mb-1 text-lg font-bold text-ink">Pedidos a preparar</h1>
      <p className="mb-6 text-sm text-ink-muted">
        Pedidos web ya cobrados que falta entregar. Las ventas de mostrador no aparecen acá porque se
        entregan en el momento. Mover un pedido de estado no cobra, no factura y no toca el stock:
        solo deja anotado en qué punto está la entrega.
      </p>

      {hidden > 0 && (
        <p className="neu-inset mb-4 p-3 text-xs text-ink-muted">
          Se muestran los {MAX_ORDERS} pedidos más viejos. Quedan {hidden} más esperando: aparecen
          a medida que vas cerrando estos.
        </p>
      )}

      {pending.length === 0 && (
        <div className="neu-card p-6 text-center">
          <p className="text-sm text-ink">No queda ningún pedido web por entregar.</p>
          <p className="mt-1 text-xs text-ink-subtle">
            Los pedidos aparecen acá en cuanto se confirma el pago.
          </p>
        </div>
      )}

      <div className="space-y-6">
        {GROUPS.map((group) => {
          const groupOrders = pending.filter((o) => o.status === group.status);
          if (groupOrders.length === 0) return null;

          return (
            <section key={group.status}>
              <div className="mb-2 flex items-baseline gap-2">
                <h2 className="text-sm font-semibold text-ink">{group.title}</h2>
                <span className="neu-badge bg-surface-sunken text-ink-muted">
                  {groupOrders.length}
                </span>
                <span className="text-xs text-ink-subtle">{group.hint}</span>
              </div>

              <div className="neu-card">
                {groupOrders.map((order) => {
                  const detail = details.get(order.id);
                  return (
                    <div key={order.id} className="neu-row p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">
                            Pedido #{order.order_number}
                          </p>
                          <p className="mt-0.5 text-lg font-bold tabular-nums text-ink">
                            $ {Number(order.total).toLocaleString("es-AR")}
                          </p>
                          <p className="text-xs tabular-nums text-ink-muted">
                            Pedido: {formatDateTimeAR(order.created_at)}
                          </p>
                          <p className="mt-1 text-sm text-ink">
                            {detail?.customerName ?? "Cliente sin perfil"}
                            {detail?.customerPhone && (
                              <a
                                href={`tel:${detail.customerPhone}`}
                                className="ml-2 text-xs text-brand hover:underline"
                              >
                                {detail.customerPhone}
                              </a>
                            )}
                          </p>
                          {detail && <OrderSummaryChips detail={detail} />}
                        </div>

                        <AdvanceStatusButtons
                          orderId={order.id}
                          options={nextSteps(order.status, order.fulfillment_method)}
                        />
                      </div>

                      {detail && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-medium text-brand">
                            Ver qué lleva y a dónde va
                          </summary>
                          <OrderDetailBody detail={detail} />
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Qué botones tiene cada fila. Siguen la máquina de estados de
 * types.ts; la acción del servidor vuelve a validar la transición.
 */
function nextSteps(
  status: OrderStatus,
  method: "pickup" | "delivery"
): { to: OrderStatus; label: string; primary?: boolean }[] {
  if (status === "paid") return [{ to: "preparing", label: "Empezar a armar", primary: true }];
  if (status === "preparing") {
    return method === "delivery"
      ? [{ to: "shipped", label: "Marcar como enviado", primary: true }]
      : [{ to: "ready_for_pickup", label: "Listo para retirar", primary: true }];
  }
  // Listo para retirar o enviado: solo queda cerrarlo cuando el cliente lo recibió.
  return [{ to: "completed", label: "Entregado", primary: true }];
}
