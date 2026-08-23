import { z } from "zod";

export const processCardPaymentSchema = z.object({
  orderId: z.string().uuid(),
  token: z.string().min(10),
  paymentMethodId: z.string().min(1),
  issuerId: z.string().optional(),
  installments: z.coerce.number().int().min(1),
  identificationType: z.string().optional(),
  identificationNumber: z.string().optional(),
});
