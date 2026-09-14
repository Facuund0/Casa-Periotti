import { z } from "zod";

export const uploadReceiptSchema = z.object({
  orderId: z.string().uuid(),
});

export const confirmTransferSchema = z.object({
  orderId: z.string().uuid(),
});

export const rejectTransferSchema = z.object({
  orderId: z.string().uuid(),
  // El motivo queda guardado en payment_receipts.rejection_reason y es
  // lo que explica al cliente (y a quien audite después) por qué no se
  // aceptó el comprobante.
  reason: z.string().trim().min(3, "Escribí brevemente por qué se rechaza").max(500),
});

export const paymentSettingsSchema = z
  .object({
    // Todos opcionales de a uno, pero hace falta al menos alias o CBU
    // para que alguien pueda transferir — se valida abajo.
    alias: z.string().trim().max(100).optional(),
    cbu: z
      .string()
      .trim()
      .max(30)
      // Vacío es válido (se puede configurar solo el alias); si viene
      // con algo, tiene que ser un CBU de 22 dígitos.
      .refine((v) => v.length === 0 || /^\d{22}$/.test(v.replace(/\D/g, "")), {
        message: "El CBU tiene que tener 22 dígitos",
      })
      .optional(),
    accountHolder: z.string().trim().max(150).optional(),
    bankName: z.string().trim().max(100).optional(),
  })
  .refine((data) => Boolean(data.alias?.trim() || data.cbu?.trim()), {
    message: "Cargá al menos un alias o un CBU — sin eso el cliente no puede transferir",
    path: ["alias"],
  });
