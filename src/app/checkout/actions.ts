"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/infrastructure/database/supabase-server";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { TransferPaymentService } from "@/modules/payments/transfer-payment-service";
import { uploadReceiptSchema } from "@/modules/payments/schemas";
import { z } from "zod";

const IVA_CONDITIONS = [
  "consumidor_final",
  "responsable_inscripto",
  "monotributista",
  "exento",
] as const;

const updateFiscalDataSchema = z.object({
  cuitDni: z.string().trim().min(7, "Ingresá un CUIT o DNI válido"),
  ivaCondition: z.enum(IVA_CONDITIONS),
});

export interface UpdateFiscalDataResult {
  error?: string;
  ok?: boolean;
}

/**
 * El cliente logueado guarda sus propios datos fiscales (CUIT/DNI +
 * condición de IVA) antes de pagar — así la factura de esta compra sale
 * bien Y la próxima compra ya viene precargada. Usa el cliente normal
 * (RLS), no el admin: la policy "Cliente edita su propio perfil" de
 * customer_profiles ya permite auth.uid() = id.
 */
export async function updateFiscalDataAction(formData: FormData): Promise<UpdateFiscalDataResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Necesitás iniciar sesión" };

  const parsed = updateFiscalDataSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const { error } = await supabase
    .from("customer_profiles")
    .update({
      cuit_dni: parsed.data.cuitDni,
      iva_condition: parsed.data.ivaCondition,
    })
    .eq("id", user.id);

  if (error) {
    return { error: `No se pudieron guardar tus datos fiscales: ${error.message}` };
  }

  revalidatePath("/checkout");
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

  revalidatePath(`/pedido/${parsed.data.orderId}`);
  return { ok: true };
}
