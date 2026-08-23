import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProductInput } from "./schemas";

const ROLES_QUE_PUEDEN_EDITAR_PRODUCTOS = ["admin", "super_admin", "stock"] as const;

export class UnauthorizedError extends Error {
  constructor(message = "No tenés permiso para realizar esta acción") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Todas las escrituras de productos pasan por acá. Aunque la base de
 * datos también tiene RLS que bloquea esto (defensa en profundidad),
 * este service es el que da el mensaje de error claro y registra
 * auditoría — nunca hay que confiar en que "ya está protegido por RLS"
 * como única barrera.
 */
export class ProductAdminService {
  constructor(
    private readonly adminDb: SupabaseClient,
    private readonly employee: { id: string; role: string }
  ) {}

  private assertCanEdit() {
    if (!ROLES_QUE_PUEDEN_EDITAR_PRODUCTOS.includes(this.employee.role as never)) {
      throw new UnauthorizedError("Tu rol no tiene permiso para editar productos");
    }
  }

  async create(input: ProductInput) {
    this.assertCanEdit();

    const { data, error } = await this.adminDb
      .from("products")
      .insert({
        sku: input.sku,
        name: input.name,
        slug: input.slug,
        description: input.description || null,
        brand: input.brand || null,
        category_id: input.categoryId,
        price_retail: input.priceRetail,
        price_wholesale: input.priceWholesale,
        vat_rate: input.vatRate,
        unit: input.unit,
        stock_minimum: input.stockMinimum,
        stock_quantity: 0, // el stock inicial se carga como movimiento aparte, con trazabilidad
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new Error("Ya existe un producto con ese SKU o slug");
      }
      throw new Error(`No se pudo crear el producto: ${error.message}`);
    }

    await this.audit("create", data.id, null, input);
    return data.id as string;
  }

  async update(productId: string, input: ProductInput) {
    this.assertCanEdit();

    const { data: before } = await this.adminDb
      .from("products")
      .select("*")
      .eq("id", productId)
      .single();

    const { error } = await this.adminDb
      .from("products")
      .update({
        sku: input.sku,
        name: input.name,
        slug: input.slug,
        description: input.description || null,
        brand: input.brand || null,
        category_id: input.categoryId,
        price_retail: input.priceRetail,
        price_wholesale: input.priceWholesale,
        vat_rate: input.vatRate,
        unit: input.unit,
        stock_minimum: input.stockMinimum,
      })
      .eq("id", productId);

    if (error) throw new Error(`No se pudo actualizar el producto: ${error.message}`);

    await this.audit("update", productId, before, input);
  }

  /** Nunca se borra un producto físicamente si tuvo ventas. Se desactiva. */
  async deactivate(productId: string) {
    this.assertCanEdit();
    const { error } = await this.adminDb
      .from("products")
      .update({ active: false })
      .eq("id", productId);
    if (error) throw new Error(`No se pudo desactivar el producto: ${error.message}`);
    await this.audit("deactivate", productId, null, null);
  }

  async reactivate(productId: string) {
    this.assertCanEdit();
    const { error } = await this.adminDb
      .from("products")
      .update({ active: true })
      .eq("id", productId);
    if (error) throw new Error(`No se pudo reactivar el producto: ${error.message}`);
    await this.audit("reactivate", productId, null, null);
  }

  private async audit(
    action: string,
    entityId: string,
    before: unknown,
    after: unknown
  ) {
    await this.adminDb.from("audit_logs").insert({
      user_id: this.employee.id,
      action,
      entity_type: "product",
      entity_id: entityId,
      data_before: before,
      data_after: after,
    });
  }
}
