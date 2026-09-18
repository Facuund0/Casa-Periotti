import { z } from "zod";

export const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        // Con decimales (hasta 3) para lo que se vende medido: 2,5 m³.
        // Que ESE producto los admita lo controla create_order, que es
        // quien lee la base (migración 0028).
        quantity: z.coerce
          .number()
          .positive()
          .max(1_000_000)
          .transform((n) => Math.round(n * 1000) / 1000),
      })
    )
    .min(1, "El carrito está vacío"),
  fulfillmentMethod: z.enum(["pickup", "delivery"]),
  shippingStreet: z.string().trim().optional(),
  shippingCity: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  // Solo cuenta para mayoristas aprobados; la aplica create_order.
  pricePreference: z.enum(["mayorista", "minorista"]).default("mayorista"),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
