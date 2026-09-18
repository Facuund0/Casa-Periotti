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
  readableError,
  setOperatingMode,
  type PointProbe,
} from "./point-client";
import {
  createPos,
  createStore,
  externalId,
  geocodeAddress,
  listPos,
  listStores,
  MpLocationValueError,
  type GeocodeResult,
  type PointPos,
  type PointStore,
} from "./point-stores";

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
  return err instanceof Error
    ? readableError(err.message)
    : "No se pudo cobrar con la terminal";
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

/**
 * Cierra los cobros con Point que quedaron abiertos: le pregunta a
 * Mercado Pago por cada uno y, si la tarjeta se cobró, confirma la venta;
 * si no, saca el monto de la terminal y libera el stock.
 *
 * Lo mismo que hace el cron, pero a pedido: sirve después de una prueba
 * o cuando quedó un cobro dando vueltas y no se quiere esperar.
 */
export async function resolveStalePointChargesAction(): Promise<{
  result?: { checked: number; settled: number; released: number; failed: number };
  error?: string;
}> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_CONFIGURAN.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  try {
    // 0 minutos: todos los que estén sin resolver, sin esperar la ventana.
    const result = await new PointSaleService(createAdminClient()).resolveStale(0, employee);
    revalidatePath("/admin/productos");
    revalidatePath("/admin/configuracion-pago");
    return { result };
  } catch (err) {
    console.error("[resolveStalePointChargesAction]", err);
    return { error: message(err) };
  }
}

/** Sucursales y cajas que ya existen en la cuenta. Solo lee. */
export async function listPointStoresAction(): Promise<{
  stores?: PointStore[];
  pos?: PointPos[];
  error?: string;
}> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_CONFIGURAN.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  try {
    const [stores, pos] = await Promise.all([listStores(), listPos()]);
    return { stores, pos };
  } catch (err) {
    console.error("[listPointStoresAction]", err);
    return { error: message(err) };
  }
}

/** Coordenadas de una dirección, para no buscarlas a mano en un mapa. */
export async function geocodeAddressAction(
  query: string
): Promise<{ results?: GeocodeResult[]; error?: string }> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_CONFIGURAN.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const text = query.trim();
  if (text.length < 5) return { error: "Escribí la dirección completa (calle, número y ciudad)." };

  try {
    const results = await geocodeAddress(text);
    if (!results.length) {
      return {
        error:
          "No se encontró esa dirección. Probá sin el número, o con el nombre completo de la calle.",
      };
    }
    return { results };
  } catch (err) {
    console.error("[geocodeAddressAction]", err);
    return { error: message(err) };
  }
}

/**
 * Crea la sucursal y su caja de una sola vez: es lo que la terminal
 * necesita tener antes de poder asociarse.
 */
export async function createPointStoreAction(input: {
  storeName: string;
  streetName: string;
  streetNumber: string;
  cityName: string;
  stateName: string;
  latitude: number;
  longitude: number;
  posName: string;
}): Promise<{
  store?: PointStore;
  pos?: PointPos;
  error?: string;
  /** Valores que sí acepta Mercado Pago, para elegir uno y reintentar. */
  options?: { field: "city" | "state"; values: string[] };
}> {
  const employee = await getCurrentEmployee();
  if (!employee || !ROLES_QUE_CONFIGURAN.includes(employee.role)) {
    return { error: "No autorizado" };
  }

  const faltan = (
    [
      ["nombre de la sucursal", input.storeName],
      ["calle", input.streetName],
      ["número", input.streetNumber],
      ["ciudad", input.cityName],
      ["provincia", input.stateName],
    ] as const
  )
    .filter(([, value]) => !String(value ?? "").trim())
    .map(([label]) => label);
  if (faltan.length) return { error: `Faltan datos: ${faltan.join(", ")}.` };

  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
    return { error: "Faltan las coordenadas: buscalas con el botón o cargalas a mano." };
  }

  // Identificadores propios, para reconocerlas después en Mercado Pago.
  // Solo letras y números: la API rechaza guiones y símbolos.
  const stamp = Date.now().toString(36).toUpperCase().slice(-4);
  const slug = externalId(input.storeName.slice(0, 20), stamp);

  try {
    const store = await createStore({
      name: input.storeName.trim(),
      externalId: slug,
      location: {
        streetName: input.streetName.trim(),
        streetNumber: input.streetNumber.trim(),
        cityName: input.cityName.trim(),
        stateName: input.stateName.trim(),
        latitude: input.latitude,
        longitude: input.longitude,
      },
    });

    const pos = await createPos({
      name: input.posName.trim() || "Caja 1",
      storeId: store.id,
      externalId: externalId(slug, "CAJA1"),
    });

    revalidatePath("/admin/configuracion-pago");
    return { store, pos };
  } catch (err) {
    console.error("[createPointStoreAction]", err);
    if (err instanceof MpLocationValueError) {
      return {
        error:
          err.field === "city"
            ? `Mercado Pago no acepta "${input.cityName}" como ciudad. Elegí una de las que sí acepta.`
            : `Mercado Pago no acepta "${input.stateName}" como provincia. Elegí una de las que sí acepta.`,
        options: { field: err.field, values: err.values },
      };
    }
    return { error: message(err) };
  }
}

export interface PointDeviceOption {
  id: string;
  operatingMode: string;
  storeId: string | null;
  posId: string | null;
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
