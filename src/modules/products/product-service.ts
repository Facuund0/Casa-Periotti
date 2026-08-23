import type { SupabaseClient } from "@supabase/supabase-js";
import { ProductRepository } from "./product-repository";
import { getPriceForCustomerType, type CustomerType, type Product } from "./types";

export interface ProductWithDisplayPrice extends Product {
  displayPrice: number;
}

export class ProductService {
  private readonly repository: ProductRepository;

  constructor(db: SupabaseClient) {
    this.repository = new ProductRepository(db);
  }

  /**
   * Devuelve el catálogo con el precio que corresponde mostrar
   * según el tipo de cliente logueado (o minorista por defecto
   * si no hay sesión).
   */
  async getCatalog(
    customerType: CustomerType = "minorista",
    categorySlug?: string
  ): Promise<ProductWithDisplayPrice[]> {
    const products = await this.repository.findActiveByCategory(categorySlug);
    return products.map((p) => ({
      ...p,
      displayPrice: getPriceForCustomerType(p, customerType),
    }));
  }

  async getProductDetail(
    slug: string,
    customerType: CustomerType = "minorista"
  ): Promise<ProductWithDisplayPrice | null> {
    const product = await this.repository.findBySlug(slug);
    if (!product) return null;
    return { ...product, displayPrice: getPriceForCustomerType(product, customerType) };
  }

  async getCategories() {
    return this.repository.listCategories();
  }
}
