import { z } from "zod";

export const productSchema = z.object({
  sku: z.string().trim().min(1, "El SKU es obligatorio"),
  name: z.string().trim().min(2, "El nombre es obligatorio"),
  slug: z
    .string()
    .trim()
    .min(2)
    .regex(/^[a-z0-9-]+$/, "El slug solo puede tener minúsculas, números y guiones"),
  description: z.string().trim().optional(),
  brand: z.string().trim().optional(),
  categoryId: z.string().uuid("Elegí una categoría"),
  priceRetail: z.coerce.number().min(0, "El precio minorista no puede ser negativo"),
  priceWholesale: z.coerce.number().min(0, "El precio mayorista no puede ser negativo"),
  vatRate: z.coerce.number().min(0).max(100).default(21),
  unit: z.string().trim().min(1).default("unidad"),
  stockMinimum: z.coerce.number().int().min(0).default(0),
});

export type ProductInput = z.infer<typeof productSchema>;

export const stockAdjustmentSchema = z.object({
  productId: z.string().uuid(),
  quantityDelta: z.coerce.number().int().refine((n) => n !== 0, "La cantidad no puede ser 0"),
  movementType: z.enum(["entrada_compra", "ajuste", "merma", "devolucion"]),
  reason: z.string().trim().min(3, "Contá brevemente el motivo del ajuste"),
});
