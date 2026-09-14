"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { CategoryAdminService } from "./category-admin-service";

export interface CategoryActionResult {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
}

const categorySchema = z.object({
  name: z.string().trim().min(2, "El nombre es obligatorio"),
  // Opcional: si viene vacío se genera del nombre (ver slugify).
  slug: z
    .string()
    .trim()
    .max(80)
    .refine((v) => v.length === 0 || /^[a-z0-9-]+$/.test(v), {
      message: "El slug solo puede tener minúsculas, números y guiones",
    })
    .optional(),
  parentId: z
    .string()
    .trim()
    .refine((v) => v.length === 0 || z.string().uuid().safeParse(v).success, {
      message: "Categoría padre inválida",
    })
    .optional(),
  displayOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

function parse(formData: FormData) {
  return categorySchema.safeParse({
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    parentId: String(formData.get("parentId") ?? ""),
    displayOrder: String(formData.get("displayOrder") ?? "0"),
  });
}

function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) fieldErrors[String(issue.path[0])] = issue.message;
  return fieldErrors;
}

/** Las categorías se muestran en el catálogo, así que se invalida también. */
function revalidateCategories() {
  revalidatePath("/admin/categorias");
  revalidatePath("/admin/productos");
  revalidatePath("/");
}

export async function createCategoryAction(formData: FormData): Promise<CategoryActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { error: "No autenticado" };

  const parsed = parse(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  try {
    await new CategoryAdminService(createAdminClient(), employee).create({
      name: parsed.data.name,
      slug: parsed.data.slug,
      parentId: parsed.data.parentId || null,
      displayOrder: parsed.data.displayOrder,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo crear la categoría" };
  }

  revalidateCategories();
  return { ok: true };
}

export async function updateCategoryAction(
  categoryId: string,
  formData: FormData
): Promise<CategoryActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { error: "No autenticado" };

  const id = z.string().uuid().safeParse(categoryId);
  if (!id.success) return { error: "Categoría inválida" };

  const parsed = parse(formData);
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error) };

  try {
    await new CategoryAdminService(createAdminClient(), employee).update(id.data, {
      name: parsed.data.name,
      slug: parsed.data.slug,
      parentId: parsed.data.parentId || null,
      displayOrder: parsed.data.displayOrder,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar la categoría" };
  }

  revalidateCategories();
  return { ok: true };
}

export async function setCategoryActiveAction(
  categoryId: string,
  active: boolean
): Promise<CategoryActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { error: "No autenticado" };

  const id = z.string().uuid().safeParse(categoryId);
  if (!id.success) return { error: "Categoría inválida" };

  try {
    await new CategoryAdminService(createAdminClient(), employee).setActive(id.data, active);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo actualizar la categoría" };
  }

  revalidateCategories();
  return { ok: true };
}

export async function deleteCategoryAction(categoryId: string): Promise<CategoryActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { error: "No autenticado" };

  const id = z.string().uuid().safeParse(categoryId);
  if (!id.success) return { error: "Categoría inválida" };

  try {
    await new CategoryAdminService(createAdminClient(), employee).remove(id.data);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo borrar la categoría" };
  }

  revalidateCategories();
  return { ok: true };
}
