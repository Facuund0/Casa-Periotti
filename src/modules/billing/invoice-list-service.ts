import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { startOfDayInArgentina, endOfDayInArgentina } from "@/shared/utils/date-range";

/**
 * Agrupación de estados que se ofrece en el filtro de /admin/facturacion.
 *
 * El enum invoice_status tiene seis valores, pero tres de ellos son
 * variantes de "todavía no está resuelta": una factura en `processing` o
 * en `retry_pending` es, para quien mira el listado, una factura
 * pendiente. Si "Pendiente" filtrara solo por `status = 'pending'`, esas
 * filas desaparecerían del listado justo cuando son las que hay que
 * mirar.
 */
export const INVOICE_STATUS_GROUPS = {
  authorized: ["authorized"],
  pending: ["pending", "processing", "retry_pending"],
  rejected: ["rejected"],
  cancelled: ["cancelled"],
} as const;

export type InvoiceStatusGroup = keyof typeof INVOICE_STATUS_GROUPS;

/**
 * Filtros del listado, tal como llegan de la query string. Cada campo
 * usa .catch(undefined) para que un valor inválido en la URL se ignore
 * en vez de romper la página con un 500.
 */
export const invoiceFiltersSchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .catch(undefined),
  status: z
    .enum(["authorized", "pending", "rejected", "cancelled"])
    .optional()
    .catch(undefined),
  q: z.string().trim().max(80).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).optional().catch(undefined),
});

export type InvoiceListFilters = z.infer<typeof invoiceFiltersSchema>;

export interface InvoiceListRow {
  id: string;
  invoiceType: string | null;
  salesPoint: number | null;
  voucherNumber: number | null;
  cae: string | null;
  status: string;
  total: number;
  customerName: string;
  buyerIvaCondition: string | null;
  environment: string | null;
  createdAt: string;
  rejectionReason: string | null;
  padronVerified: boolean | null;
  padronNote: string | null;
}

export interface InvoiceListPage {
  rows: InvoiceListRow[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export const INVOICES_PAGE_SIZE = 25;

const SELECT_COLUMNS =
  "id, invoice_type, sales_point, voucher_number, cae, status, total, customer_name, buyer_iva_condition, environment, created_at, rejection_reason, padron_verified, padron_note";

/**
 * Consulta del listado de facturas del panel. Solo lee: la emisión y los
 * reintentos siguen viviendo en BillingService, que no se toca.
 */
export class InvoiceListService {
  constructor(private readonly db: SupabaseClient) {}

  async list(filters: InvoiceListFilters): Promise<InvoiceListPage> {
    // El builder se arma en una función porque la consulta puede correr
    // dos veces (página fuera de rango, ver abajo) y un builder de
    // PostgREST no se puede reutilizar después de ejecutarlo.
    const buildQuery = (pageNumber: number) => {
      let query = this.db.from("invoices").select(SELECT_COLUMNS, { count: "exact" });

      const from = filters.from ? startOfDayInArgentina(filters.from) : null;
      if (from) query = query.gte("created_at", from);

      const to = filters.to ? endOfDayInArgentina(filters.to) : null;
      if (to) query = query.lte("created_at", to);

      if (filters.status) {
        query = query.in("status", [...INVOICE_STATUS_GROUPS[filters.status]]);
      }

      const search = filters.q?.trim();
      if (search) {
        // El buscador acepta un nombre de cliente o un número de
        // comprobante. Con dígitos se buscan las dos cosas a la vez (el
        // número de comprobante y el nombre, por si alguien busca un
        // cliente cuyo nombre incluye números): el término es solo
        // numérico, así que no hay nada que escapar dentro del or().
        // Con texto alcanza el ilike sobre el nombre.
        const digits = search.replace(/\D/g, "");
        if (/^\d+$/.test(search) && digits.length > 0) {
          query = query.or(`voucher_number.eq.${digits},customer_name.ilike.*${digits}*`);
        } else {
          query = query.ilike("customer_name", `%${escapeLikePattern(search)}%`);
        }
      }

      const offset = (pageNumber - 1) * INVOICES_PAGE_SIZE;
      return query
        .order("created_at", { ascending: false })
        .range(offset, offset + INVOICES_PAGE_SIZE - 1);
    };

    let page = filters.page ?? 1;
    let { data, count, error } = await buildQuery(page);

    // Una página que se fue de rango (un link viejo, o filas que ya no
    // están) devuelve PGRST103 en vez de una lista vacía. Se muestra la
    // primera página en lugar de tirar un error.
    if (error?.code === "PGRST103" && page > 1) {
      page = 1;
      ({ data, count, error } = await buildQuery(page));
    }

    if (error) throw new Error(`Error al buscar facturas: ${error.message}`);

    const total = count ?? 0;

    return {
      rows: ((data ?? []) as InvoiceRecord[]).map((inv) => ({
        id: inv.id,
        invoiceType: inv.invoice_type,
        salesPoint: inv.sales_point,
        voucherNumber: inv.voucher_number,
        cae: inv.cae,
        status: inv.status,
        total: Number(inv.total),
        customerName: inv.customer_name,
        buyerIvaCondition: inv.buyer_iva_condition,
        environment: inv.environment,
        createdAt: inv.created_at,
        rejectionReason: inv.rejection_reason,
        padronVerified: inv.padron_verified,
        padronNote: inv.padron_note,
      })),
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / INVOICES_PAGE_SIZE)),
      pageSize: INVOICES_PAGE_SIZE,
    };
  }
}

/** % y _ son comodines de LIKE: si los tipeó el usuario, son literales. */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}

interface InvoiceRecord {
  id: string;
  invoice_type: string | null;
  sales_point: number | null;
  voucher_number: number | null;
  cae: string | null;
  status: string;
  total: number;
  customer_name: string;
  buyer_iva_condition: string | null;
  environment: string | null;
  created_at: string;
  rejection_reason: string | null;
  padron_verified: boolean | null;
  padron_note: string | null;
}
