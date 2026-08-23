"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { EmployeeAdminService } from "./employee-admin-service";
import { createEmployeeSchema, updateEmployeeRoleSchema } from "./schemas";

export interface EmployeeActionResult {
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

export async function createEmployeeAction(formData: FormData): Promise<EmployeeActionResult> {
  const employee = await requireEmployee();

  const parsed = createEmployeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] = issue.message;
    return { fieldErrors };
  }

  if (employee.role !== "super_admin") {
    return { error: "Tu rol no tiene permiso para administrar empleados" };
  }

  const adminDb = createAdminClient();
  const service = new EmployeeAdminService(adminDb, employee);

  try {
    await service.create(parsed.data);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error desconocido" };
  }

  revalidatePath("/admin/empleados");
  return { ok: true };
}

export async function updateEmployeeRoleAction(formData: FormData): Promise<EmployeeActionResult> {
  const employee = await requireEmployee();

  const parsed = updateEmployeeRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: "Datos inválidos" };
  }

  if (employee.role !== "super_admin") {
    return { error: "Tu rol no tiene permiso para administrar empleados" };
  }

  const adminDb = createAdminClient();
  const service = new EmployeeAdminService(adminDb, employee);

  try {
    await service.updateRole(parsed.data.employeeId, parsed.data.role);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error desconocido" };
  }

  revalidatePath("/admin/empleados");
  return { ok: true };
}

export async function deactivateEmployeeAction(employeeId: string): Promise<EmployeeActionResult> {
  const employee = await requireEmployee();

  if (employee.role !== "super_admin") {
    return { error: "Tu rol no tiene permiso para administrar empleados" };
  }

  const adminDb = createAdminClient();
  const service = new EmployeeAdminService(adminDb, employee);

  try {
    await service.deactivate(employeeId);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error desconocido" };
  }

  revalidatePath("/admin/empleados");
  return { ok: true };
}
