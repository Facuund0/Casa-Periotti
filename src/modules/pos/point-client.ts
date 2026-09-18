import "server-only";

/**
 * API de Mercado Pago Point: es la que le manda el monto a la terminal
 * del mostrador y después dice cómo salió el cobro.
 *
 * Todo pasa por internet, contra api.mercadopago.com — no hay nada
 * conectado por cable ni ningún programa instalado en la computadora.
 *
 * OJO con la versión de la API. Mercado Pago tiene dos:
 *
 *   - La vieja, `point/integration-api/devices` + `payment-intents`, hoy
 *     documentada como "mp-point-legacy". Las cuentas nuevas la tienen
 *     bloqueada: responde 403 PA_UNAUTHORIZED_RESULT_FROM_POLICIES por
 *     más que la credencial sea válida.
 *   - La actual, que es la que usa este archivo: `/terminals/v1/list`
 *     para los equipos y la API de Orders (`/v1/orders` con
 *     `type: "point"`) para cobrar.
 *
 * Este archivo solo habla HTTP: no crea pedidos, no toca stock y no
 * factura. Las decisiones están en point-sale-service.ts.
 */

const API = "https://api.mercadopago.com";

export interface PointDevice {
  id: string;
  /** "PDV" = integrado con la API. "STANDALONE" = se tipea a mano. */
  operatingMode: string;
  /**
   * Sucursal y caja a las que está asociada. Sin esto el modo integrado
   * no funciona: Mercado Pago acepta el cobro pero no se lo manda al
   * equipo. La asociación se hace desde la app de Mercado Pago en el
   * celular, escaneando el QR que muestra la terminal.
   */
  storeId: string | null;
  posId: string | null;
}

/**
 * Estados de una order de Point, tal como los informa Mercado Pago.
 * Se listan los conocidos, pero cualquier otro se trata como "todavía no
 * se sabe": nunca se confirma una venta por un estado que no entendemos.
 */
export type PointOrderStatus =
  | "created"
  | "at_terminal"
  | "action_required"
  | "processed"
  | "failed"
  | "canceled"
  | "expired"
  | "refunded"
  | (string & {});

