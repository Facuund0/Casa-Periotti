import { createClient } from "@/infrastructure/database/supabase-server";
import type { CustomerType } from "@/modules/products/types";
import type { IvaCondition } from "@/modules/billing/billing-service";

export interface CurrentCustomer {
  id: string;
  fullName: string;
  email: string;
  customerType: CustomerType;
  cuitDni: string | null;
  ivaCondition: IvaCondition;
}

export interface CurrentEmployee {
  id: string;
  fullName: string;
  role: "super_admin" | "admin" | "ventas" | "stock" | "facturacion";
}

/** Devuelve el cliente logueado, o null si no hay sesión / es un empleado. */
export async function getCurrentCustomer(): Promise<CurrentCustomer | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("customer_profiles")
    .select("id, full_name, email, customer_type, cuit_dni, iva_condition")
    .eq("id", user.id)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    fullName: data.full_name,
    email: data.email,
    customerType: data.customer_type as CustomerType,
    cuitDni: data.cuit_dni,
    ivaCondition: (data.iva_condition as IvaCondition) ?? "consumidor_final",
  };
}

/** Devuelve el empleado logueado, o null si no hay sesión / es un cliente. */
export async function getCurrentEmployee(): Promise<CurrentEmployee | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("employee_profiles")
    .select("id, full_name, role, active")
    .eq("id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!data) return null;
  return { id: data.id, fullName: data.full_name, role: data.role };
}
