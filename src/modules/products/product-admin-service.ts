import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { grossFromNet, netFromGross } from "./pricing";
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
        // Se guarda el precio FINAL con IVA, como venía siendo: el
        // formulario carga el neto y la conversión pasa por acá. Ver
        // pricing.ts — de este formato depende create_order() y toda
        // la facturación, así que no cambia.
        price_retail: grossFromNet(input.priceRetailNet, input.vatRate),
        price_wholesale: grossFromNet(input.priceWholesaleNet, input.vatRate),
        vat_rate: input.vatRate,
        unit: input.unit,
        stock_minimum: input.stockMinimum,
        wholesale_min_quantity: input.wholesaleMinQuantity,
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

    if (!before) throw new Error("El producto no existe");

    const { error } = await this.adminDb
      .from("products")
      .update({
        sku: input.sku,
        name: input.name,
        slug: input.slug,
        description: input.description || null,
        brand: input.brand || null,
        category_id: input.categoryId,
        // Se guarda el precio FINAL con IVA, como venía siendo: el
        // formulario carga el neto y la conversión pasa por acá. Ver
        // pricing.ts — de este formato depende create_order() y toda
        // la facturación, así que no cambia.
        price_retail: this.resolveStoredPrice(
          input.priceRetailNet,
          Number(before.price_retail),
          Number(before.vat_rate),
          input.vatRate
        ),
        price_wholesale: this.resolveStoredPrice(
          input.priceWholesaleNet,
          Number(before.price_wholesale),
          Number(before.vat_rate),
          input.vatRate
        ),
        vat_rate: input.vatRate,
        unit: input.unit,
        stock_minimum: input.stockMinimum,
        wholesale_min_quantity: input.wholesaleMinQuantity,
      })
      .eq("id", productId);

    if (error) throw new Error(`No se pudo actualizar el producto: ${error.message}`);

    await this.audit("update", productId, before, input);
  }

  /**
   * Precio final a guardar al editar.
   *
   * El ida y vuelta entre neto y precio final NO siempre es exacto:
   * un producto guardado en $100 con 21% da un neto de $82,64, y ese
   * neto vuelve a dar $99,99. Si se recalculara siempre, editar el
   * nombre de un producto le movería el precio un centavo sin que
   * nadie lo pida — verificado sobre los precios reales, le pasaba a 3
   * de cada 8.
   *
   * Por eso: si el neto que llega del formulario es exactamente el que
   * se le mostró (el derivado del precio guardado) y la alícuota no
   * cambió, se deja el precio guardado intacto. Si el empleado escribe
   * otro neto, o cambia el IVA, ahí sí se recalcula.
   */
  private resolveStoredPrice(
    submittedNet: number,
    storedGross: number,
    storedVatRate: number,
    submittedVatRate: number
  ): number {
    const unchanged =
      submittedVatRate === storedVatRate &&
      submittedNet === netFromGross(storedGross, storedVatRate);

    return unchanged ? storedGross : grossFromNet(submittedNet, submittedVatRate);
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
