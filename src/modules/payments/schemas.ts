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

export const purgeReceiptSchema = z.object({
  receiptId: z.string().uuid(),
});

export const viewReceiptSchema = z.object({
  receiptId: z.string().uuid(),
});

/**
 * Filtros del listado de /admin/comprobantes. Vienen de la query string,
 * así que cualquiera puede mandar cualquier cosa: cada campo usa
 * .catch(undefined) para que un valor inválido se ignore en vez de
 * romper la página con un 500.
 */
export const receiptFiltersSchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  status: z.enum(["pending", "approved", "rejected"]).optional().catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});

export type ReceiptFilters = z.infer<typeof receiptFiltersSchema>;

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
