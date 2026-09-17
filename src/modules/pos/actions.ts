"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/infrastructure/database/supabase-server";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { PosService } from "./pos-service";
import { createPosSaleSchema } from "./schemas";
import {
  previewFiscalInvoice,
  toPreview,
  type FiscalInvoicePreview,
} from "@/modules/billing/buyer-fiscal-check";

const ROLES_QUE_PUEDEN_VENDER = ["ventas", "admin", "super_admin"];

export interface ProductSearchResult {
  id: string;
  sku: string;
  name: string;
  priceRetail: number;
  priceWholesale: number;
  wholesaleMinQuantity: number;
  vatRate: number;
  stockAvailable: number;
}

export interface CustomerSearchResult {
  id: string;
  fullName: string;
  email: string;
  customerType: "minorista" | "mayorista" | "mayorista_pendiente";
  /** Para precargar la factura con datos fiscales (se revalida en el padrón). */
  cuitDni: string | null;
  dni: string | null;
  invoiceWithFiscalData: boolean;
}

export interface PosSaleActionResult {
  error?: string;
  ok?: boolean;
  orderNumber?: number;
  total?: number;
}

async function requireSalesEmployee() {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_VENDER.includes(employee.role)) {
    throw new Error("No autorizado para vender en mostrador");
  }
  return employee;
}

/**
 * Dos ilike() directos (nombre y SKU) en vez de armar un string para
 * .or() a mano: así lo que tipea el empleado nunca se interpreta como
 * parte del filtro de PostgREST, solo como texto literal.
 */
export async function searchProductsAction(query: string): Promise<ProductSearchResult[]> {
  await requireSalesEmployee();

  const term = query.trim();
  if (!term) return [];

  const supabase = await createClient();
  const select = "id, sku, name, price_retail, price_wholesale, wholesale_min_quantity, vat_rate, stock_quantity, stock_reserved";

  const [{ data: byName }, { data: bySku }] = await Promise.all([
    supabase
      .from("products")
      .select(select)
      .eq("active", true)
      .ilike("name", `%${term}%`)
      .order("name")
      .limit(20),
    supabase
      .from("products")
      .select(select)
      .eq("active", true)
      .ilike("sku", `%${term}%`)
      .order("name")
      .limit(20),
  ]);

  const merged = new Map<string, ProductSearchResult>();
  for (const p of [...(byName ?? []), ...(bySku ?? [])]) {
    merged.set(p.id, {
      id: p.id,
      sku: p.sku,
      name: p.name,
      priceRetail: Number(p.price_retail),
      priceWholesale: Number(p.price_wholesale),
      wholesaleMinQuantity: p.wholesale_min_quantity ?? 1,
      vatRate: Number(p.vat_rate),
      stockAvailable: Number(p.stock_quantity) - Number(p.stock_reserved),
    });
  }
  return Array.from(merged.values()).slice(0, 20);
}

export async function searchCustomersAction(query: string): Promise<CustomerSearchResult[]> {
  await requireSalesEmployee();

  const term = query.trim();
  if (!term) return [];

  const supabase = await createClient();
  const select = "id, full_name, email, customer_type, cuit_dni, dni, invoice_with_fiscal_data";

  const digits = term.replace(/\D/g, "");
  const [{ data: byName }, { data: byEmail }, { data: byDoc }] = await Promise.all([
    supabase.from("customer_profiles").select(select).ilike("full_name", `%${term}%`).order("full_name").limit(20),
    supabase.from("customer_profiles").select(select).ilike("email", `%${term}%`).order("full_name").limit(20),
    // También por CUIT/DNI, si lo tipeado son números.
    digits.length >= 3 && digits === term.replace(/[\s.-]/g, "")
      ? supabase.from("customer_profiles").select(select).ilike("cuit_dni", `%${digits}%`).limit(20)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const merged = new Map<string, CustomerSearchResult>();
  for (const c of [...(byName ?? []), ...(byEmail ?? []), ...(byDoc ?? [])]) {
    merged.set(c.id, {
      id: c.id,
      fullName: c.full_name,
      email: c.email,
      customerType: c.customer_type,
      cuitDni: c.cuit_dni,
      dni: c.dni,
      invoiceWithFiscalData: c.invoice_with_fiscal_data,
    });
  }
  return Array.from(merged.values()).slice(0, 20);
}

export async function createPosSaleAction(input: unknown): Promise<PosSaleActionResult> {
  const employee = await requireSalesEmployee();

  const parsed = createPosSaleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const adminDb = createAdminClient();
  const posService = new PosService(adminDb);

  try {
    const result = await posService.createSale(employee, parsed.data);
    revalidatePath("/admin/productos");
    return { ok: true, orderNumber: result.orderNumber, total: result.total };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al registrar la venta" };
  }
}

/**
 * Vista previa de "Factura con datos fiscales" en el mostrador: mismo
 * padrón y misma tabla de decisión que el checkout web. Solo lee.
 */
export async function previewPosFiscalInvoiceAction(
  cuit: string
): Promise<{ preview?: FiscalInvoicePreview; error?: string }> {
  await requireSalesEmployee();
  const { outcome } = await previewFiscalInvoice(createAdminClient(), String(cuit).slice(0, 20));
  return toPreview(outcome);
}
