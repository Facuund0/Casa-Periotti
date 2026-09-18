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
  /** Cantidad mínima de este producto para el precio mayorista (1 = sin mínimo). */
  wholesaleMinQuantity: number;
  /** Costo sin IVA, como viene del proveedor. null = no cargado. */
  costNet: number | null;
  /** Código de barras del envase, el que lee el escáner. */
  barcode: string | null;
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
 * Precio de UNA unidad según tipo de cliente, para el catálogo: el
 * mayorista aprobado ve el precio mayorista solo si el producto no tiene
 * mínimo; si lo tiene, una unidad sale a precio minorista (ver
 * wholesale-pricing.ts, misma regla que create_order). SIEMPRE se
 * recalcula en el backend al confirmar un pedido — nunca se confía en un
 * precio que venga del frontend.
 */
export function getPriceForCustomerType(
  product: Pick<Product, "priceRetail" | "priceWholesale" | "wholesaleMinQuantity">,
  customerType: CustomerType
): number {
  // mayorista_pendiente todavía no tiene aprobado el precio mayorista
  return customerType === "mayorista" && (product.wholesaleMinQuantity ?? 1) <= 1
    ? product.priceWholesale
    : product.priceRetail;
}