export interface PointIntent {
  /** Id de la order en Mercado Pago. */
  id: string;
  state: PointOrderStatus;
  statusDetail: string | null;
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
      // reintento de red. Mercado Pago pide que sea un UUID.
      ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
      ...(rest.headers ?? {}),
    },
    // Nunca cachear: son cobros.
    cache: "no-store",
  });

  const text = await response.text();
  if (!response.ok) {
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
 * Es el diagnóstico que evita adivinar: un error común de esta
 * integración es tener un token de una cuenta distinta a la dueña de la
 * terminal, y eso desde afuera se ve como un 403 sin explicación.
 */
export async function accountInfo(): Promise<PointAccount> {
  const data = await request<{
    id: number;
    nickname?: string;
    email?: string;
    tags?: string[];
    site_id?: string;
    country_id?: string;
  }>("/users/me", { method: "GET" });

  return {
    id: data.id,
    nickname: data.nickname ?? null,
    email: data.email ?? null,
    isTest: (data.tags ?? []).includes("test_user"),
    countryId: data.country_id ?? data.site_id ?? null,
  };
}

export interface PointProbe {
  name: string;
  url: string;
  status: number;
  ok: boolean;
  /**
   * true cuando la puerta no la usa el sistema y se prueba solo para
   * entender el panorama: que dé error ahí no rompe nada.
   */
  informational?: boolean;
  /** Primeros caracteres de la respuesta, para pegárselos al soporte. */
  body: string;
}

/**
 * Prueba de a una las puertas que necesita esta integración y devuelve
 * qué contestó cada una. Un 403 de Mercado Pago no dice qué permiso
 * falta; con esto se ve si el bloqueo es de toda la API o de un recurso.
 *
 * Incluye a propósito la API vieja: si la nueva anda y la vieja da 403,
 * eso confirma que la cuenta está en la versión actual y que no falta
 * ninguna habilitación.
 */
export async function diagnose(): Promise<PointProbe[]> {
  const token = accessToken();
  const targets: { name: string; url: string; informational?: boolean }[] = [
    { name: "Cuenta (a quién pertenece la credencial)", url: `${API}/users/me` },
    { name: "Terminales Point — la que usa el sistema", url: `${API}/terminals/v1/list?limit=50` },
    { name: "Cajas y sucursales", url: `${API}/pos?limit=1` },
    {
      name: "API vieja de Point, que el sistema ya no usa",
      url: `${API}/point/integration-api/devices?limit=1`,
      informational: true,
    },
  ];

  const probes: PointProbe[] = [];
  for (const target of targets) {
    try {
      const response = await fetch(target.url, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const body = await response.text();
      probes.push({
        name: target.name,
        url: target.url,
        status: response.status,
        ok: response.ok,
        informational: target.informational,
        body: body.slice(0, 200),
      });
    } catch (err) {
      probes.push({
        name: target.name,
        url: target.url,
        status: 0,
        ok: false,
        informational: target.informational,
        body: err instanceof Error ? err.message : "no se pudo consultar",
      });
    }
  }
  return probes;
}

/** Las terminales de la cuenta, para elegir cuál usa el mostrador. */
export async function listDevices(): Promise<PointDevice[]> {
  const data = await request<TerminalsPayload>("/terminals/v1/list?limit=50&offset=0", {
    method: "GET",
  });

  // La respuesta viene envuelta distinto según la versión: se aceptan las
  // dos formas en vez de romperse si cambia el envoltorio.
  const terminals = data.data?.terminals ?? data.terminals ?? [];
  return terminals.map((terminal) => ({
    id: terminal.id,
    operatingMode: terminal.operating_mode ?? "STANDALONE",
    storeId: terminal.store_id != null ? String(terminal.store_id) : null,
    posId: terminal.pos_id != null ? String(terminal.pos_id) : null,
  }));
}

/**
 * Cómo está configurada una terminal, o null si la cuenta no la lista.
 *
 * Se consulta ANTES de cobrar: si el equipo está en modo autónomo,
 * Mercado Pago acepta la orden igual pero nunca se la manda a la
 * terminal — queda en estado "created" para siempre y en el mostrador
 * parece que el sistema no hizo nada.
 */
export async function terminalInfo(deviceId: string): Promise<PointDevice | null> {
  const devices = await listDevices();
  return devices.find((d) => d.id === deviceId) ?? null;
}

/**
 * Pone la terminal en modo integrado (PDV). Sin esto, el equipo no
 * acepta los montos que le manda el sistema.
 */
export async function setOperatingMode(
  deviceId: string,
  mode: "PDV" | "STANDALONE"
): Promise<void> {
  await request("/terminals/v1/setup", {
    method: "PATCH",
    body: JSON.stringify({ terminals: [{ id: deviceId, operating_mode: mode }] }),
  });
}

/**
 * Le manda el monto a la terminal creando una order de Point. No se fija
 * el tipo de pago a propósito: débito, crédito y cuotas los elige el
 * cliente en el equipo, que es como se cobra hoy en el mostrador.
 */
export async function createIntent(params: {
  deviceId: string;
  amount: number;
  description: string;
  orderId: string;
  ticketNumber?: string;
}): Promise<PointIntent> {
  const data = await request<PointOrderPayload>("/v1/orders", {
    method: "POST",
    // El id del pedido es un UUID y sirve de clave: si esta llamada se
    // repite, Mercado Pago no le manda dos cobros a la terminal.
    idempotencyKey: params.orderId,
    body: JSON.stringify({
      type: "point",
      external_reference: params.orderId,
      // Si el cliente no paga, la order vence sola y el stock se libera.
      expiration_time: "PT10M",
      description: params.description.slice(0, 80),
      transactions: {
        // Monto en pesos con dos decimales, como string (no en centavos).
        payments: [{ amount: params.amount.toFixed(2) }],
      },
      config: {
        point: {
          terminal_id: params.deviceId,
          ...(params.ticketNumber ? { ticket_number: params.ticketNumber } : {}),
        },
      },
    }),
  });
  return mapOrder(data);
}

/** Cómo viene saliendo el cobro. */
export async function getIntent(orderId: string): Promise<PointIntent> {
  const data = await request<PointOrderPayload>(`/v1/orders/${encodeURIComponent(orderId)}`, {
    method: "GET",
  });
  return mapOrder(data);
}

/**
 * Saca el monto de la terminal (el empleado canceló la venta). Solo se
 * puede mientras el cliente no haya empezado a pagar.
 *
 * deviceId ya no hace falta en esta versión de la API, pero se mantiene
 * en la firma porque es lo que tiene guardado cada cobro.
 */
export async function cancelIntent(_deviceId: string, orderId: string): Promise<void> {
  await request(`/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
    idempotencyKey: orderId,
  });
}

/**
 * Traduce los errores de Mercado Pago a algo que se pueda leer en el
 * mostrador. El resto se deja tal cual: es mejor un mensaje técnico que
 * uno inventado.
 */
export function readableError(message: string): string {
  if (message.includes("already_queued_order_on_terminal")) {
    return "La terminal ya tiene otro cobro esperando. Cancelalo en el equipo y volvé a intentar.";
  }
  if (message.includes("terminal_not_found") || message.includes("device_not_found")) {
    return "Mercado Pago no encuentra esa terminal. Revisá que esté prendida, con internet y con la sesión iniciada.";
  }
  if (message.includes("invalid_operating_mode")) {
    return "La terminal está en modo autónomo: ponela en modo integrado en Configuración de pago.";
  }
  return message;
}

/** true si el cobro se hizo y se puede confirmar la venta. */
export function isPaid(intent: PointIntent): boolean {
  return intent.state === "processed";
}

/** true si ya no va a cobrarse: hay que liberar la reserva de stock. */
export function isDead(intent: PointIntent): boolean {
  return ["failed", "canceled", "expired", "refunded"].includes(intent.state);
}

/**
 * Qué mostrarle al empleado mientras espera. La diferencia entre
 * "created" y "at_terminal" importa: en el primero Mercado Pago tiene el
 * cobro pero la terminal todavía no lo tomó, y eso casi siempre se
 * arregla en el equipo (tocar Cobrar, o revisar el modo y el internet).
 */
export function waitingLabel(state: PointOrderStatus): string {
  if (state === "at_terminal") return "El monto está en la terminal: pasá la tarjeta";
  if (state === "action_required") return "La terminal está esperando el pago…";
  return "Esperando que la terminal tome el cobro…";
}

interface TerminalRow {
  id: string;
  operating_mode?: string;
  store_id?: string | number;
  pos_id?: string | number;
}

interface TerminalsPayload {
  terminals?: TerminalRow[];
  data?: { terminals?: TerminalRow[] };
}

interface PointOrderPayload {
  id: string | number;
  status?: string;
  status_detail?: string;
  transactions?: {
    payments?: {
      id?: string | number;
      status?: string;
      status_detail?: string;
      payment_method?: {
        type?: string;
        installments?: number;
      };
    }[];
  };
}

function mapOrder(data: PointOrderPayload): PointIntent {
  const payment = data.transactions?.payments?.[0];
  return {
    id: String(data.id),
    state: (data.status ?? "created") as PointOrderStatus,
    statusDetail: data.status_detail ?? null,
    paymentId: payment?.id != null ? String(payment.id) : null,
    paymentType: payment?.payment_method?.type ?? null,
    installments: payment?.payment_method?.installments ?? null,
  };
}
