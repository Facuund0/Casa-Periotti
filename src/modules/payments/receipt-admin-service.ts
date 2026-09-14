import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { startOfDayInArgentina, endOfDayInArgentina } from "@/shared/utils/date-range";
import { RECEIPT_BUCKET } from "./transfer-config";
import type { ReceiptFilters } from "./schemas";

export class ReceiptNotFoundError extends Error {
  constructor() {
    super("Comprobante no encontrado");
    this.name = "ReceiptNotFoundError";
  }
}

export class ReceiptAlreadyPurgedError extends Error {
  constructor() {
    super("El archivo de este comprobante ya se había eliminado.");
    this.name = "ReceiptAlreadyPurgedError";
  }
}

export class ReceiptPendingReviewError extends Error {
  constructor() {
    super(
      "Este comprobante todavía está pendiente de revisión. Confirmá o rechazá el pago en Pedidos antes de eliminarlo."
    );
    this.name = "ReceiptPendingReviewError";
  }
}

export type ReceiptReviewStatus = "pending" | "approved" | "rejected";

export interface ReceiptListRow {
  id: string;
  uploadedAt: string;
  orderId: string;
  orderNumber: number | null;
  customerName: string | null;
  amount: number | null;
  reviewStatus: ReceiptReviewStatus;
  rejectionReason: string | null;
  fileMime: string;
  fileSize: number;
  purgedAt: string | null;
  /** Nombre del empleado que borró el archivo, si se puede resolver. */
  purgedByName: string | null;
}

export interface ReceiptListPage {
  rows: ReceiptListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export const RECEIPTS_PAGE_SIZE = 25;

// Tope del set de ids que genera el buscador por nombre de cliente. Un
// panel de un local no llega a estos números, y evita armar un .in()
// gigante si alguien busca una letra sola.
const SEARCH_MATCH_LIMIT = 500;

/**
 * Listado y borrado de comprobantes de transferencia para el panel.
 *
 * Vive aparte de TransferPaymentService a propósito: ese service maneja
 * el flujo del pago (subir, confirmar, rechazar) y no hay que tocarlo
 * para agregar una vista de consulta. Acá solo se lee, se firman URLs y
 * se borra el archivo de Storage.
 *
 * Usa el cliente admin porque el bucket es privado y firmar URLs no pasa
 * por RLS. El chequeo de rol lo hacen las Server Actions y la página
 * antes de llegar acá.
 */
export class ReceiptAdminService {
  constructor(private readonly adminDb: SupabaseClient) {}

