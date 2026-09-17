import { cache } from "react";
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

/**
 * Usuario de la sesión, validado contra el servidor de Auth de Supabase
 * (getUser, no solo leer la cookie): es la verificación real, la que
 * decide el acceso a datos. El proxy solo hace un chequeo optimista.
 *
 * `cache` de React: dentro de un mismo render (layout + página + otros
 * componentes) la consulta se hace una sola vez y se comparte, en vez de
 * repetirse en cada uno. Cada pedido nuevo vuelve a verificar. Fuera de
 * un render (Server Actions, route handlers) no cachea nada.
 */
const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/** true si hay una sesión válida, sea cliente o empleado. */
export async function isLoggedIn(): Promise<boolean> {
  return Boolean(await getAuthUser());
}

/** Devuelve el cliente logueado, o null si no hay sesión / es un empleado. */
export const getCurrentCustomer = cache(async (): Promise<CurrentCustomer | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();

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
});

/**
 * Devuelve el empleado ACTIVO logueado, o null si no hay sesión / es un
 * cliente / está desactivado. Es el chequeo que protege cada página y cada
 * acción del panel; se consulta la tabla en cada pedido, así desactivar a
 * un empleado le corta el acceso de inmediato.
 */
export const getCurrentEmployee = cache(async (): Promise<CurrentEmployee | null> => {
  const user = await getAuthUser();
  if (!user) return null;
  const supabase = await createClient();

  const { data } = await supabase
    .from("employee_profiles")
    .select("id, full_name, role, active")
    .eq("id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!data) return null;
  return { id: data.id, fullName: data.full_name, role: data.role };
});
