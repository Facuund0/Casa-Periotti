import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CUSTOMER_IVA_CONDITION_LABELS } from "@/modules/customers/fiscal-rules";
import { fiscalIdDigits, formatCuit, isValidCuit } from "@/shared/utils/cuit";
import { ArcaAdapter, type PadronCheckResult } from "./arca-adapter";
import { BusinessSettingsService } from "./business-settings-service";

/**
 * Verificación del comprador de una Factura A ANTES de la venta.
 *
 * Por qué antes: la factura se emite después de cobrar (en la web,
 * cuando un empleado confirma la transferencia; en el mostrador, apenas
 * se registra la venta), y para ese momento el stock ya se descontó. Si
 * recién ahí ARCA rechaza el comprobante por el CUIT, queda una venta
 * cobrada sin factura válida. Verificando antes de crear el pedido, el
 * problema aparece cuando todavía se puede corregir.
 *
 * Qué bloquea y qué no:
 *  - Bloquea lo que ARCA confirma que no sirve: CUIT inválido, CUIT que
 *    no existe, CUIT cancelado, o un CUIT que según ARCA no es
 *    Responsable Inscripto.
 *  - NO bloquea cuando ARCA no se pudo consultar o no informó la
 *    condición: no confirma que esté mal, y frenar ventas cada vez que
 *    ARCA no responde sería peor. En esos casos se vuelve a verificar al
 *    facturar, como siempre. (En homologación los CUIT de prueba vienen
 *    todos "sin condición informada", así que por acá pasan.)
 */
export type FacturaABuyerCheck =
  | { ok: true; verified: boolean; warning: string | null }
  | { ok: false; error: string };

// Observaciones de ARCA que significan que el CUIT no puede recibir un
// comprobante. Hoy la única inequívoca es la cancelación.
const BLOCKING_ARCA_MESSAGE = /cancelad/i;

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

export async function checkBuyerForFacturaA(
  adminDb: SupabaseClient,
  cuit: string | null | undefined
): Promise<FacturaABuyerCheck> {
  if (!isValidCuit(cuit)) {
    return {
      ok: false,
      error: "El CUIT no es válido: revisá los 11 dígitos (el último es un dígito verificador).",
    };
  }

  const shown = formatCuit(cuit);
  const padron = await lookupPadron(adminDb, cuit as string);

  if (!padron) {
    return {
      ok: true,
      verified: false,
      warning: "No se pudo consultar ARCA en este momento; el CUIT se vuelve a verificar al facturar.",
    };
  }

  if (!padron.found) {
    return {
      ok: false,
      error: `ARCA no tiene registrado el CUIT ${shown}. Revisalo: con un CUIT inexistente no se puede emitir Factura A.`,
    };
  }

  const blocking = padron.messages.find((m) => BLOCKING_ARCA_MESSAGE.test(m));
  if (blocking) {
    return {
      ok: false,
      error: `ARCA informa sobre el CUIT ${shown}: ${cleanMessage(blocking)}. Con ese CUIT no se puede emitir Factura A.`,
    };
  }

  if (padron.ivaCondition === "responsable_inscripto") {
    return { ok: true, verified: true, warning: null };
  }

  if (padron.ivaCondition === null) {
    const detail = padron.messages.length
      ? ` (${padron.messages.map(cleanMessage).join(" / ")})`
      : "";
    return {
      ok: true,
      verified: false,
      warning: `ARCA no informó la condición de IVA de este CUIT${detail}; se vuelve a verificar al facturar.`,
    };
  }

  return {
    ok: false,
    error: `Según ARCA, el CUIT ${shown} figura como ${
      CUSTOMER_IVA_CONDITION_LABELS[padron.ivaCondition]
    }, no como Responsable Inscripto, así que no corresponde Factura A.`,
  };
}

/** ARCA termina sus mensajes con punto; se saca para no duplicarlo al citarlo. */
export function cleanMessage(message: string): string {
  return message.replace(/[.\s]+$/, "");
}
