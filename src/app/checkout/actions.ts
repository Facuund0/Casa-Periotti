"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/infrastructure/database/supabase-server";
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
