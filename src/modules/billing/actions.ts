"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { BillingService } from "./billing-service";
import { z } from "zod";

const manualInvoiceSchema = z.object({
  // Sin nombre no es un error: se factura como "Consumidor Final",
  // igual que sin CUIT/DNI se factura sin identificar al comprador.
  buyerName: z.string().trim().optional(),
  buyerCuitDni: z.string().trim().optional(),
  buyerIvaCondition: z
    .enum(["consumidor_final", "responsable_inscripto", "monotributista", "exento"])
    .default("consumidor_final"),
  // El empleado carga el subtotal SIN IVA — el total con IVA incluido
  // se calcula acá, nunca se recibe del navegador como valor propio
  // (así no puede haber un total que no cierre contra subtotal + IVA).
  netAmount: z.coerce.number().positive(),
  vatRate: z.coerce.number().min(0).max(100).default(21),
});

export interface BillingActionResult {
  error?: string;
  ok?: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function createManualInvoiceAction(formData: FormData): Promise<BillingActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee) return { error: "No autenticado" };
  if (!["admin", "super_admin", "facturacion"].includes(employee.role)) {
    return { error: "Tu rol no tiene permiso para facturar" };
  }

  const parsed = manualInvoiceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  // El desglose definitivo se calcula acá, en el servidor — nunca se
  // confía en ninguna cuenta hecha en el navegador (ahí solo se
  // muestra un desglose en vivo a modo informativo).
  const netAmount = round2(parsed.data.netAmount);
  const vatRate = parsed.data.vatRate;
  const vatAmount = round2(netAmount * (vatRate / 100));
  const totalAmount = round2(netAmount + vatAmount);

  const adminDb = createAdminClient();
  const billingService = new BillingService(adminDb);

  try {
    await billingService.billManual({
      buyerName: parsed.data.buyerName || "Consumidor Final",
      buyerCuitDni: parsed.data.buyerCuitDni || null,
      buyerIvaCondition: parsed.data.buyerIvaCondition,
      netAmount,
      vatAmount,
      vatRate,
      totalAmount,
      employeeId: employee.id,
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Error al facturar" };
  }

  revalidatePath("/admin/facturacion");
  return { ok: true };
}
