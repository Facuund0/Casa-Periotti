import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BusinessSettingsService } from "./business-settings-service";
import type { PadronCheckResult } from "./arca-adapter";
import { previewFiscalInvoice } from "./buyer-fiscal-check";
import { decideForFinalConsumer } from "./invoice-decision";

/**
 * Validación fiscal ANTES de crear el pedido (checkout web y mostrador).
 * La factura se emite recién después de cobrar; si ahí resultara que el
 * CUIT no sirve o que falta el DNI por el umbral, quedaría una venta
 * cobrada sin factura. Acá se corta cuando todavía no se cobró ni se
 * reservó stock. Solo lee: no crea ni modifica nada.
 */
export type SaleFiscalChoice =
  | { kind: "fiscal_data"; cuit: string | null }
  | { kind: "final_consumer"; dni: string | null };

export async function assertSaleFiscalChoice(
  adminDb: SupabaseClient,
  choice: SaleFiscalChoice,
  sale: { customerId: string | null; items: { productId: string; quantity: number }[] }
): Promise<{ error: string | null; padron: PadronCheckResult | null }> {
  if (choice.kind === "fiscal_data") {
    const { outcome, padron } = await previewFiscalInvoice(adminDb, choice.cuit);
    return { error: outcome.ok ? null : outcome.error, padron };
  }

  const [threshold, total] = await Promise.all([
    readThreshold(adminDb),
    estimateOrderTotal(adminDb, sale.customerId, sale.items),
  ]);
  const outcome = decideForFinalConsumer({ total, threshold, dni: choice.dni });
  return { error: outcome.ok ? null : outcome.error, padron: null };
}

export async function readThreshold(adminDb: SupabaseClient): Promise<number> {
  const settings = await new BusinessSettingsService(adminDb).get();
  if (!settings) throw new Error("No se pudieron leer los datos fiscales (umbral de identificación).");
  return settings.anonymousInvoiceThreshold;
}

/**
 * Total que va a calcular create_order() (migración 0006): precio
 * mayorista solo para mayoristas aprobados, y suma de round(precio ×
 * cantidad, 2). Es solo para decidir si hace falta identificar al
 * comprador; el total que vale es el del pedido.
 */
async function estimateOrderTotal(
  adminDb: SupabaseClient,
  customerId: string | null,
  items: { productId: string; quantity: number }[]
): Promise<number> {
  let customerType = "minorista";
  if (customerId) {
    const { data } = await adminDb
      .from("customer_profiles")
      .select("customer_type")
      .eq("id", customerId)
      .maybeSingle();
    customerType = data?.customer_type ?? "minorista";
  }

  const { data: products, error } = await adminDb
    .from("products")
    .select("id, price_retail, price_wholesale")
    .in(
      "id",
      items.map((i) => i.productId)
    );
  if (error) throw new Error(`No se pudieron leer los precios: ${error.message}`);

  const byId = new Map((products ?? []).map((p) => [p.id, p]));
  return items.reduce((sum, item) => {
    const product = byId.get(item.productId);
    if (!product) return sum;
    const price = Number(customerType === "mayorista" ? product.price_wholesale : product.price_retail);
    return sum + Math.round(price * item.quantity * 100) / 100;
  }, 0);
}
