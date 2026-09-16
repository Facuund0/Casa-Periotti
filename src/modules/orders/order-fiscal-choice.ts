import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PadronCheckResult } from "@/modules/billing/arca-adapter";
import type { PadronFiscalStatus } from "@/modules/billing/padron-parser";

/**
 * Elección fiscal guardada junto a una venta (migración 0018). La
 * facturación y el envío del comprobante la leen en lugar del perfil del
 * cliente, así un reintento del cron factura y envía exactamente lo que
 * se eligió en la venta.
 */
export interface OrderFiscalChoice {
  orderId: string;
  requestedKind: "final_consumer" | "fiscal_data";
  cuit: string | null;
  dni: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  padronFiscalStatus: PadronFiscalStatus | null;
  padronLegalName: string | null;
}

export async function saveOrderFiscalChoice(
  adminDb: SupabaseClient,
  choice: Omit<OrderFiscalChoice, "padronFiscalStatus" | "padronLegalName"> & {
    padron: PadronCheckResult | null;
    createdBy: string;
  }
): Promise<void> {
  const { error } = await adminDb.from("order_fiscal_choices").insert({
    order_id: choice.orderId,
    requested_kind: choice.requestedKind,
    cuit: choice.cuit,
    dni: choice.dni,
    buyer_name: choice.buyerName,
    buyer_email: choice.buyerEmail,
    padron_fiscal_status: choice.padron?.fiscalStatus ?? null,
    padron_legal_name: choice.padron?.legalName ?? null,
    padron_checked_at: choice.padron ? new Date().toISOString() : null,
    created_by: choice.createdBy,
  });
  if (error) {
    throw new Error(`No se pudo guardar la elección fiscal de la venta: ${error.message}`);
  }
}

/**
 * null si el pedido no tiene elección guardada (compras web). Tira si la
 * consulta falla: facturar con el perfil por un error de lectura sería
 * justamente el bug que esta tabla evita.
 */
export async function getOrderFiscalChoice(
  adminDb: SupabaseClient,
  orderId: string
): Promise<OrderFiscalChoice | null> {
  const { data, error } = await adminDb
    .from("order_fiscal_choices")
    .select("order_id, requested_kind, cuit, dni, buyer_name, buyer_email, padron_fiscal_status, padron_legal_name")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) {
    throw new Error(`No se pudo leer la elección fiscal del pedido ${orderId}: ${error.message}`);
  }
  if (!data) return null;
  return {
    orderId: data.order_id,
    requestedKind: data.requested_kind,
    cuit: data.cuit,
    dni: data.dni,
    buyerName: data.buyer_name,
    buyerEmail: data.buyer_email,
    padronFiscalStatus: data.padron_fiscal_status,
    padronLegalName: data.padron_legal_name,
  };
}
