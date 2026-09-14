"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { EmailService } from "@/modules/emails/email-service";
import { BusinessSettingsService } from "./business-settings-service";
import { InvoicePdfService } from "./invoice-pdf-service";

// Los datos fiscales determinan qué dice cada comprobante que se emite y
// con qué numeración: solo el super_admin los toca, y cada cambio queda
// en audit_logs (ver BusinessSettingsService.update).
const ROLES_QUE_PUEDEN_CONFIGURAR_FISCAL = ["super_admin"];

// Mismos roles que ven /admin/facturacion: imprimir o reenviar un
// comprobante es parte del trabajo de facturación.
const ROLES_QUE_PUEDEN_FACTURAR = ["admin", "super_admin", "facturacion"];

const optionalText = (max: number) => z.string().trim().max(max).optional();

/**
 * Se valida el FORMATO de cada campo, pero se permite guardar con
 * campos vacíos: el dueño puede ir cargando los datos de a poco. Lo que
 * no se puede es facturar con datos incompletos, y de eso se encarga
 * BusinessSettingsService.getComplete(), que corta con un mensaje
 * diciendo exactamente qué falta.
 */
const businessSettingsSchema = z.object({
  legalName: optionalText(200),
  tradeName: optionalText(200),
  cuit: z
    .string()
    .trim()
    .max(20)
    .refine((v) => v.length === 0 || /^\d{11}$/.test(v.replace(/\D/g, "")), {
      message: "El CUIT tiene que tener 11 dígitos",
    })
    .optional(),
  addressStreet: optionalText(200),
  addressCity: optionalText(120),
  addressProvince: optionalText(120),
  addressPostalCode: optionalText(20),
  ivaCondition: z
    .enum(["responsable_inscripto", "monotributista", "exento"])
    .optional()
    .or(z.literal("").transform(() => undefined)),
  grossIncomeNumber: optionalText(50),
  activitiesStartDate: z
    .string()
    .trim()
    .refine((v) => v.length === 0 || /^\d{4}-\d{2}-\d{2}$/.test(v), {
      message: "La fecha de inicio de actividades no es válida",
    })
    .optional(),
  salesPoint: z
    .string()
    .trim()
    .refine((v) => v.length === 0 || (/^\d+$/.test(v) && Number(v) > 0 && Number(v) <= 99999), {
      message: "El punto de venta tiene que ser un número entre 1 y 99999",
    })
    .optional(),
  contactEmail: z
    .string()
    .trim()
    .max(150)
    .refine((v) => v.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: "El email de contacto no es válido",
    })
    .optional(),
  contactPhone: optionalText(50),
});

export interface UpdateBusinessSettingsResult {
  error?: string;
  ok?: boolean;
  /** Lo que todavía falta para poder facturar, después de guardar. */
  missing?: string[];
}

