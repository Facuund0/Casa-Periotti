import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product, Category } from "./types";

/**
 * Repository Pattern: esta es la ÚNICA capa que sabe cómo están
 * estructuradas las tablas en Supabase. El resto de la app (páginas,
 * componentes, otros services) nunca escribe queries SQL directas,
 * siempre pasa por acá. Si el día de mañana cambia el esquema, solo
 * se toca este archivo.
 */
export class ProductRepository {
  constructor(private readonly db: SupabaseClient) {}

  async findActiveByCategory(categorySlug?: string): Promise<Product[]> {
    let query = this.db
      .from("products")
      .select(
        `id, sku, name, slug, description, brand, category_id,
         price_retail, price_wholesale, vat_rate, unit,
         stock_quantity, stock_reserved, stock_minimum, active,
         product_images ( id, storage_path, alt_text, display_order ),
         categories!inner ( slug )`
      )
      .eq("active", true)
      .order("name");

    if (categorySlug) {
      query = query.eq("categories.slug", categorySlug);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Error al buscar productos: ${error.message}`);

    return (data ?? []).map(mapProductRow);
  }

  async findBySlug(slug: string): Promise<Product | null> {
    const { data, error } = await this.db
      .from("products")
      .select(
        `id, sku, name, slug, description, brand, category_id,
         price_retail, price_wholesale, vat_rate, unit,
         stock_quantity, stock_reserved, stock_minimum, active,
         product_images ( id, storage_path, alt_text, display_order )`
      )
      .eq("slug", slug)
      .eq("active", true)
      .maybeSingle();

    if (error) throw new Error(`Error al buscar producto: ${error.message}`);
    return data ? mapProductRow(data) : null;
  }

  async findManyByIds(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    const { data, error } = await this.db
      .from("products")
      .select(
        `id, sku, name, slug, description, brand, category_id,
         price_retail, price_wholesale, vat_rate, unit,
         stock_quantity, stock_reserved, stock_minimum, active,
         product_images ( id, storage_path, alt_text, display_order )`
      )
      .in("id", ids);

    if (error) throw new Error(`Error al buscar productos: ${error.message}`);
    return (data ?? []).map(mapProductRow);
  }

  async listCategories(): Promise<Category[]> {
    const { data, error } = await this.db
      .from("categories")
      .select("id, name, slug, parent_id, display_order")
      .eq("active", true)
      .order("display_order");

    if (error) throw new Error(`Error al buscar categorías: ${error.message}`);
    return (data ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      parentId: c.parent_id,
      displayOrder: c.display_order,
    }));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapProductRow(row: any): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    slug: row.slug,
    description: row.description,
    brand: row.brand,
    categoryId: row.category_id,
    priceRetail: Number(row.price_retail),
    priceWholesale: Number(row.price_wholesale),
    vatRate: Number(row.vat_rate),
    unit: row.unit,
    stockQuantity: row.stock_quantity,
    stockReserved: row.stock_reserved,
    stockMinimum: row.stock_minimum,
    active: row.active,
    images: (row.product_images ?? [])
      .sort((a: { display_order: number }, b: { display_order: number }) => a.display_order - b.display_order)
      .map((img: { id: string; storage_path: string; alt_text: string | null; display_order: number }) => ({
        id: img.id,
        storagePath: img.storage_path,
        altText: img.alt_text,
        displayOrder: img.display_order,
      })),
  };
}
