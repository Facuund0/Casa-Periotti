"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { ProductImportService, type ImportSummary } from "./import-service";

const ROLES_QUE_PUEDEN_IMPORTAR = ["admin", "super_admin", "stock"];

/** 2 MB alcanza para miles de filas y evita subir un archivo equivocado. */
const MAX_BYTES = 2 * 1024 * 1024;

export interface ImportActionResult {
  error?: string;
  summary?: ImportSummary;
}

export async function importProductsAction(formData: FormData): Promise<ImportActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_IMPORTAR.includes(employee.role)) {
    return { error: "Tu rol no tiene permiso para importar productos" };
  }

  const file = formData.get("archivo");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Elegí el archivo CSV y volvé a intentar." };
  }
  if (file.size > MAX_BYTES) {
    return { error: "El archivo es muy grande (máximo 2 MB)." };
  }

  // La simulación es el modo por defecto: solo aplica si el formulario
  // manda explícitamente que NO simule.
  const dryRun = formData.get("dryRun") === "on";

  try {
    const csv = await file.text();
    const summary = await new ProductImportService(createAdminClient(), employee).import(csv, { dryRun });
    if (!dryRun) {
      revalidatePath("/admin/productos");
      revalidatePath("/");
    }
    return { summary };
  } catch (err) {
    console.error("[importProductsAction]", err);
    return { error: err instanceof Error ? err.message : "No se pudo leer el archivo" };
  }
}
