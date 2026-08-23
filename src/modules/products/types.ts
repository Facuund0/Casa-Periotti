export type CustomerType = "minorista" | "mayorista" | "mayorista_pendiente";

export interface Product {
  id: string;
  sku: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  categoryId: string | null;
  priceRetail: number;
  priceWholesale: number;
  vatRate: number;
  unit: string;
  stockQuantity: number;
  stockReserved: number;
  stockMinimum: number;
  active: boolean;
  images: ProductImage[];
}

export interface ProductImage {
  id: string;
  storagePath: string;
  altText: string | null;
  displayOrder: number;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  displayOrder: number;
}

/**
 * Devuelve stock realmente disponible para vender
 * (lo que hay en depósito menos lo reservado en checkouts en curso).
 */
export function getAvailableStock(product: Pick<Product, "stockQuantity" | "stockReserved">): number {
  return product.stockQuantity - product.stockReserved;
}

/**
 * Precio según tipo de cliente. SIEMPRE se recalcula en el backend
 * al momento de confirmar un pedido — nunca se confía en un precio
 * que venga del frontend.
 */
export function getPriceForCustomerType(
  product: Pick<Product, "priceRetail" | "priceWholesale">,
  customerType: CustomerType
): number {
  // mayorista_pendiente todavía no tiene aprobado el precio mayorista
  return customerType === "mayorista" ? product.priceWholesale : product.priceRetail;
}
