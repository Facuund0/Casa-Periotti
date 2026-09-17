import { z } from "zod";

export const checkoutSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.coerce.number().int().positive(),
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
