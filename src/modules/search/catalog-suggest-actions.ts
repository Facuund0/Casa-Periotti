"use server";

import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentCustomer } from "@/modules/auth/current-user";
import { ProductService } from "@/modules/products/product-service";
import type { SearchSuggestion } from "@/app/_components/smart-search";

/**
 * Sugerencias del buscador del catálogo público. Solo productos activos,
 * que ya son públicos, con el precio que ve quien busca (minorista, o
 * mayorista si es un mayorista aprobado). Elegir una abre la ficha.
 */
export async function suggestCatalogAction(query: string): Promise<SearchSuggestion[]> {
  const term = String(query ?? "").trim().slice(0, 80);
  if (term.length < 2) return [];

  const [supabase, customer] = await Promise.all([createClient(), getCurrentCustomer()]);
  const products = await new ProductService(supabase).searchCatalog(
    term,
    customer?.customerType ?? "minorista",
    8
  );

  return products.map((p) => ({
    key: p.id,
    label: p.name,
    detail: [p.brand, `$ ${p.displayPrice.toLocaleString("es-AR")} / ${p.unit}`].filter(Boolean).join(" · "),
    value: p.name,
    href: `/producto/${p.slug}`,
  }));
}
