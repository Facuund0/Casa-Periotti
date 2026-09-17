"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { EmailService } from "@/modules/emails/email-service";
import { getRequestOrigin } from "@/modules/auth/site-url";
import { createClient } from "@/infrastructure/database/supabase-server";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { TransferPaymentService } from "@/modules/payments/transfer-payment-service";
import { uploadReceiptSchema } from "@/modules/payments/schemas";
import { z } from "zod";
import { normalizeFiscalId } from "@/modules/customers/fiscal-rules";
import { isPlausibleDni } from "@/shared/utils/cuit";
import {
  previewFiscalInvoice,
  profileConditionFor,
  toPreview,
  type FiscalInvoicePreview,
} from "@/modules/billing/buyer-fiscal-check";

const cuitSchema = z.string().trim().max(20);

const invoicePreferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fiscal_data"), cuit: cuitSchema }),
  z.object({
    kind: z.literal("final_consumer"),
    dni: z
      .string()
      .trim()
      .max(12)
      .optional()
      .refine((v) => !v || isPlausibleDni(v), { message: "El DNI tiene que tener 7 u 8 dígitos." }),
  }),
]);

export interface FiscalPreviewResult {
  preview?: FiscalInvoicePreview;
  error?: string;
}

/**
 * Vista previa de "Factura con datos fiscales": con el CUIT se consulta
 * el padrón y se le muestra al cliente, antes de confirmar, qué
 * comprobante va a recibir y por qué. Solo lee.
 */
export async function previewFiscalInvoiceAction(cuit: string): Promise<FiscalPreviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Necesitás iniciar sesión" };

  const parsed = cuitSchema.safeParse(cuit);
  if (!parsed.success) return { error: "Ingresá un CUIT válido" };

  const { outcome } = await previewFiscalInvoice(createAdminClient(), parsed.data);
  return toPreview(outcome);
}

export interface SaveInvoicePreferenceResult {
  error?: string;
  ok?: boolean;
}

/**
 * Guarda en el perfil la elección de ESTA compra, justo antes de crear el
 * pedido: la facturación la lee de ahí cuando se confirma el pago. Se
 * guarda siempre, así una compra como Consumidor Final no hereda la
 * elección de una compra anterior con datos fiscales. El CUIT queda
 * guardado para precargarlo la próxima vez.
 *
 * Usa el cliente normal (RLS): la policy "Cliente edita su propio perfil"
 * de customer_profiles ya permite auth.uid() = id.
 */
export async function saveInvoicePreferenceAction(
  input: unknown
): Promise<SaveInvoicePreferenceResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Necesitás iniciar sesión" };

  const parsed = invoicePreferenceSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  let update: Record<string, unknown>;
  if (parsed.data.kind === "fiscal_data") {
    // Se vuelve a consultar acá: la validación del navegador es una
    // comodidad, no una garantía. Un CUIT que no sirve no se guarda.
    const { outcome, padron } = await previewFiscalInvoice(createAdminClient(), parsed.data.cuit);
    if (!outcome.ok) return { error: outcome.error };
    update = {
      invoice_with_fiscal_data: true,
      cuit_dni: normalizeFiscalId(parsed.data.cuit),
      iva_condition: profileConditionFor(
        outcome.decision.verification === "verified" ? padron?.fiscalStatus ?? null : null
      ),
    };
  } else {
    update = {
      invoice_with_fiscal_data: false,
      ...(parsed.data.dni ? { dni: normalizeFiscalId(parsed.data.dni) } : {}),
    };
  }

  const { error } = await supabase.from("customer_profiles").update(update).eq("id", user.id);
  if (error) {
    return { error: `No se pudieron guardar tus datos fiscales: ${error.message}` };
  }

  return { ok: true };
}

export interface UploadTransferReceiptResult {
  error?: string;
  ok?: boolean;
}

/**
 * El cliente sube el comprobante de su transferencia. La subida a
 * Storage y el registro van con el cliente admin (service role) porque
 * el bucket es privado y no tiene policies para clientes — pero antes
 * TransferPaymentService valida que el pedido sea de quien sube, que
 * esté en un estado pagable, que no se haya vencido el plazo, y que el
 * archivo sea del tipo y tamaño permitidos. Nunca se confía en la
 * validación que ya hizo el navegador.
 */
export async function uploadTransferReceiptAction(
  formData: FormData
): Promise<UploadTransferReceiptResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Necesitás iniciar sesión" };

  const parsed = uploadReceiptSchema.safeParse({ orderId: formData.get("orderId") });
  if (!parsed.success) return { error: "Pedido inválido" };

  const receipt = formData.get("receipt");
  if (!(receipt instanceof File)) {
    return { error: "No llegó ningún archivo. Elegí el comprobante e intentá de nuevo." };
  }

  try {
    await new TransferPaymentService(createAdminClient()).registerReceipt({
      orderId: parsed.data.orderId,
      customerId: user.id,
      file: receipt,
    });
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "No pudimos registrar el comprobante",
    };
  }

  // Aviso al local: hay un pedido esperando que verifiquen la
  // transferencia. Sale después de responder, así el cliente no espera al
  // mail; si falla, queda registrado y no afecta el comprobante.
  const orderId = parsed.data.orderId;
  const panelUrl = `${await getRequestOrigin()}/admin/pedidos`;
  after(async () => {
    try {
      await new EmailService(createAdminClient()).notifyInternalOrderToConfirm(orderId, panelUrl);
    } catch (err) {
      console.error(`[uploadTransferReceiptAction] No se pudo avisar el pedido ${orderId}:`, err);
    }
  });

  revalidatePath(`/pedido/${parsed.data.orderId}`);
  return { ok: true };
}
