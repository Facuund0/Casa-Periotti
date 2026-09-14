import { z } from "zod";
import { validateCustomerFiscalData } from "@/modules/customers/fiscal-rules";

export const PAYMENT_METHODS = ["efectivo", "transferencia", "tarjeta", "otro"] as const;
export type PosPaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PosPaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  otro: "Otro",
};

export const IVA_CONDITIONS = [
  "consumidor_final",
  "responsable_inscripto",
  "monotributista",
  "exento",
] as const;
export type PosIvaCondition = (typeof IVA_CONDITIONS)[number];

export const IVA_CONDITION_LABELS: Record<PosIvaCondition, string> = {
  consumidor_final: "Consumidor Final",
  responsable_inscripto: "Responsable Inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
};

// Datos fiscales sueltos para alguien que compra en mostrador sin
// cuenta registrada (ej: pide Factura A con su CUIT). Van solo a la
// factura y al envío del comprobante — nunca crean un cliente en
// customer_profiles.
const looseBuyerSchema = z.object({
  buyerName: z.string().trim().min(2, "Ingresá el nombre o razón social del comprador"),
  buyerCuitDni: z.string().trim().optional(),
  buyerIvaCondition: z.enum(IVA_CONDITIONS),
  // Opcional: si se carga, se le manda la factura por mail con la misma
  // plantilla que usa una compra web. Vacío es válido (el cliente se
  // lleva el comprobante impreso y no deja mail).
  buyerEmail: z
    .string()
    .trim()
    .max(150)
    .refine((v) => v.length === 0 || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
      message: "Ese email no es válido",
    })
    .optional(),
});

export const createPosSaleSchema = z
  .object({
    customerId: z.string().uuid().nullable(),
    looseBuyer: looseBuyerSchema.nullable(),
    paymentMethod: z.enum(PAYMENT_METHODS),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          quantity: z.coerce.number().int().positive(),
        })
      )
      .min(1, "Agregá al menos un producto"),
  })
  .refine((data) => !(data.customerId && data.looseBuyer), {
    message: "Elegí un cliente registrado o cargá datos fiscales sueltos, no las dos cosas",
  })
  // Mismas reglas que el checkout y el panel: un CUIT inválido termina en
  // una factura que ARCA rechaza.
  .superRefine((data, ctx) => {
    if (!data.looseBuyer) return;
    const invalid = validateCustomerFiscalData({
      cuitDni: data.looseBuyer.buyerCuitDni,
      ivaCondition: data.looseBuyer.buyerIvaCondition,
    });
    if (invalid) {
      ctx.addIssue({ code: "custom", message: invalid, path: ["looseBuyer", "buyerCuitDni"] });
    }
  });

export type CreatePosSaleInput = z.infer<typeof createPosSaleSchema>;
