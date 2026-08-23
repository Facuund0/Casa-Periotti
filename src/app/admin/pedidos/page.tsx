import { redirect } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { ReconcilePaymentButton } from "./reconcile-payment-button";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "ventas"].includes(employee.role)) {
    redirect("/admin");
  }

  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number, total, created_at")
    .eq("status", "payment_processing")
    .order("created_at", { ascending: false });

  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Pedidos con pago pendiente de confirmar</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Mercado Pago dejó el pago en revisión y todavía no llegó (o nunca va a llegar — típico en
        desarrollo local, donde Mercado Pago no puede alcanzar tu máquina) la confirmación del
        webhook. Consultá el estado real directo contra Mercado Pago.
      </p>

      <div className="bg-white rounded-lg border border-neutral-200 divide-y divide-neutral-100">
        {(orders ?? []).map((o) => (
          <div key={o.id} className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Pedido #{o.order_number}</p>
              <p className="text-xs text-neutral-500">
                $ {Number(o.total).toLocaleString("es-AR")} ·{" "}
                {new Date(o.created_at).toLocaleString("es-AR")}
              </p>
            </div>
            <ReconcilePaymentButton orderId={o.id} />
          </div>
        ))}
        {(!orders || orders.length === 0) && (
          <p className="p-6 text-center text-sm text-neutral-400">
            No hay pedidos con pago pendiente de confirmar.
          </p>
        )}
      </div>
    </div>
  );
}
