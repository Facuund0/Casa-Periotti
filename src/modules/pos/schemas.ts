import { z } from "zod";
import { isPlausibleDni, isValidCuit } from "@/shared/utils/cuit";

export const PAYMENT_METHODS = ["efectivo", "transferencia", "tarjeta", "otro"] as const;
export type PosPaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PosPaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  otro: "Otro",
};

// Comprobante de la venta: igual que en el checkout web. Por defecto
// Consumidor Final; con "Factura con datos fiscales" el padrón decide la
// letra. Nunca crea ni toca un cliente en customer_profiles.
const fiscalSchema = z.object({
  kind: z.enum(["final_consumer", "fiscal_data"]),
  cuit: z.string().trim().max(20).optional(),
  dni: z.string().trim().max(12).optional(),
});

// Datos para la factura y el envío cuando NO hay cliente registrado.
// Opcionales: sin nombre, con datos fiscales va la razón social de ARCA y
// sin datos fiscales "Consumidor Final"; sin email se entrega impresa.
const looseBuyerSchema = z.object({
  buyerName: z.string().trim().max(200).optional(),
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
    fiscal: fiscalSchema,
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
    message: "Elegí un cliente registrado o cargá datos sueltos, no las dos cosas",
  })
  .superRefine((data, ctx) => {
    if (data.fiscal.kind === "fiscal_data" && !isValidCuit(data.fiscal.cuit)) {
      ctx.addIssue({
        code: "custom",
        message: "El CUIT no es válido: revisá los 11 dígitos (el último es un dígito verificador).",
        path: ["fiscal", "cuit"],
      });
    }
    if (data.fiscal.kind === "final_consumer" && data.fiscal.dni && !isPlausibleDni(data.fiscal.dni)) {
      ctx.addIssue({ code: "custom", message: "El DNI tiene que tener 7 u 8 dígitos.", path: ["fiscal", "dni"] });
    }
  });

export type CreatePosSaleInput = z.infer<typeof createPosSaleSchema>;
