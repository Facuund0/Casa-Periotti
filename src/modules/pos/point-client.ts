import "server-only";

/**
 * API de Mercado Pago Point: es la que le manda el monto a la terminal
 * del mostrador y después dice cómo salió el cobro.
 *
 * Todo pasa por internet, contra api.mercadopago.com — no hay nada
 * conectado por cable ni ningún programa instalado en la computadora.
 * Usa el MISMO access token que ya usa el resto de Mercado Pago.
 *
 * Este archivo solo habla HTTP: no crea pedidos, no toca stock y no
 * factura. Las decisiones están en point-sale-service.ts.
 */

const API = "https://api.mercadopago.com/point/integration-api";

/** Los montos viajan en centavos: $ 1.210,50 son 121050. */
export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export interface PointDevice {
  id: string;
  /** "PDV" = integrado con la API. "STANDALONE" = se tipea a mano. */
  operatingMode: string;
}

/**
 * Estados que informa Mercado Pago. Se listan los conocidos, pero
 * cualquier otro se trata como "todavía no se sabe": nunca se confirma
 * una venta por un estado que no entendemos.
 */
export type PointIntentState =
  | "OPEN"
  | "ON_TERMINAL"
  | "PROCESSED"
  | "FINISHED"
  | "CANCELED"
  | "ERROR"
  | "EXPIRED"
  | "ABANDONED"
  | (string & {});

export interface PointIntent {
  id: string;
  state: PointIntentState;
  deviceId: string | null;
  /** Presente cuando el cobro se hizo: es el pago en Mercado Pago. */
  paymentId: string | null;
  /** "credit_card", "debit_card", etc. */
  paymentType: string | null;
  installments: number | null;
}

export class PointNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PointNotConfiguredError";
  }
}

export class PointApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "PointApiError";
  }
}

function accessToken(): string {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) {
    throw new PointNotConfiguredError(
      "Falta MERCADOPAGO_ACCESS_TOKEN: sin esa credencial no se puede hablar con la terminal."
    );
  }
  return token;
}

async function request<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {}
): Promise<T> {
  const { idempotencyKey, ...rest } = init;

  const response = await fetch(`${API}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
      // Evita cobrar dos veces si la misma llamada se repite por un
      // reintento de red.
      ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
      ...(rest.headers ?? {}),
    },
    // Nunca cachear: son cobros.
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
    // El mensaje de Mercado Pago sirve para entender qué pasó; se corta
    // para no volcar una respuesta enorme en un log.
    throw new PointApiError(
      `Mercado Pago respondió ${response.status}: ${text.slice(0, 300)}`,
      response.status
    );
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export interface PointAccount {
  id: number;
  nickname: string | null;
  email: string | null;
  /** true si es un usuario de prueba: esos nunca tienen terminales reales. */
  isTest: boolean;
  countryId: string | null;
}

/**
 * De qué cuenta de Mercado Pago es la credencial cargada.
 *
 * Es el diagnóstico que evita adivinar: el error más común de esta
 * integración es tener un token de una cuenta distinta a la dueña de la
 * terminal, y eso desde afuera se ve como un 403 sin explicación.
 */
export async function accountInfo(): Promise<PointAccount> {
  const response = await fetch("https://api.mercadopago.com/users/me", {
    headers: { Authorization: `Bearer ${accessToken()}` },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new PointApiError(
      `Mercado Pago respondió ${response.status} al verificar la credencial: ${text.slice(0, 200)}`,
      response.status
    );
  }
  const data = JSON.parse(text) as {
    id: number;
    nickname?: string;
    email?: string;
    tags?: string[];
    site_id?: string;
    country_id?: string;
  };
  return {
    id: data.id,
    nickname: data.nickname ?? null,
    email: data.email ?? null,
    isTest: (data.tags ?? []).includes("test_user"),
    countryId: data.country_id ?? data.site_id ?? null,
  };
}

/** Las terminales de la cuenta, para elegir cuál usa el mostrador. */
export async function listDevices(): Promise<PointDevice[]> {
  const data = await request<{
    devices?: { id: string; operating_mode?: string }[];
  }>("/devices?limit=50", { method: "GET" });

  return (data.devices ?? []).map((d) => ({
    id: d.id,
    operatingMode: d.operating_mode ?? "STANDALONE",
  }));
}

/**
 * Pone la terminal en modo integrado (PDV). Sin esto, el equipo no
 * acepta los montos que le manda el sistema.
 */
export async function setOperatingMode(
  deviceId: string,
  mode: "PDV" | "STANDALONE"
): Promise<void> {
  await request(`/devices/${encodeURIComponent(deviceId)}`, {
    method: "PATCH",
    body: JSON.stringify({ operating_mode: mode }),
  });
}

/**
 * Le manda el monto a la terminal. No se fija el tipo de pago a
 * propósito: débito, crédito y cuotas los elige el cliente en el equipo,
 * que es como se cobra hoy en el mostrador.
 */
export async function createIntent(params: {
  deviceId: string;
  amount: number;
  description: string;
  orderId: string;
  ticketNumber?: string;
}): Promise<PointIntent> {
  const data = await request<PointIntentPayload>(
    `/devices/${encodeURIComponent(params.deviceId)}/payment-intents`,
    {
      method: "POST",
      // El id del pedido como clave: si esta llamada se repite, Mercado
      // Pago no le manda dos cobros a la terminal.
      idempotencyKey: `point-${params.orderId}`,
      body: JSON.stringify({
        amount: toCents(params.amount),
        description: params.description.slice(0, 80),
        additional_info: {
          external_reference: params.orderId,
          ...(params.ticketNumber ? { ticket_number: params.ticketNumber } : {}),
          // El cupón lo imprime la terminal, como siempre.
          print_on_terminal: true,
        },
      }),
    }
  );
  return mapIntent(data);
}

/** Cómo viene saliendo el cobro. */
export async function getIntent(intentId: string): Promise<PointIntent> {
  const data = await request<PointIntentPayload>(
    `/payment-intents/${encodeURIComponent(intentId)}`,
    { method: "GET" }
  );
  return mapIntent(data);
}

/** Saca el monto de la terminal (el empleado canceló la venta). */
export async function cancelIntent(deviceId: string, intentId: string): Promise<void> {
  await request(
    `/devices/${encodeURIComponent(deviceId)}/payment-intents/${encodeURIComponent(intentId)}`,
    { method: "DELETE" }
  );
}

/** true si el cobro se hizo y se puede confirmar la venta. */
export function isPaid(intent: PointIntent): boolean {
  return (
    (intent.state === "FINISHED" || intent.state === "PROCESSED") && Boolean(intent.paymentId)
  );
}

/** true si ya no va a cobrarse: hay que liberar la reserva de stock. */
export function isDead(intent: PointIntent): boolean {
  return ["CANCELED", "ERROR", "EXPIRED", "ABANDONED"].includes(intent.state);
}

interface PointIntentPayload {
  id: string;
  state?: string;
  device_id?: string;
  payment?: {
    id?: string | number;
    type?: string;
    installments?: number;
  };
}

function mapIntent(data: PointIntentPayload): PointIntent {
  return {
    id: String(data.id),
    state: (data.state ?? "OPEN") as PointIntentState,
    deviceId: data.device_id ?? null,
    paymentId: data.payment?.id != null ? String(data.payment.id) : null,
    paymentType: data.payment?.type ?? null,
    installments: data.payment?.installments ?? null,
  };
}
