import { redirect } from "next/navigation";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { TransferPaymentService, isTransferExpired } from "@/modules/payments/transfer-payment-service";
import { buildTransferReference } from "@/modules/payments/transfer-config";
import { VerifyPaymentButtons } from "./verify-payment-buttons";
import { OrderAdminDetailService } from "@/modules/orders/order-admin-detail-service";
import { OrderDetailBody, OrderSummaryChips } from "../_components/order-detail";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage() {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "ventas"].includes(employee.role)) {
    redirect("/admin");
  }

  // Cliente admin: hay que leer comprobantes y firmar URLs de un bucket
  // privado, y eso no pasa por RLS.
  const adminDb = createAdminClient();
  const transferService = new TransferPaymentService(adminDb);

  const { data: orders } = await adminDb
    .from("orders")
    .select("id, order_number, total, created_at, fulfillment_method, customer_id")
    .eq("status", "payment_processing")
    .order("created_at", { ascending: true });

  const orderIds = (orders ?? []).map((o) => o.id);

  const { data: receipts } = orderIds.length
    ? await adminDb
        .from("payment_receipts")
        .select("order_id, storage_path, file_mime, uploaded_at, review_status")
        .in("order_id", orderIds)
        .eq("review_status", "pending")
    : { data: [] as ReceiptRow[] };

  // Productos, contacto, importes y dirección de cada pedido, de a lote.
  const details = await new OrderAdminDetailService(adminDb).getMany(orderIds);
  const receiptByOrder = new Map((receipts ?? []).map((r) => [r.order_id, r]));

  // Las URLs firmadas se generan de a una acá, en el servidor, y viven 5
  // minutos. El bucket es privado: nunca se expone una URL pública del
  // comprobante.
  const signedUrls = new Map<string, string | null>();
  for (const receipt of receipts ?? []) {
    signedUrls.set(receipt.order_id, await transferService.getSignedReceiptUrl(receipt.storage_path));
  }

  return (
    <div>
      <h1 className="text-lg font-bold mb-1">Pagos por transferencia a verificar</h1>
      <p className="text-sm text-ink-muted mb-6">
        El cliente ya subió el comprobante y el stock sigue reservado. Cotejá el{" "}
        <span className="font-medium">monto exacto</span> y la{" "}
        <span className="font-medium">hora del pedido</span> contra el homebanking — muchos clientes
        no ponen la referencia en la transferencia. Al confirmar se descuenta el stock, se emite la
        factura y se le avisa al cliente.
      </p>

      <div className="neu-card">
        {(orders ?? []).map((o) => {
          const receipt = receiptByOrder.get(o.id);
          const signedUrl = signedUrls.get(o.id) ?? null;
          const expired = isTransferExpired(o.created_at);
          const detail = details.get(o.id);

          return (
            <div key={o.id} className="neu-row p-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <p className="text-sm font-medium">Pedido #{o.order_number}</p>
                  <span className="text-xs font-mono bg-surface-sunken rounded px-1.5 py-0.5">
                    {buildTransferReference(o.order_number)}
                  </span>
                </div>

                {/* Monto y hora bien grandes: son los dos datos con los
                    que se cruza la transferencia en el homebanking
                    cuando el cliente no puso la referencia. */}
                <p className="text-xl font-bold tabular-nums mt-1">
                  $ {Number(o.total).toLocaleString("es-AR")}
                </p>
                <p className="text-sm text-ink-muted tabular-nums">
                  Pedido: {new Date(o.created_at).toLocaleString("es-AR")}
                </p>

                <p className="text-sm text-ink mt-1">
                  {detail?.customerName ?? "Cliente sin perfil"}
                  {detail?.customerPhone && (
                    <a href={`tel:${detail.customerPhone}`} className="ml-2 text-xs text-brand hover:underline">
                      {detail.customerPhone}
                    </a>
                  )}
                </p>
                {detail && <OrderSummaryChips detail={detail} />}

                {receipt && (
                  <p className="text-xs text-ink-muted mt-1 tabular-nums">
                    Comprobante subido: {new Date(receipt.uploaded_at).toLocaleString("es-AR")}
                  </p>
                )}

                {expired && (
                  <p className="text-xs text-warning mt-1">
                    Se pasó del plazo, pero como hay comprobante no se canceló solo — revisalo igual.
                  </p>
                )}

                {signedUrl ? (
                  <a
                    href={signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block mt-2 text-xs underline"
                  >
                    Ver comprobante{receipt?.file_mime === "application/pdf" ? " (PDF)" : ""}
                  </a>
                ) : (
                  <p className="text-xs text-danger mt-2">
                    {receipt
                      ? "No se pudo generar el link del comprobante — reintentá recargando la página."
                      : "Este pedido está esperando confirmación pero no tiene comprobante cargado. Revisalo a mano."}
                  </p>
                )}
              </div>

              <VerifyPaymentButtons orderId={o.id} />
            </div>

            {/* Detalle completo plegado: con muchos pedidos, la lista se
                recorre por la fila y se abre solo el que se va a preparar. */}
            {detail ? (
              <details className="mt-3 border-t border-[color:var(--hairline)] pt-2">
                <summary className="cursor-pointer text-xs font-medium text-brand">
                  Ver productos, importes y contacto
                </summary>
                <OrderDetailBody detail={detail} />
              </details>
            ) : (
              <p className="mt-2 text-xs text-danger">No se pudo leer el detalle de este pedido.</p>
            )}
            </div>
          );
        })}

        {(!orders || orders.length === 0) && (
          <p className="p-6 text-center text-sm text-ink-subtle">
            No hay transferencias esperando verificación.
          </p>
        )}
      </div>
    </div>
  );
}

interface ReceiptRow {
  order_id: string;
  storage_path: string;
  file_mime: string;
  uploaded_at: string;
  review_status: string;
}
