import "server-only";
import { accountInfo, mpRequest, PointApiError } from "./point-client";

/**
 * Sucursales y cajas de Mercado Pago.
 *
 * Por qué existen: para que la terminal Point funcione en modo integrado
 * tiene que estar asociada a una sucursal (la tienda física) y a una caja
 * (el punto de venta dentro de esa tienda). Sin eso, Mercado Pago acepta
 * el cobro y nunca se lo manda al equipo — el error más difícil de
 * diagnosticar de toda la integración, porque no avisa nada.
 *
 * Una caja admite UNA terminal en modo integrado: con dos equipos hacen
 * falta dos cajas.
 *
 * Lo único que NO se puede hacer desde acá es la asociación en sí: eso se
 * hace desde la app de Mercado Pago en el celular, escaneando el QR que
 * muestra la terminal. Este archivo deja todo listo para ese paso.
 */

/**
 * Mercado Pago valida la ciudad y la provincia contra una lista cerrada
 * y, cuando rechaza, DEVUELVE esa lista en el mensaje de error. No hay
 * ningún endpoint que la publique, así que esa respuesta es la única
 * fuente confiable: se parsea para poder ofrecerla en pantalla en vez de
 * hacer adivinar al empleado.
 *
 * Ojo con las expectativas: la lista no son todas las localidades del
 * país. Para Santa Fe, por ejemplo, trae 49 valores y "Sunchales" no
 * está, pero sí "Castellanos", que es su departamento. Lo que ubica el
 * local son las coordenadas; esto es la referencia administrativa que
 * usa Mercado Pago.
 */
export class MpLocationValueError extends Error {
  constructor(
    readonly field: "city" | "state",
    readonly values: string[]
  ) {
    super(
      field === "city"
        ? "Mercado Pago no acepta ese nombre de ciudad."
        : "Mercado Pago no acepta ese nombre de provincia."
    );
    this.name = "MpLocationValueError";
  }
}

/** Saca la lista de valores válidos de la respuesta de error, si está. */
function parseValidValues(error: unknown): MpLocationValueError | null {
  if (!(error instanceof PointApiError)) return null;
  // El cuerpo completo, no el mensaje: la lista es larga y el mensaje se
  // corta para los logs.
  const text = error.body || error.message;

  const field = text.includes("location.city_name")
    ? "city"
    : text.includes("location.state_name")
      ? "state"
      : null;
  if (!field) return null;

  const match = /Valid values are:\s*([^"]+)/.exec(text);
  if (!match) return null;

  const values = match[1]
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length ? new MpLocationValueError(field, values) : null;
}

/**
 * Mercado Pago rechaza los identificadores externos con guiones u otros
 * símbolos: solo letras y números.
 */
export function externalId(...parts: string[]): string {
  return parts
    .join("")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 40);
}

export interface StoreLocationInput {
  streetName: string;
  streetNumber: string;
  cityName: string;
  stateName: string;
  latitude: number;
  longitude: number;
  reference?: string;
}

export interface PointStore {
  id: string;
  name: string;
  externalId: string | null;
  addressLine: string | null;
}

export interface PointPos {
  id: string;
  name: string | null;
  storeId: string | null;
  externalId: string | null;
  status: string | null;
}

/** Sucursales ya creadas en la cuenta. */
export async function listStores(): Promise<PointStore[]> {
  const account = await accountInfo();
  const data = await mpRequest<{
    results?: {
      id: string | number;
      name?: string;
      external_id?: string;
      location?: { address_line?: string };
    }[];
  }>(`/users/${account.id}/stores/search?limit=50`, { method: "GET" });

  return (data.results ?? []).map((s) => ({
    id: String(s.id),
    name: s.name ?? "(sin nombre)",
    externalId: s.external_id ?? null,
    addressLine: s.location?.address_line ?? null,
  }));
}

/** Cajas ya creadas en la cuenta. */
export async function listPos(): Promise<PointPos[]> {
  const data = await mpRequest<{
    results?: {
      id: string | number;
      name?: string;
      store_id?: string | number;
      external_id?: string;
      status?: string;
    }[];
  }>("/pos?limit=50", { method: "GET" });

  return (data.results ?? []).map((p) => ({
    id: String(p.id),
    name: p.name ?? null,
    storeId: p.store_id != null ? String(p.store_id) : null,
    externalId: p.external_id ?? null,
    status: p.status ?? null,
  }));
}

/**
 * Crea la sucursal. La ubicación va con datos reales a propósito:
 * Mercado Pago advierte que una ubicación equivocada puede afectar el
 * cálculo de impuestos de las ventas hechas ahí.
 */
export async function createStore(params: {
  name: string;
  externalId: string;
  location: StoreLocationInput;
}): Promise<PointStore> {
  const account = await accountInfo();
  const body = JSON.stringify({
    name: params.name,
    external_id: params.externalId,
    location: {
      street_name: params.location.streetName,
      street_number: params.location.streetNumber,
      city_name: params.location.cityName,
      state_name: params.location.stateName,
      latitude: params.location.latitude,
      longitude: params.location.longitude,
      ...(params.location.reference ? { reference: params.location.reference } : {}),
    },
  });

  let data: {
    id: string | number;
    name?: string;
    external_id?: string;
    location?: { address_line?: string };
  };
  try {
    data = await mpRequest(`/users/${account.id}/stores`, { method: "POST", body });
  } catch (err) {
    // Si el rechazo trae la lista de valores aceptados, se propaga como
    // un error que la pantalla puede convertir en opciones para elegir.
    const known = parseValidValues(err);
    if (known) throw known;
    throw err;
  }

  return {
    id: String(data.id),
    name: data.name ?? params.name,
    externalId: data.external_id ?? params.externalId,
    addressLine: data.location?.address_line ?? null,
  };
}

/** Crea la caja dentro de una sucursal. */
export async function createPos(params: {
  name: string;
  storeId: string;
  externalId: string;
}): Promise<PointPos> {
  const data = await mpRequest<{
    id: string | number;
    name?: string;
    store_id?: string | number;
    external_id?: string;
    status?: string;
  }>("/v2/pos", {
    method: "POST",
    // Clave única derivada del identificador externo: si la llamada se
    // repite, no se crean dos cajas iguales.
    idempotencyKey: `pos-${params.externalId}`,
    body: JSON.stringify({
      name: params.name,
      store_id: params.storeId,
      external_id: params.externalId,
    }),
  });

  return {
    id: String(data.id),
    name: data.name ?? params.name,
    storeId: data.store_id != null ? String(data.store_id) : params.storeId,
    externalId: data.external_id ?? params.externalId,
    status: data.status ?? null,
  };
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  /** Lo que entendió el buscador, para poder confirmarlo a ojo. */
  label: string;
}

/**
 * Busca las coordenadas de una dirección, así nadie tiene que sacarlas
 * de Google Maps a mano.
 *
 * Usa Nominatim (el buscador de OpenStreetMap), que es gratuito y no
 * necesita credenciales. Pide identificarse con un User-Agent y no
 * abusar del servicio: acá se llama solo cuando alguien toca el botón, y
 * el resultado se guarda en Mercado Pago, no se vuelve a consultar.
 */
export async function geocodeAddress(query: string): Promise<GeocodeResult[]> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "ar");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "casa-periotti-admin/1.0 (panel interno)",
      "Accept-Language": "es",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`El buscador de direcciones respondió ${response.status}`);
  }

  const results = (await response.json()) as { lat: string; lon: string; display_name: string }[];
  return results.map((r) => ({
    latitude: Number(r.lat),
    longitude: Number(r.lon),
    label: r.display_name,
  }));
}
