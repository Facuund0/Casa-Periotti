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
 * Usuario de la sesión, con la firma del token verificada (getClaims). El
 * proyecto firma las sesiones con claves asimétricas (ES256), así que la
 * verificación se hace acá con la clave pública, sin ir al servidor de
 * Auth en cada página. Que el empleado siga ACTIVO se consulta igual en
 * la base en cada pedido (getCurrentEmployee), y la RLS sigue aplicando.
 *
 * `cache` de React: dentro de un mismo render (layout + página + otros
 * componentes) la consulta se hace una sola vez y se comparte, en vez de
 * repetirse en cada uno. Cada pedido nuevo vuelve a verificar. Fuera de
 * un render (Server Actions, route handlers) no cachea nada.
 */
const getAuthUser = cache(async (): Promise<{ id: string } | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const id = data?.claims?.sub;
  return !error && typeof id === "string" ? { id } : null;
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
