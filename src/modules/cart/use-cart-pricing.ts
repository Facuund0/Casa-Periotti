"use client";

import { useEffect, useMemo, useState } from "react";
import type { CustomerType } from "@/modules/products/types";
import {
  quantitiesByProduct,
  resolveLinePrice,
  type LinePrice,
  type PricePreference,
} from "@/modules/products/wholesale-pricing";
import { getCartPricingAction, type CartPricing } from "./actions";
import type { CartItem } from "./types";

export interface PricedCartLine extends CartItem, LinePrice {
  lineTotal: number;
  wholesaleMinQuantity: number;
  /** Para el campo de cantidad: deja escribir 2,5 o solo enteros. */
  decimalQuantity: boolean;
}

/**
 * Renglones del carrito con el precio que va a aplicar create_order:
 * precios actuales, tipo de cliente y mínimo mayorista por producto.
 * Mientras llegan los datos (o si fallan) se usa el precio guardado al
 * agregar el producto. Nunca decide lo que se cobra.
 */
export function useCartPricing(items: CartItem[], preference: PricePreference) {
  const [pricing, setPricing] = useState<CartPricing | null>(null);
  const idsKey = [...new Set(items.map((i) => i.productId))].sort().join(",");

  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    getCartPricingAction(idsKey.split(","))
      .then((result) => {
        if (!cancelled) setPricing(result);
      })
      .catch(() => {
        // Sin datos frescos se sigue mostrando el precio guardado.
      });
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  return useMemo(() => {
    const customerType: CustomerType = pricing?.customerType ?? "minorista";
    const quantities = quantitiesByProduct(items);
    const lines: PricedCartLine[] = items.map((item) => {
      const product = pricing?.products[item.productId];
      const price: LinePrice = product
        ? resolveLinePrice(product, customerType, preference, quantities.get(item.productId) ?? item.quantity)
        : { unitPrice: item.unitPrice, priceType: "retail", missingForWholesale: null };
      return {
        ...item,
        ...price,
        wholesaleMinQuantity: product?.wholesaleMinQuantity ?? 1,
        decimalQuantity: product?.decimalQuantity ?? false,
        lineTotal: Math.round(price.unitPrice * item.quantity * 100) / 100,
      };
    });
    const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    return { lines, total, customerType, loaded: pricing !== null };
  }, [items, pricing, preference]);
}
