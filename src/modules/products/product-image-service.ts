import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import {
  PRODUCT_IMAGE_BUCKET,
  PRODUCT_IMAGE_MAX_PER_PRODUCT,
  validateProductImageFile,
} from "./image-config";

export class InvalidProductImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProductImageError";
  }
}

export class TooManyProductImagesError extends Error {
  constructor() {
    super(
      `Este producto ya tiene ${PRODUCT_IMAGE_MAX_PER_PRODUCT} imágenes. Borrá alguna antes de subir otra.`
    );
    this.name = "TooManyProductImagesError";
  }
}

export interface ProductImageRow {
  id: string;
  storagePath: string;
  altText: string | null;
  displayOrder: number;
}

const ROLES_QUE_PUEDEN_EDITAR_PRODUCTOS = ["admin", "super_admin", "stock"] as const;

export class UnauthorizedError extends Error {
  constructor(message = "Tu rol no tiene permiso para editar imágenes de productos") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Imágenes del catálogo. El archivo vive en el bucket PÚBLICO
 * 'productos' y la fila en product_images guarda la referencia y el
 * orden en que se muestran.
 *
 * Los mismos roles que pueden editar un producto pueden editar sus
 * imágenes (admin, super_admin y stock), igual que ProductAdminService.
 */
export class ProductImageService {
  constructor(
    private readonly adminDb: SupabaseClient,
    private readonly employee: { id: string; role: string }
  ) {}

  private assertCanEdit() {
    if (!ROLES_QUE_PUEDEN_EDITAR_PRODUCTOS.includes(this.employee.role as never)) {
      throw new UnauthorizedError();
    }
  }

  async list(productId: string): Promise<ProductImageRow[]> {
    const { data, error } = await this.adminDb
      .from("product_images")
      .select("id, storage_path, alt_text, display_order")
      .eq("product_id", productId)
      .order("display_order");

    if (error) throw new Error(`No se pudieron leer las imágenes: ${error.message}`);

    return (data ?? []).map((row) => ({
      id: row.id,
      storagePath: row.storage_path,
      altText: row.alt_text,
      displayOrder: row.display_order,
    }));
  }

  /**
   * Sube una imagen ya convertida por el navegador y la agrega al final
   * del orden. Valida de nuevo tipo y tamaño acá: la conversión del
   * cliente es una optimización, no una garantía.
   */
  async upload(params: { productId: string; file: File; altText?: string | null }): Promise<ProductImageRow> {
    this.assertCanEdit();

    const { data: product } = await this.adminDb
      .from("products")
      .select("id")
      .eq("id", params.productId)
      .maybeSingle();
    if (!product) throw new Error("El producto no existe");

    const fileError = validateProductImageFile({ type: params.file.type, size: params.file.size });
    if (fileError) throw new InvalidProductImageError(fileError);

    const existing = await this.list(params.productId);
    if (existing.length >= PRODUCT_IMAGE_MAX_PER_PRODUCT) {
      throw new TooManyProductImagesError();
    }

    const extension = params.file.type === "image/webp" ? "webp" : params.file.type === "image/png" ? "png" : "jpg";
    const storagePath = `${params.productId}/${randomUUID()}.${extension}`;

    const { error: uploadError } = await this.adminDb.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .upload(storagePath, params.file, { contentType: params.file.type, upsert: false });

    if (uploadError) {
      throw new Error(`No se pudo subir la imagen: ${uploadError.message}`);
    }

    const nextOrder = existing.length
      ? Math.max(...existing.map((img) => img.displayOrder)) + 1
      : 0;

    const { data: inserted, error: insertError } = await this.adminDb
      .from("product_images")
      .insert({
        product_id: params.productId,
        storage_path: storagePath,
        alt_text: params.altText?.trim() || null,
        display_order: nextOrder,
      })
      .select("id, storage_path, alt_text, display_order")
      .single();

    if (insertError) {
      // La fila no se creó: se borra el archivo para no dejar basura
      // suelta en el bucket que nada referencie.
      await this.adminDb.storage.from(PRODUCT_IMAGE_BUCKET).remove([storagePath]);
      throw new Error(`No se pudo registrar la imagen: ${insertError.message}`);
    }

    await this.audit("upload_product_image", params.productId, {
      image_id: inserted.id,
      storage_path: storagePath,
      size: params.file.size,
      mime: params.file.type,
    });

    return {
      id: inserted.id,
      storagePath: inserted.storage_path,
      altText: inserted.alt_text,
      displayOrder: inserted.display_order,
    };
  }

  /**
   * Borra la imagen: acá sí se borra el archivo Y la fila. A diferencia
   * de un comprobante de pago, la foto de un producto no es respaldo de
   * ninguna operación, así que no hay nada que conservar (el registro
   * de quién la borró queda en audit_logs).
   */
  async remove(imageId: string): Promise<void> {
    this.assertCanEdit();

    const { data: image } = await this.adminDb
      .from("product_images")
      .select("id, product_id, storage_path")
      .eq("id", imageId)
      .maybeSingle();

    if (!image) throw new Error("La imagen no existe");

    const { error: removeError } = await this.adminDb.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .remove([image.storage_path]);

    if (removeError) {
      throw new Error(`No se pudo borrar el archivo de la imagen: ${removeError.message}`);
    }

    const { error: deleteError } = await this.adminDb
      .from("product_images")
      .delete()
      .eq("id", imageId);

    if (deleteError) {
      throw new Error(`No se pudo borrar la imagen: ${deleteError.message}`);
    }

    await this.audit("delete_product_image", image.product_id, {
      image_id: imageId,
      storage_path: image.storage_path,
    });
  }

  /**
   * Reordena las imágenes de un producto. Recibe los ids en el orden
   * deseado y reescribe display_order de todas — así el orden queda
   * consistente aunque hubiera huecos o repetidos de antes.
   */
  async reorder(productId: string, orderedImageIds: string[]): Promise<void> {
    this.assertCanEdit();

    const existing = await this.list(productId);
    const existingIds = new Set(existing.map((img) => img.id));

    // Solo se aceptan ids que realmente sean de este producto: así una
    // petición armada a mano no puede reordenar imágenes de otro.
    const ids = orderedImageIds.filter((id) => existingIds.has(id));
    if (ids.length !== existing.length) {
      throw new Error("La lista de imágenes no coincide con las del producto");
    }

    for (const [index, id] of ids.entries()) {
      const { error } = await this.adminDb
        .from("product_images")
        .update({ display_order: index })
        .eq("id", id);
      if (error) throw new Error(`No se pudo reordenar las imágenes: ${error.message}`);
    }

    await this.audit("reorder_product_images", productId, { order: ids });
  }

  private async audit(action: string, productId: string, data: unknown) {
    await this.adminDb.from("audit_logs").insert({
      user_id: this.employee.id,
      action,
      entity_type: "product",
      entity_id: productId,
      data_after: data,
    });
  }
}
