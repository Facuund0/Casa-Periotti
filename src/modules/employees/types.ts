export const EMPLOYEE_ROLES = [
  "super_admin",
  "admin",
  "ventas",
  "stock",
  "facturacion",
] as const;

export type EmployeeRole = (typeof EMPLOYEE_ROLES)[number];

export const EMPLOYEE_ROLE_LABELS: Record<EmployeeRole, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  ventas: "Ventas",
  stock: "Stock",
  facturacion: "Facturación",
};

export interface Employee {
  id: string;
  fullName: string;
  role: EmployeeRole;
  active: boolean;
}
