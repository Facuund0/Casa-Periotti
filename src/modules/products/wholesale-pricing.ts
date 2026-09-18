import type { CustomerType } from "./types";

/**
 * Regla del precio mayorista, la misma que aplica create_order
 * (migración 0019). Este archivo NO decide lo que se cobra: el precio
 * definitivo lo calcula siempre la base al crear el pedido. Sirve para
 * mostrar en el carrito, el checkout y el mostrador exactamente lo que
 * esa función va a cobrar, y para estimar el total antes de cobrar.
 *
 * Un renglón va a precio mayorista solo si el cliente es mayorista
 * aprobado, eligió precio mayorista, y la cantidad de ESE producto llega
 * a su mínimo. El mínimo es por producto, no por el total del carrito.
 *
 * Sin dependencias de servidor: lo usan el navegador y el servidor.
 */

export type PricePreference = "mayorista" | "minorista";

export const PRICE_PREFERENCE_LABELS: Record<PricePreference, string> = {
  mayorista: "Precio mayorista",
  minorista: "Precio minorista",
};

export interface WholesalePricedProduct {
  priceRetail: number;
  priceWholesale: number;
  wholesaleMinQuantity: number;
  /** true: se puede pedir con decimales (2,5 m³). Solo afecta la pantalla. */
  decimalQuantity?: boolean;
}

export interface LinePrice {
  unitPrice: number;
  priceType: "wholesale" | "retail";
  /**
   * Unidades que faltan para llegar al precio mayorista. null si no
   * aplica: el cliente no es mayorista, eligió precio minorista, o ya
   * llegó al mínimo.
   */
  missingForWholesale: number | null;
}

export function resolveLinePrice(
  product: WholesalePricedProduct,
  customerType: CustomerType,
  preference: PricePreference,
  productQuantity: number
): LinePrice {
  const minimum = Math.max(1, product.wholesaleMinQuantity || 1);
  const wantsWholesale = customerType === "mayorista" && preference === "mayorista";

  if (wantsWholesale && productQuantity >= minimum) {
    return { unitPrice: product.priceWholesale, priceType: "wholesale", missingForWholesale: null };
  }
  return {
    unitPrice: product.priceRetail,
    priceType: "retail",
    missingForWholesale: wantsWholesale ? minimum - productQuantity : null,
  };
}

/** Suma por producto (por si un producto aparece en más de un renglón), igual que create_order. */
export function quantitiesByProduct(items: { productId: string; quantity: number }[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
  return totals;
}

export function isPricePreference(value: unknown): value is PricePreference {
  return value === "mayorista" || value === "minorista";
}
