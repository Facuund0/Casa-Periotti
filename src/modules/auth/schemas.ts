import { z } from "zod";

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(2, "Ingresá tu nombre completo"),
    email: z.string().trim().email("Email inválido"),
    password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
    phone: z.string().trim().min(6, "Ingresá un teléfono válido"),
    wantsWholesale: z.boolean().default(false),
    cuit: z.string().trim().optional(),
  })
  .refine((data) => !data.wantsWholesale || (data.cuit && data.cuit.length >= 10), {
    message: "Para pedir precio mayorista necesitamos tu CUIT",
    path: ["cuit"],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email("Email inválido"),
  password: z.string().min(1, "Ingresá tu contraseña"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const emailOnlySchema = z.object({
  email: z.string().trim().email("Email inválido"),
});

export const newPasswordSchema = z
  .object({
    password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Las contraseñas no coinciden",
    path: ["confirmPassword"],
  });
