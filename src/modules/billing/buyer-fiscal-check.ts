import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fiscalIdDigits, isValidCuit } from "@/shared/utils/cuit";
import type { CustomerIvaCondition } from "@/modules/customers/fiscal-rules";
import { ArcaAdapter, type PadronCheckResult } from "./arca-adapter";
import { BusinessSettingsService } from "./business-settings-service";
import { decideForFiscalData, type DecisionOutcome } from "./invoice-decision";
import type { PadronFiscalStatus } from "./padron-parser";

/**
 * Consulta la Constancia de Inscripción con el CUIT del emisor cargado en
 * los datos fiscales. Devuelve null si no se pudo consultar (ARCA sin
 * respuesta, o falta configuración propia): eso nunca es culpa del
 * comprador.
 */
export async function lookupPadron(
  adminDb: SupabaseClient,
  cuit: string
): Promise<PadronCheckResult | null> {
  let arca: ArcaAdapter;
  try {
    const issuer = await new BusinessSettingsService(adminDb).getComplete();
    arca = new ArcaAdapter({ cuit: Number(issuer.cuitDigits) });
  } catch (err) {
    console.error("[buyer-fiscal-check] No se pudo preparar la consulta a ARCA:", err);
    return null;
  }
  return arca.checkTaxpayerCondition(Number(fiscalIdDigits(cuit)));
}

/**
 * Vista previa de "Factura con datos fiscales" ANTES de la venta: qué
 * comprobante va a recibir ese CUIT según el padrón. La usan el checkout
 * y el mostrador, y la vuelven a correr en el servidor antes de crear el
 * pedido: si el CUIT no sirve (inválido, inexistente, cancelado), se
 * corta ahí, cuando todavía no se cobró ni se tocó stock. La emisión
 * vuelve a consultar el padrón con la misma tabla (invoice-decision.ts).
 */
export async function previewFiscalInvoice(
  adminDb: SupabaseClient,
  cuit: string | null | undefined
): Promise<{ outcome: DecisionOutcome; padron: PadronCheckResult | null }> {
  // Un CUIT con el verificador mal ni se consulta.
  if (!isValidCuit(cuit)) return { outcome: decideForFiscalData(cuit, null), padron: null };
  const padron = await lookupPadron(adminDb, cuit as string);
  return { outcome: decideForFiscalData(cuit, padron), padron };
}

/**
 * Condición que se guarda en el perfil, solo informativa (la letra se
 * decide consultando el padrón al emitir). Las categorías que el perfil
 * no tiene (No Alcanzado, No Categorizado, sin verificar) quedan como
 * Consumidor Final, que es como se facturan.
 */
export function profileConditionFor(status: PadronFiscalStatus | null): CustomerIvaCondition {
  switch (status) {
    case "responsable_inscripto":
      return "responsable_inscripto";
    case "monotributo":
      return "monotributista";
    case "exento":
      return "exento";
    default:
      return "consumidor_final";
  }
}

/** Lo que se le muestra al cliente o al empleado antes de confirmar. */
export interface FiscalInvoicePreview {
  letter: "A" | "B";
  legalName: string | null;
  conditionLabel: string;
  legend: string | null;
  reason: string;
  verified: boolean;
}

export function toPreview(outcome: DecisionOutcome): { preview?: FiscalInvoicePreview; error?: string } {
  if (!outcome.ok) return { error: outcome.error };
  const d = outcome.decision;
  return {
    preview: {
      letter: d.letter,
      legalName: d.legalName,
      conditionLabel: d.receptorConditionLabel,
      legend: d.legend,
      reason: d.reason,
      verified: d.verification === "verified",
    },
  };
}
