import { z } from "zod";
import { EMPLOYEE_ROLES } from "./types";

const roleSchema = z.enum(EMPLOYEE_ROLES);

export const createEmployeeSchema = z.object({
  email: z.string().trim().email("Ingresá un email válido"),
  fullName: z.string().trim().min(2, "El nombre es obligatorio"),
  role: roleSchema,
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

export const updateEmployeeRoleSchema = z.object({
  employeeId: z.string().uuid(),
  role: roleSchema,
});

export type UpdateEmployeeRoleInput = z.infer<typeof updateEmployeeRoleSchema>;
