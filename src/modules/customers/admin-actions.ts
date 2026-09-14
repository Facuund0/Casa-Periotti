"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { CustomerFiscalService } from "./customer-fiscal-service";
import type { CustomerIvaCondition } from "./fiscal-rules";

export interface CustomerFiscalActionResult {
  error?: string;
  ok?: boolean;
  cuitDni?: string | null;
  ivaCondition?: CustomerIvaCondition;
}

/**
 * Corrige el CUIT/DNI y la condición de IVA de un cliente. Lo usa el
 * editor de /admin/clientes cuando alguien cargó mal sus datos en el
 * checkout. La validación completa la hace CustomerFiscalService con las
 * mismas reglas que el checkout.
 */
export async function updateCustomerFiscalDataAction(
  customerId: string,
  formData: FormData
): Promise<CustomerFiscalActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { error: "No autenticado" };

  const id = z.string().uuid().safeParse(customerId);
  if (!id.success) return { error: "Cliente inválido" };

  try {
    const saved = await new CustomerFiscalService(createAdminClient(), employee).updateFiscalData(
      id.data,
      {
        cuitDni: String(formData.get("cuitDni") ?? ""),
        ivaCondition: String(formData.get("ivaCondition") ?? ""),
      }
    );

    revalidatePath("/admin/clientes");
    return { ok: true, cuitDni: saved.cuitDni, ivaCondition: saved.ivaCondition };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudieron guardar los datos" };
  }
}
