import { notFound, redirect } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import Link from "next/link";
import { Logo } from "@/app/_components/logo";

const STATUS_LABELS: Record<string, string> = {
  created: "Creado",
  pending_payment: "Esperando tu transferencia",
  payment_processing: "Esperando confirmación de pago",
  paid: "Pagado",
  payment_failed: "Pago rechazado",
  preparing: "En preparación",
  ready_for_pickup: "Listo para retirar",
  shipped: "Enviado",
  completed: "Completado",
  cancelled: "Cancelado",
};

/** Cada estado con su color: el cliente tiene que entender de un
    vistazo si está todo bien o si falta algo suyo. */
const STATUS_TONE: Record<string, string> = {
  paid: "bg-success-soft text-success",
  completed: "bg-success-soft text-success",
  ready_for_pickup: "bg-success-soft text-success",
  pending_payment: "bg-warning-soft text-warning",
  payment_processing: "bg-info-soft text-info",
  preparing: "bg-info-soft text-info",
  shipped: "bg-info-soft text-info",
  payment_failed: "bg-danger-soft text-danger",
  cancelled: "bg-danger-soft text-danger",
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

  const message = MESSAGES[order.status];

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" className="inline-block rounded-neu-sm">
            <Logo size="lg" showTagline />
          </Link>
        </div>

        <div className="neu-card p-6 text-center sm:p-8">
          <h1 className="text-xl font-bold text-ink">Pedido #{order.order_number}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            {order.fulfillment_method === "pickup" ? "Retiro en local" : "Envío a domicilio"}
          </p>

          <div className="mt-5">
            <span
              className={`neu-badge !px-4 !py-1.5 !text-sm ${
                STATUS_TONE[order.status] ?? "bg-secondary-soft text-ink-muted"
              }`}
            >
              {STATUS_LABELS[order.status] ?? order.status}
            </span>
          </div>

          <p className="mt-5 text-3xl font-bold tabular-nums text-ink">
            $ {Number(order.total).toLocaleString("es-AR")}
          </p>

          {message && (
            <p className={`mt-5 text-sm ${message.tone}`}>{message.text}</p>
          )}

          {invoice?.status === "authorized" && (
            <div className="neu-inset mt-5 p-3">
              <p className="text-xs text-ink-muted">
                Factura {String(invoice.sales_point).padStart(4, "0")}-
                {String(invoice.voucher_number).padStart(8, "0")}
              </p>
              <p className="text-[0.6875rem] text-ink-subtle">CAE {invoice.cae}</p>
            </div>
          )}

          <Link href="/" className="neu-btn mt-6 w-full">
            Volver al catálogo
          </Link>
        </div>
      </div>
    </main>
  );
}

const MESSAGES: Record<string, { text: string; tone: string }> = {
  paid: {
    text: "¡Gracias por tu compra! Te enviamos la confirmación por email.",
    tone: "text-success",
  },
  pending_payment: {
    text: "Todavía no recibimos tu comprobante. Si ya transferiste, volvé al checkout y subilo para que podamos confirmar el pago.",
    tone: "text-warning",
  },
  payment_processing: {
    text: "Recibimos tu comprobante. Estamos verificando la transferencia y te avisamos por email en cuanto quede confirmada — normalmente dentro del horario del local.",
    tone: "text-info",
  },
  payment_failed: {
    text: "No pudimos confirmar la transferencia, así que el stock reservado se liberó. Si creés que es un error, escribinos con el comprobante a mano.",
    tone: "text-danger",
  },
  cancelled: {
    text: "Este pedido se canceló porque venció el plazo de pago y el stock se liberó. Podés armarlo de nuevo desde el catálogo.",
    tone: "text-ink-muted",
  },
};