  /**
   * Comprobantes ordenados por fecha de subida descendente, paginados.
   *
   * Se hace en varias consultas explícitas en vez de un embed de
   * PostgREST: el número de pedido y el nombre del cliente viven en dos
   * tablas distintas, y resolverlos con Maps sobre los ids de la página
   * (25 filas) es lo mismo que ya hace /admin/pedidos y se lee mucho
   * mejor que filtrar sobre recursos embebidos anidados.
   */
  async list(filters: ReceiptFilters): Promise<ReceiptListPage> {
    const search = filters.q?.trim() || null;

    let matchingOrderIds: string[] | null = null;
    if (search) {
      matchingOrderIds = await this.resolveSearchToOrderIds(search);
      // Búsqueda sin resultados: se corta acá en vez de mandar un
      // .in() con lista vacía, que PostgREST no acepta.
      if (matchingOrderIds.length === 0) {
        return { rows: [], total: 0, page: 1, pageCount: 1, pageSize: RECEIPTS_PAGE_SIZE };
      }
    }

    // El builder se arma en una función porque la consulta puede correr
    // dos veces (ver pedidoDePaginaFueraDeRango abajo) y un builder de
    // PostgREST no se puede reutilizar después de ejecutarlo.
    const buildQuery = (pageNumber: number) => {
      let query = this.adminDb
        .from("payment_receipts")
        .select(
          "id, order_id, uploaded_at, review_status, rejection_reason, file_mime, file_size, purged_at, purged_by",
          { count: "exact" }
        );

      const from = filters.from ? startOfDayInArgentina(filters.from) : null;
      if (from) query = query.gte("uploaded_at", from);

      const to = filters.to ? endOfDayInArgentina(filters.to) : null;
      if (to) query = query.lte("uploaded_at", to);

      if (filters.status) query = query.eq("review_status", filters.status);
      if (matchingOrderIds) query = query.in("order_id", matchingOrderIds);

      const offset = (pageNumber - 1) * RECEIPTS_PAGE_SIZE;
      return query
        .order("uploaded_at", { ascending: false })
        .range(offset, offset + RECEIPTS_PAGE_SIZE - 1);
    };

    let page = filters.page ?? 1;
    let { data, count, error } = await buildQuery(page);

    // Una página que se fue de rango (un link viejo, o filas que se
    // borraron desde que se armó el link) devuelve PGRST103 en vez de
    // una lista vacía. Se muestra la primera página en lugar de tirar un
    // error: el empleado buscaba comprobantes, no un 500.
    if (error?.code === "PGRST103" && page > 1) {
      page = 1;
      ({ data, count, error } = await buildQuery(page));
    }

    if (error) throw new Error(`Error al buscar comprobantes: ${error.message}`);

    const receipts = (data ?? []) as ReceiptRecord[];
    const total = count ?? 0;

    const orderIds = [...new Set(receipts.map((r) => r.order_id))];

    const { data: orders } = orderIds.length
      ? await this.adminDb
          .from("orders")
          .select("id, order_number, total, customer_id")
          .in("id", orderIds)
      : { data: [] as OrderRecord[] };

    const orderById = new Map(((orders ?? []) as OrderRecord[]).map((o) => [o.id, o]));

    const customerIds = [
      ...new Set(
        ((orders ?? []) as OrderRecord[])
          .map((o) => o.customer_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];

    const { data: customers } = customerIds.length
      ? await this.adminDb
          .from("customer_profiles")
          .select("id, full_name")
          .in("id", customerIds)
      : { data: [] as NamedRecord[] };

    const customerNames = new Map(
      ((customers ?? []) as NamedRecord[]).map((c) => [c.id, c.full_name])
    );

    // Quién borró cada archivo: se muestra en el listado para que el
    // registro de la purga sirva de algo sin tener que ir a audit_logs.
    const purgerIds = [
      ...new Set(receipts.map((r) => r.purged_by).filter((id): id is string => Boolean(id))),
    ];

    const { data: purgers } = purgerIds.length
      ? await this.adminDb
          .from("employee_profiles")
          .select("id, full_name")
          .in("id", purgerIds)
      : { data: [] as NamedRecord[] };

    const purgerNames = new Map(((purgers ?? []) as NamedRecord[]).map((e) => [e.id, e.full_name]));

    const rows: ReceiptListRow[] = receipts.map((r) => {
      const order = orderById.get(r.order_id);
      return {
        id: r.id,
        uploadedAt: r.uploaded_at,
        orderId: r.order_id,
        orderNumber: order?.order_number ?? null,
        customerName: order?.customer_id
          ? customerNames.get(order.customer_id) ?? null
          : null,
        amount: order ? Number(order.total) : null,
        reviewStatus: r.review_status,
        rejectionReason: r.rejection_reason,
        fileMime: r.file_mime,
        fileSize: r.file_size,
        purgedAt: r.purged_at,
        purgedByName: r.purged_by ? purgerNames.get(r.purged_by) ?? null : null,
      };
    });

    return {
      rows,
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / RECEIPTS_PAGE_SIZE)),
      pageSize: RECEIPTS_PAGE_SIZE,
    };
  }

  /**
   * URL firmada de vida corta, generada recién cuando el empleado pide
   * ver un comprobante. No se pre-firman las 25 filas de la página a
   * propósito: son 25 llamadas a Storage por render, y deja URLs de
   * archivos que nadie abrió dentro del HTML.
   */
  async getSignedUrl(receiptId: string, expiresInSeconds = 300): Promise<string> {
    const receipt = await this.findReceipt(receiptId);

    if (receipt.purged_at) throw new ReceiptAlreadyPurgedError();

    const { data, error } = await this.adminDb.storage
      .from(RECEIPT_BUCKET)
      .createSignedUrl(receipt.storage_path, expiresInSeconds);

    if (error || !data?.signedUrl) {
      throw new Error(
        `No se pudo generar el link del comprobante${error ? `: ${error.message}` : ""}`
      );
    }
    return data.signedUrl;
  }

