"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { ProductAdminService } from "./product-admin-service";
import { productSchema, stockAdjustmentSchema } from "./schemas";
import { StockService, InsufficientStockError } from "@/modules/stock/stock-service";

export interface AdminActionResult {
  error?: string;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
}

async function requireEmployee() {
  const employee = await getCurrentEmployee();
  if (!employee) {
    throw new Error("No autenticado como empleado");
  }
  return employee;
}

export async function createProductAction(formData: FormData): Promise<AdminActionResult> {
  const employee = await requireEmployee();

  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { fieldErrors };
  }

  const adminDb = createAdminClient();
  const service = new ProductAdminService(adminDb, employee);

  try {
    const productId = await service.create(parsed.data);

    // Si se cargó stock inicial, se registra como movimiento de entrada
    // por compra, nunca como un número pisado directo.
    const initialStock = Number(formData.get("initialStock") ?? 0);
    if (initialStock > 0) {
      const stockService = new StockService(adminDb);
      await stockService.manualAdjustment({
        productId,
        quantityDelta: initialStock,
        movementType: "entrada_compra",
        reason: "Carga inicial de stock al crear el producto",
        employeeId: employee.id,
      });
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error desconocido" };
  }

  revalidatePath("/admin/productos");
  redirect("/admin/productos");
}

export async function updateProductAction(
  productId: string,
  formData: FormData
): Promise<AdminActionResult> {
  const employee = await requireEmployee();

  const parsed = productSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { fieldErrors };
  }

  const adminDb = createAdminClient();
  const service = new ProductAdminService(adminDb, employee);

  try {
    await service.update(productId, parsed.data);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error desconocido" };
  }

  revalidatePath("/admin/productos");
  redirect("/admin/productos");
}

export async function deactivateProductAction(productId: string) {
  const employee = await requireEmployee();
  const adminDb = createAdminClient();
  const service = new ProductAdminService(adminDb, employee);
  await service.deactivate(productId);
  revalidatePath("/admin/productos");
}

export async function reactivateProductAction(productId: string) {
  const employee = await requireEmployee();
  const adminDb = createAdminClient();
  const service = new ProductAdminService(adminDb, employee);
  await service.reactivate(productId);
  revalidatePath("/admin/productos");
}

export async function adjustStockAction(formData: FormData): Promise<AdminActionResult> {
  const employee = await requireEmployee();

  const parsed = stockAdjustmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { fieldErrors };
  }

  if (!["admin", "super_admin", "stock"].includes(employee.role)) {
    return { error: "Tu rol no tiene permiso para ajustar stock" };
  }

  const adminDb = createAdminClient();
  const stockService = new StockService(adminDb);

  try {
    await stockService.manualAdjustment({
      productId: parsed.data.productId,
      quantityDelta: parsed.data.quantityDelta,
      movementType: parsed.data.movementType,
      reason: parsed.data.reason,
      employeeId: employee.id,
    });
  } catch (err) {
    if (err instanceof InsufficientStockError) {
      return { error: err.message };
    }
    return { error: err instanceof Error ? err.message : "Error desconocido" };
  }

  revalidatePath("/admin/productos");
  return { ok: true };
}

export async function approveWholesaleAction(customerId: string) {
  const employee = await requireEmployee();
  if (!["admin", "super_admin", "ventas"].includes(employee.role)) {
    throw new Error("Tu rol no tiene permiso para aprobar mayoristas");
  }

  const adminDb = createAdminClient();
  const { error } = await adminDb
    .from("customer_profiles")
    .update({ customer_type: "mayorista" })
    .eq("id", customerId);

  if (error) throw new Error(`No se pudo aprobar al cliente: ${error.message}`);

  await adminDb.from("audit_logs").insert({
    user_id: employee.id,
    action: "approve_wholesale",
    entity_type: "customer",
    entity_id: customerId,
  });

  revalidatePath("/admin/clientes");
}

export async function rejectWholesaleAction(customerId: string) {
  const employee = await requireEmployee();
  if (!["admin", "super_admin", "ventas"].includes(employee.role)) {
    throw new Error("Tu rol no tiene permiso para rechazar solicitudes de mayorista");
  }

  const adminDb = createAdminClient();
  const { error } = await adminDb
    .from("customer_profiles")
    .update({ customer_type: "minorista" })
    .eq("id", customerId);

  if (error) throw new Error(`No se pudo rechazar la solicitud: ${error.message}`);

  revalidatePath("/admin/clientes");
}
