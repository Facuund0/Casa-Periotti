import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { BusinessSettingsService } from "@/modules/billing/business-settings-service";
import { OrderAdminDetailService } from "@/modules/orders/order-admin-detail-service";
import { getOrderFiscalChoice } from "@/modules/orders/order-fiscal-choice";
import { PAYMENT_METHOD_LABELS, type PosPaymentMethod } from "@/modules/pos/schemas";
import { formatDateTimeAR } from "@/shared/utils/argentina-time";
import { formatQuantity } from "@/shared/utils/quantity";
import { firstParam } from "@/shared/utils/search-params";
import { PrintOnLoad } from "./print-on-load";

export const dynamic = "force-dynamic";

/**
 * Ticket de 80 mm para la impresora del mostrador. Es el comprobante de
 * entrega que se le da al cliente en el momento: NO reemplaza a la
 * factura, que la emite ARCA unos segundos después de la venta y se
 * imprime o se manda por mail desde Facturación.
 *
 * Solo lee. No cobra, no factura y no toca stock.
 *
 * Se puede volver a imprimir cuando sea: la pantalla se arma con lo que
 * quedó guardado del pedido, no con lo que había en la pantalla de venta.
 */

function money(n: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function TicketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "ventas"].includes(employee.role)) {
    redirect("/admin");
  }

  const { id } = await params;
  const auto = firstParam((await searchParams).auto) === "1";

  const adminDb = createAdminClient();

  const { data: order } = await adminDb
    .from("orders")
    .select("id, order_number, subtotal, vat_amount, total, created_at, status")
    .eq("id", id)
    .maybeSingle();

  if (!order) {
    return (
      <div className="neu-card p-6">
        <p className="text-sm text-ink">No se encontró esa venta.</p>
        <Link href="/admin/venta" className="mt-3 inline-block text-xs text-brand hover:underline">
          Volver a la venta de mostrador
        </Link>
      </div>
    );
  }

  const [detail, settings, fiscal, { data: payment }, { data: invoice }, { data: soldBy }] =
    await Promise.all([
      new OrderAdminDetailService(adminDb).getMany([order.id]).then((m) => m.get(order.id)),
      new BusinessSettingsService(adminDb).get(),
      getOrderFiscalChoice(adminDb, order.id),
      adminDb
        .from("payments")
        .select("provider, payment_method_id")
        .eq("order_id", order.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Si la factura ya salió, el ticket muestra su número: así el cliente
      // tiene con qué reclamarla. Si todavía no, se dice que va por mail.
      adminDb
        .from("invoices")
        .select("invoice_type, sales_point, voucher_number, cae, status")
        .eq("order_id", order.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Quién hizo la venta, no quién está imprimiendo: un ticket que se
      // reimprime al otro día tiene que seguir diciendo lo mismo.
      adminDb
        .from("order_fiscal_choices")
        .select("created_by")
        .eq("order_id", order.id)
        .maybeSingle(),
    ]);

  // created_by apunta a auth.users, así que el nombre se busca aparte.
  const { data: seller } = soldBy?.created_by
    ? await adminDb
        .from("employee_profiles")
        .select("full_name")
        .eq("id", soldBy.created_by)
        .maybeSingle()
    : { data: null };

  const paymentLabel =
    payment?.provider === "pos"
      ? (PAYMENT_METHOD_LABELS[payment.payment_method_id as PosPaymentMethod] ?? "Contado")
      : payment?.provider === "transferencia"
        ? "Transferencia"
        : payment?.provider === "mercadopago"
          ? "Mercado Pago"
          : "—";

  const buyerName = fiscal?.padronLegalName ?? fiscal?.buyerName ?? detail?.customerName ?? null;
  const buyerId = fiscal?.cuit ?? fiscal?.dni ?? null;
  const authorized = invoice?.status === "authorized" && invoice.voucher_number;
  const sellerName = seller?.full_name ?? null;

  return (
    <div>
      {auto && <PrintOnLoad />}

      {/* Al imprimir queda solo el ticket: el panel entero alrededor se
          esconde, sin sacarlo del DOM. */}
      <style>{`
        @media print {
          @page { size: 80mm auto; margin: 0; }
          body * { visibility: hidden !important; }
          #ticket, #ticket * { visibility: visible !important; }
          #ticket { position: absolute; left: 0; top: 0; width: 72mm; box-shadow: none !important; }
        }
      `}</style>

      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/admin/venta" className="neu-btn !px-3 !py-1.5 !text-xs">
          Volver a vender
        </Link>
        <Link
          href={`/admin/venta/ticket/${order.id}?auto=1`}
          className="neu-btn neu-btn-primary !px-3 !py-1.5 !text-xs"
        >
          Imprimir
        </Link>
        <p className="text-xs text-ink-muted">
          Sale en 80 mm. Es un comprobante de entrega, no la factura.
        </p>
      </div>

      <div
        id="ticket"
        className="neu-card mx-auto bg-white p-3 font-mono text-[11px] leading-tight text-black"
        style={{ width: "76mm" }}
      >
        <div className="text-center">
          <p className="text-[13px] font-bold uppercase">
            {settings?.tradeName ?? settings?.legalName ?? "Casa Periotti"}
          </p>
          {settings?.legalName && settings.tradeName && <p>{settings.legalName}</p>}
          {settings?.cuit && <p>CUIT {settings.cuit}</p>}
          {settings?.addressStreet && (
            <p>{[settings.addressStreet, settings.addressCity].filter(Boolean).join(" - ")}</p>
          )}
          {settings?.contactPhone && <p>Tel {settings.contactPhone}</p>}
        </div>

        <Separator />

        <p>Venta N° {order.order_number}</p>
        <p>{formatDateTimeAR(order.created_at)}</p>
        {sellerName && <p>Atendió: {sellerName}</p>}
        {buyerName && <p>Cliente: {buyerName}</p>}
        {buyerId && <p>{fiscal?.cuit ? "CUIT" : "DNI"}: {buyerId}</p>}

        <Separator />

        {(detail?.lines ?? []).map((line, i) => (
          <div key={i} className="mb-1">
            <p className="break-words">{line.productName}</p>
            <div className="flex justify-between tabular-nums">
              <span>
                {formatQuantity(line.quantity)} x {money(line.unitPrice)}
                {line.priceType === "wholesale" ? " (may.)" : ""}
              </span>
              <span>{money(line.lineTotal)}</span>
            </div>
          </div>
        ))}

        <Separator />

        <div className="flex justify-between tabular-nums">
          <span>Subtotal sin IVA</span>
          <span>{money(Number(order.subtotal))}</span>
        </div>
        <div className="flex justify-between tabular-nums">
          <span>IVA</span>
          <span>{money(Number(order.vat_amount))}</span>
        </div>
        <div className="mt-1 flex justify-between text-[14px] font-bold tabular-nums">
          <span>TOTAL</span>
          <span>$ {money(Number(order.total))}</span>
        </div>
        <p className="mt-1">Pago: {paymentLabel}</p>

        <Separator />

        {authorized ? (
          <p>
            Factura {invoice.invoice_type}{" "}
            {String(invoice.sales_point ?? "").padStart(4, "0")}-
            {String(invoice.voucher_number).padStart(8, "0")}
            {invoice.cae ? ` · CAE ${invoice.cae}` : ""}
          </p>
        ) : (
          <p>Factura en emisión. Se envía por mail o se retira por el local.</p>
        )}
        <p className="mt-1 text-center">Comprobante de entrega — no válido como factura</p>
        <p className="text-center">¡Gracias por su compra!</p>
      </div>
    </div>
  );
}

function Separator() {
  return <p className="my-1 overflow-hidden whitespace-nowrap">------------------------------</p>;
}