export async function updateBusinessSettingsAction(
  formData: FormData
): Promise<UpdateBusinessSettingsResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_CONFIGURAR_FISCAL.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const parsed = businessSettingsSchema.safeParse({
    legalName: String(formData.get("legalName") ?? ""),
    tradeName: String(formData.get("tradeName") ?? ""),
    cuit: String(formData.get("cuit") ?? ""),
    addressStreet: String(formData.get("addressStreet") ?? ""),
    addressCity: String(formData.get("addressCity") ?? ""),
    addressProvince: String(formData.get("addressProvince") ?? ""),
    addressPostalCode: String(formData.get("addressPostalCode") ?? ""),
    ivaCondition: String(formData.get("ivaCondition") ?? ""),
    grossIncomeNumber: String(formData.get("grossIncomeNumber") ?? ""),
    activitiesStartDate: String(formData.get("activitiesStartDate") ?? ""),
    salesPoint: String(formData.get("salesPoint") ?? ""),
    contactEmail: String(formData.get("contactEmail") ?? ""),
    contactPhone: String(formData.get("contactPhone") ?? ""),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const adminDb = createAdminClient();
  const service = new BusinessSettingsService(adminDb);

  try {
    await service.update(
      {
        legalName: parsed.data.legalName?.trim() || null,
        tradeName: parsed.data.tradeName?.trim() || null,
        // Se guarda solo con dígitos: así el CUIT que va al código de
        // barras y al QR no depende de cómo se haya tipeado acá.
        cuit: parsed.data.cuit?.replace(/\D/g, "") || null,
        addressStreet: parsed.data.addressStreet?.trim() || null,
        addressCity: parsed.data.addressCity?.trim() || null,
        addressProvince: parsed.data.addressProvince?.trim() || null,
        addressPostalCode: parsed.data.addressPostalCode?.trim() || null,
        ivaCondition: parsed.data.ivaCondition ?? null,
        grossIncomeNumber: parsed.data.grossIncomeNumber?.trim() || null,
        activitiesStartDate: parsed.data.activitiesStartDate?.trim() || null,
        salesPoint: parsed.data.salesPoint ? Number(parsed.data.salesPoint) : null,
        contactEmail: parsed.data.contactEmail?.trim() || null,
        contactPhone: parsed.data.contactPhone?.trim() || null,
      },
      employee.id
    );
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "No se pudieron guardar los datos fiscales",
    };
  }

  revalidatePath("/admin/configuracion-fiscal");
  revalidatePath("/admin/facturacion");

  const missing = BusinessSettingsService.missingFields(await service.get());
  return { ok: true, missing };
}

export interface InvoicePdfActionResult {
  error?: string;
  url?: string;
}

/**
 * URL firmada para descargar o imprimir el PDF del comprobante. Si el
 * PDF no existe todavía (una factura vieja, o una en la que falló la
 * generación al emitir), se genera en el momento.
 *
 * La normativa obliga a entregar el comprobante impreso al consumidor
 * final salvo que acepte otro medio, así que esto tiene que funcionar
 * en el mostrador sin pasos intermedios.
 */
export async function getInvoicePdfUrlAction(invoiceId: string): Promise<InvoicePdfActionResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_FACTURAR.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const parsed = z.string().uuid().safeParse(invoiceId);
  if (!parsed.success) return { error: "Factura inválida" };

  try {
    const url = await new InvoicePdfService(createAdminClient()).getSignedUrl(parsed.data);
    return { url };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "No se pudo generar el PDF del comprobante",
    };
  }
}

export interface ResendInvoiceResult {
  error?: string;
  ok?: boolean;
  sentTo?: string;
}

/**
 * Reenvía una factura autorizada por email, con el PDF adjunto. Acepta
 * una dirección distinta a la del cliente para el caso que motiva el
 * botón: que el cliente haya dado mal el mail.
 */
export async function resendInvoiceEmailAction(
  invoiceId: string,
  to?: string
): Promise<ResendInvoiceResult> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_FACTURAR.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const parsed = z
    .object({
      invoiceId: z.string().uuid(),
      to: z
        .string()
        .trim()
        .max(150)
        .refine((v) => v.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
          message: "Ese email no es válido",
        })
        .optional(),
    })
    .safeParse({ invoiceId, to: to ?? "" });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  const adminDb = createAdminClient();

  try {
    const result = await new EmailService(adminDb).sendInvoiceCopy({
      invoiceId: parsed.data.invoiceId,
      to: parsed.data.to || null,
    });

    if (!result.sent) {
      return { error: result.error ?? "No se pudo enviar el email" };
    }

    await adminDb.from("audit_logs").insert({
      user_id: employee.id,
      action: "resend_invoice_email",
      entity_type: "invoice",
      entity_id: parsed.data.invoiceId,
      data_after: { to: parsed.data.to || "(el email del cliente)" },
    });

    return { ok: true, sentTo: parsed.data.to || undefined };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "No se pudo reenviar la factura" };
  }
}
