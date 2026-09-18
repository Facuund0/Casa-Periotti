"use server";

import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentCustomer } from "@/modules/auth/current-user";
import type { CustomerType } from "@/modules/products/types";
import type { WholesalePricedProduct } from "@/modules/products/wholesale-pricing";

export interface CartPricing {
  customerType: CustomerType;
  products: Record<string, WholesalePricedProduct>;
}

/**
 * Precios actuales, mínimo mayorista de cada producto y tipo de cliente,
 * para que el carrito y el checkout muestren lo que va a cobrar
 * create_order. Solo lee datos públicos del catálogo más el tipo del
 * cliente logueado; el tipo nunca se toma del navegador.
 */
export async function getCartPricingAction(productIds: string[]): Promise<CartPricing> {
  const ids = [...new Set(productIds)].filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, 200);
  const [customer, supabase] = await Promise.all([getCurrentCustomer(), createClient()]);

  const products: Record<string, WholesalePricedProduct> = {};
  if (ids.length) {
    const { data } = await supabase
      .from("products")
      .select("id, price_retail, price_wholesale, wholesale_min_quantity, decimal_quantity")
      .in("id", ids);
    for (const p of data ?? []) {
      products[p.id] = {
        priceRetail: Number(p.price_retail),
        priceWholesale: Number(p.price_wholesale),
        wholesaleMinQuantity: p.wholesale_min_quantity ?? 1,
        decimalQuantity: Boolean(p.decimal_quantity),
      };
    }
  }

  return { customerType: customer?.customerType ?? "minorista", products };
}
