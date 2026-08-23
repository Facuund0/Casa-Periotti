import { getCurrentCustomer } from "@/modules/auth/current-user";
import { ArcaAdapter } from "@/modules/billing/arca-adapter";
import CheckoutClient from "./checkout-client";

export const dynamic = "force-dynamic";

const ANONYMOUS_INVOICE_THRESHOLD = Number(process.env.ARCA_ANONYMOUS_INVOICE_THRESHOLD || 10_000_000);

export default async function CheckoutPage() {
  const customer = await getCurrentCustomer();

  // Mayoristas ya tienen CUIT cargado (se lo pedimos al aprobar la
  // cuenta mayorista) — se consulta el padrón proactivamente para
  // sugerirles Factura A si corresponde, en vez de esperar a que la
  // pidan ellos mismos.
  let suggestFacturaA = false;
  if (customer?.customerType === "mayorista" && customer.cuitDni) {
    const digits = customer.cuitDni.replace(/\D/g, "");
    if (digits.length === 11) {
      try {
        const arca = new ArcaAdapter();
        const padron = await arca.checkTaxpayerCondition(Number(digits));
        suggestFacturaA = padron?.found === true && padron.ivaCondition === "responsable_inscripto";
      } catch (err) {
        // Nunca bloquear el checkout por esto — es solo una sugerencia.
        console.error("[checkout] No se pudo consultar el padrón para sugerir Factura A:", err);
      }
    }
  }

  return (
    <CheckoutClient
      customerEmail={customer?.email}
      customerCuitDni={customer?.cuitDni ?? null}
      customerIvaCondition={customer?.ivaCondition ?? "consumidor_final"}
      suggestFacturaA={suggestFacturaA}
      anonymousInvoiceThreshold={ANONYMOUS_INVOICE_THRESHOLD}
    />
  );
}
