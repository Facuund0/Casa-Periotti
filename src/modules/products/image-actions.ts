"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { ProductImageService, type ProductImageRow } from "./product-image-service";

export interface ProductImageActionResult {
  error?: string;
  ok?: boolean;
  image?: ProductImageRow;
}

const uuid = z.string().uuid();

/**
 * Las páginas del catálogo son dinámicas, pero se invalidan igual para
 * que el cambio se vea sin esperar: el empleado sube una foto y quiere
 * confirmar que aparece.
 */
function revalidateCatalog(productSlug?: string) {
  revalidatePath("/admin/productos");
  revalidatePath("/");
  if (productSlug) revalidatePath(`/producto/${productSlug}`);
}

export async function uploadProductImageAction(
  formData: FormData
): Promise<ProductImageActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { error: "No autenticado" };

  const productId = uuid.safeParse(formData.get("productId"));
  if (!productId.success) return { error: "Producto inválido" };

  const file = formData.get("image");
  if (!(file instanceof File)) return { error: "No llegó ninguna imagen" };

  const altText = formData.get("altText");

  try {
    const image = await new ProductImageService(createAdminClient(), employee).upload({
      productId: productId.data,
      file,
      altText: typeof altText === "string" ? altText : null,
    });

    revalidateCatalog();
    return { ok: true, image };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo subir la imagen" };
  }
}

export async function deleteProductImageAction(
  imageId: string
): Promise<ProductImageActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { error: "No autenticado" };

  const parsed = uuid.safeParse(imageId);
  if (!parsed.success) return { error: "Imagen inválida" };

  try {
    await new ProductImageService(createAdminClient(), employee).remove(parsed.data);
    revalidateCatalog();
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo borrar la imagen" };
  }
}

export async function reorderProductImagesAction(
  productId: string,
  orderedImageIds: string[]
): Promise<ProductImageActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { error: "No autenticado" };

  const parsed = z
    .object({ productId: uuid, orderedImageIds: z.array(uuid).max(50) })
    .safeParse({ productId, orderedImageIds });
  if (!parsed.success) return { error: "Datos inválidos" };

  try {
    await new ProductImageService(createAdminClient(), employee).reorder(
      parsed.data.productId,
      parsed.data.orderedImageIds
    );
    revalidateCatalog();
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudieron reordenar las imágenes" };
  }
}
