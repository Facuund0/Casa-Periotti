"use server";

import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import type { SearchSuggestion } from "@/app/_components/smart-search";
import { formatCuit } from "@/shared/utils/cuit";

/**
 * Sugerencias para los buscadores del panel, mientras se escribe. Cada
 * una exige el mismo rol que la página donde se usa, y sugiere lo mismo
 * que después encuentra esa búsqueda.
 *
 * Lo tipeado nunca se arma dentro de un filtro .or() de PostgREST como
 * texto: se usan ilike() separados con los comodines escapados, y los
 * rangos numéricos se arman solo con dígitos.
 */

const MAX_SUGGESTIONS = 8;

async function requireRole(roles: string[]) {
  const employee = await getCurrentEmployee();
  if (!employee || !roles.includes(employee.role)) throw new Error("No autorizado");
}

function cleanTerm(query: string): string {
  return String(query ?? "").trim().slice(0, 80);
}

/** % y _ son comodines de LIKE: si los tipeó el usuario, son literales. */
function likePattern(term: string): string {
  return `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
}

/**
 * Filtro .or() de números que EMPIEZAN con los dígitos tipeados
 * ("12" → 12, 120-129, 1200-1299...). Solo lleva dígitos: no hay texto
 * del usuario dentro del filtro.
 */
function numberPrefixFilter(column: string, digits: string): string {
  const n = Number(digits);
  const parts = [`${column}.eq.${n}`];
  for (let scale = 10; scale <= 10_000_000; scale *= 10) {
    parts.push(`and(${column}.gte.${n * scale},${column}.lt.${(n + 1) * scale})`);
  }
  return parts.join(",");
}

function money(n: number): string {
  return `$ ${n.toLocaleString("es-AR")}`;
}

/** Clientes por nombre, email o CUIT/DNI. Clientes y facturación manual. */
export async function suggestCustomersAction(query: string): Promise<SearchSuggestion[]> {
  await requireRole(["admin", "super_admin", "ventas", "facturacion"]);
  const term = cleanTerm(query);
  if (term.length < 2) return [];

  const db = createAdminClient();
  const select = "id, full_name, email, cuit_dni, customer_type";
  const digits = term.replace(/\D/g, "");
  const lookups = [
    db.from("customer_profiles").select(select).ilike("full_name", likePattern(term)).order("full_name").limit(MAX_SUGGESTIONS),
    db.from("customer_profiles").select(select).ilike("email", likePattern(term)).order("full_name").limit(MAX_SUGGESTIONS),
  ];
  if (digits.length >= 3 && digits === term.replace(/[\s.-]/g, "")) {
    lookups.push(db.from("customer_profiles").select(select).ilike("cuit_dni", `%${digits}%`).limit(MAX_SUGGESTIONS));
  }

  const merged = new Map<string, SearchSuggestion>();
  for (const { data } of await Promise.all(lookups)) {
    for (const c of data ?? []) {
      merged.set(c.id, {
        key: c.id,
        label: c.full_name,
        detail: [
          c.email,
          c.cuit_dni ? `CUIT/DNI ${formatCuit(c.cuit_dni)}` : null,
          c.customer_type === "mayorista" ? "Mayorista" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        value: c.full_name,
        meta: { email: c.email, cuitDni: c.cuit_dni, name: c.full_name },
      });
    }
  }
  return [...merged.values()].slice(0, MAX_SUGGESTIONS);
}

/** Facturación: clientes facturados y números de comprobante. */
export async function suggestInvoicesAction(query: string): Promise<SearchSuggestion[]> {
  await requireRole(["admin", "super_admin", "facturacion"]);
  const term = cleanTerm(query);
  const db = createAdminClient();
  const suggestions: SearchSuggestion[] = [];

  if (/^\d+$/.test(term)) {
    const { data } = await db
      .from("invoices")
      .select("id, invoice_type, sales_point, voucher_number, customer_name, total")
      .or(numberPrefixFilter("voucher_number", term))
      .order("voucher_number", { ascending: false })
      .limit(MAX_SUGGESTIONS);
    for (const inv of data ?? []) {
      suggestions.push({
        key: inv.id,
        label: `${inv.invoice_type} ${String(inv.sales_point).padStart(4, "0")}-${String(inv.voucher_number).padStart(8, "0")}`,
        detail: `${inv.customer_name} · ${money(Number(inv.total))}`,
        value: String(inv.voucher_number),
      });
    }
    return suggestions;
  }

  if (term.length < 2) return [];
  const { data } = await db
    .from("invoices")
    .select("customer_name")
    .ilike("customer_name", likePattern(term))
    .order("created_at", { ascending: false })
    .limit(100);
  const counts = new Map<string, number>();
  for (const inv of data ?? []) counts.set(inv.customer_name, (counts.get(inv.customer_name) ?? 0) + 1);
  for (const [name, count] of counts) {
    suggestions.push({
      key: `name-${name}`,
      label: name,
      detail: `${count} ${count === 1 ? "factura" : "facturas"}`,
      value: name,
    });
  }
  return suggestions.slice(0, MAX_SUGGESTIONS);
}

/** Comprobantes: números de pedido con comprobante y clientes que subieron alguno. */
export async function suggestReceiptsAction(query: string): Promise<SearchSuggestion[]> {
  await requireRole(["admin", "super_admin", "ventas"]);
  const term = cleanTerm(query);
  const db = createAdminClient();
  const asOrderNumber = term.replace(/^CP-?/i, "").trim();

  if (/^\d+$/.test(asOrderNumber)) {
    const { data: orders } = await db
      .from("orders")
      .select("id, order_number, total, customer_id")
      .or(numberPrefixFilter("order_number", asOrderNumber))
      .order("order_number", { ascending: false })
      .limit(40);
    const ids = (orders ?? []).map((o) => o.id);
    const { data: receipts } = ids.length
      ? await db.from("payment_receipts").select("order_id").in("order_id", ids)
      : { data: [] as { order_id: string }[] };
    const withReceipt = new Set((receipts ?? []).map((r) => r.order_id));
    const matching = (orders ?? []).filter((o) => withReceipt.has(o.id)).slice(0, MAX_SUGGESTIONS);
    const customerIds = [...new Set(matching.map((o) => o.customer_id).filter(Boolean))];
    const { data: customers } = customerIds.length
      ? await db.from("customer_profiles").select("id, full_name").in("id", customerIds)
      : { data: [] as { id: string; full_name: string }[] };
    const names = new Map((customers ?? []).map((c) => [c.id, c.full_name]));
    return matching.map((o) => ({
      key: o.id,
      label: `Pedido #${o.order_number}`,
      detail: [names.get(o.customer_id), money(Number(o.total))].filter(Boolean).join(" · "),
      value: String(o.order_number),
    }));
  }

  if (term.length < 2) return [];
  const { data: customers } = await db
    .from("customer_profiles")
    .select("id, full_name, email")
    .ilike("full_name", likePattern(term))
    .order("full_name")
    .limit(30);
  const customerIds = (customers ?? []).map((c) => c.id);
  const { data: orders } = customerIds.length
    ? await db.from("orders").select("id, customer_id").in("customer_id", customerIds).limit(500)
    : { data: [] as { id: string; customer_id: string }[] };
  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: receipts } = orderIds.length
    ? await db.from("payment_receipts").select("order_id").in("order_id", orderIds)
    : { data: [] as { order_id: string }[] };
  const ordersWithReceipt = new Set((receipts ?? []).map((r) => r.order_id));
  const receiptsByCustomer = new Map<string, number>();
  for (const o of orders ?? []) {
    if (ordersWithReceipt.has(o.id)) receiptsByCustomer.set(o.customer_id, (receiptsByCustomer.get(o.customer_id) ?? 0) + 1);
  }
  return (customers ?? [])
    .filter((c) => receiptsByCustomer.has(c.id))
    .slice(0, MAX_SUGGESTIONS)
    .map((c) => {
      const count = receiptsByCustomer.get(c.id) ?? 0;
      return {
        key: c.id,
        label: c.full_name,
        detail: `${c.email} · ${count} ${count === 1 ? "comprobante" : "comprobantes"}`,
        value: c.full_name,
      };
    });
}

/** Panel de productos: por nombre o SKU, incluidos los desactivados. */
export async function suggestAdminProductsAction(query: string): Promise<SearchSuggestion[]> {
  await requireRole(["admin", "super_admin", "stock"]);
  const term = cleanTerm(query);
  if (term.length < 2) return [];

  const db = createAdminClient();
  const select = "id, sku, name, stock_quantity, stock_reserved, active";
  const [byName, bySku] = await Promise.all([
    db.from("products").select(select).ilike("name", likePattern(term)).order("name").limit(MAX_SUGGESTIONS),
    db.from("products").select(select).ilike("sku", likePattern(term)).order("name").limit(MAX_SUGGESTIONS),
  ]);
  const merged = new Map<string, SearchSuggestion>();
  for (const p of [...(byName.data ?? []), ...(bySku.data ?? [])]) {
    merged.set(p.id, {
      key: p.id,
      label: p.name,
      detail: [`SKU ${p.sku}`, `${p.stock_quantity - p.stock_reserved} disponibles`, p.active ? null : "Desactivado"]
        .filter(Boolean)
        .join(" · "),
      value: p.sku,
    });
  }
  return [...merged.values()].slice(0, MAX_SUGGESTIONS);
}
