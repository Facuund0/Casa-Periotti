import { notFound, redirect } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import Link from "next/link";

const STATUS_LABELS: Record<string, string> = {
  created: "Creado",
  pending_payment: "Esperando pago",
  payment_processing: "Procesando pago",
  paid: "Pagado",
  payment_failed: "Pago rechazado",
  preparing: "En preparación",
  ready_for_pickup: "Listo para retirar",
  shipped: "Enviado",
  completed: "Completado",
  cancelled: "Cancelado",
};

export default async function OrderStatusPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, status, total, customer_id, fulfillment_method")
    .eq("id", id)
    .maybeSingle();

  if (!order || order.customer_id !== user.id) notFound();

  const { data: invoice } = await supabase
    .from("invoices")
    .select("status, voucher_number, sales_point, cae")
    .eq("order_id", id)
    .maybeSingle();

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="max-w-md w-full bg-white rounded-xl border border-neutral-200 p-8 text-center">
        <h1 className="text-xl font-bold mb-1">Pedido #{order.order_number}</h1>
        <p className="text-sm text-neutral-500 mb-6">
          {order.fulfillment_method === "pickup" ? "Retiro en local" : "Envío a domicilio"}
        </p>

        <div className="inline-block rounded-full bg-neutral-100 px-4 py-1.5 text-sm font-medium mb-4">
          {STATUS_LABELS[order.status] ?? order.status}
        </div>

        <p className="text-2xl font-bold mb-6">$ {Number(order.total).toLocaleString("es-AR")}</p>

        {order.status === "paid" && (
          <p className="text-sm text-green-700 mb-4">
            ¡Gracias por tu compra! Te enviamos la confirmación por email.
          </p>
        )}
        {order.status === "pending_payment" && (
          <p className="text-sm text-amber-700 mb-4">
            Tu pago se está confirmando. Esto puede demorar unos segundos.
          </p>
        )}
        {order.status === "payment_failed" && (
          <p className="text-sm text-red-700 mb-4">
            El pago no se pudo procesar. El stock reservado ya se liberó.
          </p>
        )}

        {invoice?.status === "authorized" && (
          <p className="text-xs text-neutral-500 mb-4">
            Factura {String(invoice.sales_point).padStart(4, "0")}-
            {String(invoice.voucher_number).padStart(8, "0")} — CAE {invoice.cae}
          </p>
        )}

        <Link href="/" className="text-sm underline">
          Volver al catálogo
        </Link>
      </div>
    </main>
  );
}
