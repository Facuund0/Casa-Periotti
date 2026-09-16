import { getCurrentCustomer } from "@/modules/auth/current-user";
import { readThreshold } from "@/modules/billing/sale-fiscal-guard";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { PaymentSettingsService } from "@/modules/payments/payment-settings-service";
import { getTransferWindowMinutes } from "@/modules/payments/transfer-config";
import CheckoutClient from "./checkout-client";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const customer = await getCurrentCustomer();

  // Los datos bancarios se leen con el cliente admin: payment_settings
  // solo tiene policy de lectura para empleados, y acá los necesita un
  // cliente común. Al ser Server Component, nada de esto viaja al
  // navegador más que los cuatro campos que se le muestran.
  const paymentSettings = await new PaymentSettingsService(createAdminClient()).get().catch((err) => {
    console.error("[checkout] No se pudo leer la configuración de pago:", err);
    return null;
  });

  const adminDb = createAdminClient();

  // Datos fiscales guardados (mayoristas y quien ya compró con CUIT): se
  // precargan para no pedirlos en cada compra; la letra se vuelve a
  // decidir consultando el padrón.
  // Pedidos que todavía se van a facturar leyendo el perfil: los que
  // esperan confirmación de pago y los ya pagados cuya factura falló y
  // espera el reintento del cron. Se facturan con la elección fiscal que
  // quede guardada ahora, así que el checkout avisa antes de cambiarla.
  // Ver docs/deuda-tecnica-eleccion-fiscal-web.md.
  const [{ data: fiscalProfile }, threshold, { data: pendingOrders }] = await Promise.all([
    customer
      ? adminDb
          .from("customer_profiles")
          .select("dni, invoice_with_fiscal_data")
          .eq("id", customer.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    readThreshold(adminDb),
    customer
      ? adminDb
          .from("orders")
          .select("id, order_number, status")
          .eq("customer_id", customer.id)
          .in("status", ["pending_payment", "payment_processing", "paid"])
          .order("order_number")
      : Promise.resolve({ data: null }),
  ]);

  // De los pagados, solo cuentan los que no tienen factura autorizada (el
  // mismo criterio que usa el cron bill-unbilled-orders para reintentar).
  const paidIds = (pendingOrders ?? []).filter((o) => o.status === "paid").map((o) => o.id);
  const { data: authorized } = paidIds.length
    ? await adminDb.from("invoices").select("order_id").in("order_id", paidIds).eq("status", "authorized")
    : { data: [] as { order_id: string }[] };
  const billedIds = new Set((authorized ?? []).map((i) => i.order_id));
  const pendingOrderNumbers = (pendingOrders ?? [])
    .filter((o) => o.status !== "paid" || !billedIds.has(o.id))
    .map((o) => o.order_number);

  return (
    <CheckoutClient
      customerCuitDni={customer?.cuitDni ?? null}
      customerDni={fiscalProfile?.dni ?? null}
      invoiceWithFiscalData={fiscalProfile?.invoice_with_fiscal_data ?? false}
      anonymousInvoiceThreshold={threshold}
      pendingOrderNumbers={pendingOrderNumbers}
      bank={{
        alias: paymentSettings?.alias ?? null,
        cbu: paymentSettings?.cbu ?? null,
        accountHolder: paymentSettings?.accountHolder ?? null,
        bankName: paymentSettings?.bankName ?? null,
      }}
      bankConfigured={PaymentSettingsService.isUsable(paymentSettings)}
      transferWindowMinutes={getTransferWindowMinutes()}
    />
  );
}