  /**
   * Borra el archivo del bucket y deja la fila marcada como purgada.
   *
   * Solo se puede purgar un comprobante de un pedido ya resuelto: si
   * todavía está pendiente de revisión, el empleado que tiene que
   * verificar el pago se quedaría sin el comprobante.
   *
   * El archivo se borra ANTES de marcar la fila. Si falla el marcado,
   * queda una fila sin purged_at apuntando a un archivo que ya no está,
   * y reintentar la eliminación la arregla (borrar un path inexistente
   * en Storage no es un error). Al revés —marcar primero— un fallo al
   * borrar dejaría el archivo vivo en el bucket sin que ninguna vista lo
   * muestre, que es justo lo que hay que evitar.
   */
  async purge(params: { receiptId: string; employeeId: string }): Promise<void> {
    const receipt = await this.findReceipt(params.receiptId);

    if (receipt.purged_at) throw new ReceiptAlreadyPurgedError();
    if (receipt.review_status === "pending") throw new ReceiptPendingReviewError();

    const { data: order } = await this.adminDb
      .from("orders")
      .select("id, status, order_number")
      .eq("id", receipt.order_id)
      .maybeSingle();

    // review_status y el estado del pedido no deberían poder decir cosas
    // distintas, pero si alguna vez divergen la respuesta segura es no
    // borrar: hay un pago esperando que alguien lo mire.
    if (order?.status === "payment_processing") {
      throw new ReceiptPendingReviewError();
    }

    const { error: removeError } = await this.adminDb.storage
      .from(RECEIPT_BUCKET)
      .remove([receipt.storage_path]);

    if (removeError) {
      throw new Error(`No se pudo borrar el archivo del comprobante: ${removeError.message}`);
    }

    const purgedAt = new Date().toISOString();

    const { error: updateError } = await this.adminDb
      .from("payment_receipts")
      .update({ purged_at: purgedAt, purged_by: params.employeeId })
      .eq("id", receipt.id);

    if (updateError) {
      throw new Error(
        `El archivo se borró pero no se pudo registrar la eliminación: ${updateError.message}`
      );
    }

    await this.adminDb.from("audit_logs").insert({
      user_id: params.employeeId,
      action: "purge_payment_receipt",
      entity_type: "payment_receipt",
      entity_id: receipt.id,
      // Lo que había antes queda en el log: es el registro de qué
      // archivo existió, de qué pedido era y cómo se había resuelto.
      data_before: {
        order_id: receipt.order_id,
        order_number: order?.order_number ?? null,
        storage_path: receipt.storage_path,
        file_mime: receipt.file_mime,
        file_size: receipt.file_size,
        uploaded_at: receipt.uploaded_at,
        review_status: receipt.review_status,
      },
      data_after: { purged_at: purgedAt, purged_by: params.employeeId },
    });
  }

  private async findReceipt(receiptId: string): Promise<ReceiptRecord & { storage_path: string }> {
    const { data, error } = await this.adminDb
      .from("payment_receipts")
      .select(
        "id, order_id, uploaded_at, review_status, rejection_reason, file_mime, file_size, purged_at, purged_by, storage_path"
      )
      .eq("id", receiptId)
      .maybeSingle();

    if (error) throw new Error(`Error al buscar el comprobante: ${error.message}`);
    if (!data) throw new ReceiptNotFoundError();
    return data as ReceiptRecord & { storage_path: string };
  }

  /**
   * El buscador acepta un número de pedido o un nombre de cliente. Si lo
   * que se tipeó son solo dígitos se busca por número de pedido (con o
   * sin el prefijo CP- de la referencia de la transferencia); si no, por
   * nombre del cliente.
   */
  private async resolveSearchToOrderIds(search: string): Promise<string[]> {
    const asOrderNumber = search.replace(/^CP-?/i, "").trim();

    if (/^\d+$/.test(asOrderNumber)) {
      const { data } = await this.adminDb
        .from("orders")
        .select("id")
        .eq("order_number", Number(asOrderNumber))
        .limit(SEARCH_MATCH_LIMIT);
      return ((data ?? []) as { id: string }[]).map((o) => o.id);
    }

    const { data: customers } = await this.adminDb
      .from("customer_profiles")
      .select("id")
      .ilike("full_name", `%${escapeLikePattern(search)}%`)
      .limit(SEARCH_MATCH_LIMIT);

    const customerIds = ((customers ?? []) as { id: string }[]).map((c) => c.id);
    if (customerIds.length === 0) return [];

    const { data: orders } = await this.adminDb
      .from("orders")
      .select("id")
      .in("customer_id", customerIds)
      .limit(SEARCH_MATCH_LIMIT);

    return ((orders ?? []) as { id: string }[]).map((o) => o.id);
  }
}

/** % y _ son comodines de LIKE: si los tipeó el usuario, son literales. */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

interface ReceiptRecord {
  id: string;
  order_id: string;
  uploaded_at: string;
  review_status: ReceiptReviewStatus;
  rejection_reason: string | null;
  file_mime: string;
  file_size: number;
  purged_at: string | null;
  purged_by: string | null;
  storage_path?: string;
}

interface OrderRecord {
  id: string;
  order_number: number;
  total: number;
  customer_id: string | null;
}

interface NamedRecord {
  id: string;
  full_name: string;
}
