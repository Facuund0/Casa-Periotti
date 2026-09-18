import { z } from "zod";
import { isPlausibleDni, isValidCuit } from "@/shared/utils/cuit";

// "cuenta_corriente" es fiado: la mercadería sale y se factura igual, pero
// la plata no entra ahora. Queda como medio de pago para que la factura
// salga con "Cuenta corriente" como condición de venta; lo que el cliente
// debe y va pagando se lleva en customer_account_movements (migración
// 0027), no acá.
export const PAYMENT_METHODS = [
  "efectivo",
  "transferencia",
  "tarjeta",
  "cuenta_corriente",
  "otro",
] as const;
export type PosPaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PosPaymentMethod, string> = {
  efectivo: "Efectivo",
  transferencia: "Transferencia",
  tarjeta: "Tarjeta",
  cuenta_corriente: "Cuenta corriente",
  otro: "Otro",
};

/** Medios que NO son plata en el momento: no entran al cierre de caja. */
export const PAYMENT_METHODS_ON_CREDIT: PosPaymentMethod[] = ["cuenta_corriente"];

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
    // Mayorista aprobado: el cliente pide mayorista o minorista de viva
    // voz. Solo es una preferencia; el precio lo decide create_order.
    pricePreference: z.enum(["mayorista", "minorista"]).default("mayorista"),
    paymentMethod: z.enum(PAYMENT_METHODS),
    items: z
      .array(
        z.object({
          productId: z.string().uuid(),
          // Igual que en la web: hasta 3 decimales, y create_order
          // rechaza los decimales en productos que no los admiten.
          quantity: z.coerce
            .number()
            .positive()
            .max(1_000_000)
            .transform((n) => Math.round(n * 1000) / 1000),
        })
      )
      .min(1, "Agregá al menos un producto"),
  })
  .refine((data) => !(data.customerId && data.looseBuyer), {
    message: "Elegí un cliente registrado o cargá datos sueltos, no las dos cosas",
  })
  // Fiado solo a cliente registrado: si no, no hay a quién cobrarle
  // después. El permiso de fiar se verifica igual en el servidor
  // (PosService.assertCanSellOnCredit).
  .refine((data) => data.paymentMethod !== "cuenta_corriente" || Boolean(data.customerId), {
    message: "La cuenta corriente es solo para clientes registrados: elegí el cliente.",
    path: ["paymentMethod"],
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
