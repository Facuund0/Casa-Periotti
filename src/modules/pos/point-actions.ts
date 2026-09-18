"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/infrastructure/database/supabase-admin";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { createPosSaleSchema } from "./schemas";
import { PointSaleService, type PointSaleStatus } from "./point-sale-service";
import {
  accountInfo,
  diagnose,
  listDevices,
  setOperatingMode,
  type PointProbe,
} from "./point-client";

/**
 * Cobro con la terminal Point desde la venta de mostrador.
 *
 * Tres pasos, porque hay que esperar a que el cliente pase la tarjeta:
 * empezar el cobro, preguntar cómo salió, y cancelar si hace falta. La
 * lógica está en point-sale-service.ts; acá solo se verifica el permiso
 * y se traducen los errores a algo que se pueda leer en pantalla.
 */

const ROLES_QUE_PUEDEN_VENDER = ["ventas", "admin", "super_admin"];
const ROLES_QUE_CONFIGURAN = ["admin", "super_admin"];

export interface PointStartResult {
  error?: string;
  orderId?: string;
  orderNumber?: number;
  total?: number;
}

async function requireSeller() {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_PUEDEN_VENDER.includes(employee.role)) {
    throw new Error("No autorizado para vender en mostrador");
  }
  return employee;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : "No se pudo cobrar con la terminal";
}

/** Manda el monto a la terminal. Todavía no hay venta cobrada. */
export async function startPointSaleAction(input: unknown): Promise<PointStartResult> {
  const employee = await requireSeller();

  const parsed = createPosSaleSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  try {
    const started = await new PointSaleService(createAdminClient()).start(employee, parsed.data);
    return {
      orderId: started.orderId,
      orderNumber: started.orderNumber,
      total: started.total,
    };
  } catch (err) {
    console.error("[startPointSaleAction]", err);
    return { error: message(err) };
  }
}

/**
 * ¿Pasó la tarjeta? Si se cobró, acá se confirma la venta y se factura.
 * La pantalla la llama cada un par de segundos.
 */
export async function checkPointSaleAction(
  orderId: string
): Promise<PointSaleStatus | { status: "error"; reason: string }> {
  const employee = await requireSeller();

  try {
    const result = await new PointSaleService(createAdminClient()).check(employee, orderId);
    if (result.status === "cobrado") revalidatePath("/admin/productos");
    return result;
  } catch (err) {
    console.error("[checkPointSaleAction]", err);
    // Un error de red mirando el estado no cancela nada: la venta sigue
    // esperando en la terminal y la próxima consulta lo resuelve.
    return { status: "error", reason: message(err) };
  }
}

/** El empleado corta el cobro: se saca de la terminal y vuelve el stock. */
export async function cancelPointSaleAction(orderId: string): Promise<{ error?: string; ok?: boolean }> {
  await requireSeller();

  try {
    await new PointSaleService(createAdminClient()).cancel(orderId);
    return { ok: true };
  } catch (err) {
    console.error("[cancelPointSaleAction]", err);
    return { error: message(err) };
  }
}

/**
 * Con qué cuenta de Mercado Pago está hablando el sistema. Solo lee, y
 * sirve para entender de una los errores de permisos.
 */
export async function checkPointCredentialAction(): Promise<{
  account?: { nickname: string | null; email: string | null; isTest: boolean; countryId: string | null };
  error?: string;
}> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_CONFIGURAN.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  try {
    const account = await accountInfo();
    return {
      account: {
        nickname: account.nickname,
        email: account.email,
        isTest: account.isTest,
        countryId: account.countryId,
      },
    };
  } catch (err) {
    console.error("[checkPointCredentialAction]", err);
    return { error: message(err) };
  }
}

/**
 * Qué contesta Mercado Pago en cada puerta que usa la integración. Solo
 * lee, y sirve para saber qué pedirle al soporte.
 */
export async function diagnosePointAction(): Promise<{
  probes?: PointProbe[];
  error?: string;
}> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_CONFIGURAN.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  try {
    return { probes: await diagnose() };
  } catch (err) {
    console.error("[diagnosePointAction]", err);
    return { error: message(err) };
  }
}

export interface PointDeviceOption {
  id: string;
  operatingMode: string;
}

/** Terminales de la cuenta, para elegir la del mostrador. Solo lee. */
export async function listPointDevicesAction(): Promise<{
  devices?: PointDeviceOption[];
  error?: string;
}> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_CONFIGURAN.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  try {
    return { devices: await listDevices() };
  } catch (err) {
    console.error("[listPointDevicesAction]", err);
    return { error: message(err) };
  }
}

/**
 * Pone la terminal en modo integrado. Es el paso que hace que el equipo
 * acepte los montos que le manda el sistema.
 */
export async function setPointModeAction(
  deviceId: string,
  mode: "PDV" | "STANDALONE"
): Promise<{ error?: string; ok?: boolean }> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_CONFIGURAN.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  try {
    await setOperatingMode(deviceId, mode);
    revalidatePath("/admin/configuracion-pago");
    return { ok: true };
  } catch (err) {
    console.error("[setPointModeAction]", err);
    return { error: message(err) };
  }
}
