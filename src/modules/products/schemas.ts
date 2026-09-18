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
  // Se cargan NETOS (sin IVA), que es como llega el precio del
  // proveedor. El precio final con IVA lo calcula el servidor y es lo
  // que se guarda en products.price_retail / price_wholesale — ver
  // pricing.ts, que explica por qué el formato de guardado no cambia.
  priceRetailNet: z.coerce.number().min(0, "El precio minorista no puede ser negativo"),
  priceWholesaleNet: z.coerce.number().min(0, "El precio mayorista no puede ser negativo"),
  vatRate: z.coerce.number().min(0).max(100).default(21),
  unit: z.string().trim().min(1).default("unidad"),
  // Con decimales si el producto los admite (ver decimalQuantity).
  stockMinimum: z.coerce.number().min(0).default(0),
  // true: se vende en cantidades con decimales (m³, kg, metros). La base
  // lo vuelve a controlar en create_order: un producto sin esto no acepta
  // media unidad por más que el navegador la mande.
  decimalQuantity: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === "on" || v === "true"),
  // Costo SIN IVA, como viene en la factura del proveedor. Opcional: sin
  // costo cargado, el producto simplemente no entra en el margen.
  costNet: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v && v.length ? Number(v.replace(",", ".")) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0), {
      message: "El costo no puede ser negativo",
    }),
  // Código de barras del envase (lo lee el escáner). Distinto del SKU.
  barcode: z
    .string()
    .trim()
    .max(64)
    .optional()
    .transform((v) => (v && v.length ? v.replace(/\s+/g, "") : null)),
  // 1 = sin mínimo: el mayorista aprobado tiene precio mayorista desde la
  // primera unidad. Se evalúa por producto (ver wholesale-pricing.ts).
  wholesaleMinQuantity: z.coerce
    .number()
    .int("La cantidad mínima tiene que ser un número entero")
    .min(1, "La cantidad mínima para precio mayorista es 1 o más")
    .default(1),
});

export type ProductInput = z.infer<typeof productSchema>;

export const stockAdjustmentSchema = z.object({
  productId: z.string().uuid(),
  // Decimales permitidos: ajustar 2,5 m³ de arena tiene que poder
  // hacerse. adjust_stock los rechaza si el producto no los admite.
  quantityDelta: z.coerce
    .number()
    .refine((n) => n !== 0, "La cantidad no puede ser 0")
    .transform((n) => Math.round(n * 1000) / 1000),
  movementType: z.enum(["entrada_compra", "ajuste", "merma", "devolucion"]),
  reason: z.string().trim().min(3, "Contá brevemente el motivo del ajuste"),
});
