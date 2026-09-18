import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Detalle de pedidos para el panel: lo que el empleado necesita para
 * preparar la entrega y contactar al cliente sin abrir otra pantalla.
 * Solo lee. Se consulta de a lote (una consulta por tabla, no por pedido)
 * para que un listado largo no multiplique las idas a la base.
 */

export interface OrderDetailLine {
  productName: string;
  quantity: number;
  /** Precio unitario con IVA, el que se cobró. */
  unitPrice: number;
  /** unitPrice × cantidad, con IVA. */
  lineTotal: number;
  priceType: "wholesale" | "retail";
}

export type OrderPriceSummary = "minorista" | "mayorista" | "mixto";

export interface OrderAdminDetail {
  orderId: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  fulfillmentMethod: "pickup" | "delivery";
  shippingStreet: string | null;
  shippingCity: string | null;
  notes: string | null;
  subtotal: number;
  vatAmount: number;
  total: number;
  lines: OrderDetailLine[];
  priceSummary: OrderPriceSummary;
  totalUnits: number;
}

export class OrderAdminDetailService {
  constructor(private readonly adminDb: SupabaseClient) {}

  async getMany(orderIds: string[]): Promise<Map<string, OrderAdminDetail>> {
    const ids = [...new Set(orderIds)];
    const result = new Map<string, OrderAdminDetail>();
    if (!ids.length) return result;

    const [{ data: orders, error: ordersError }, { data: items, error: itemsError }] =
      await Promise.all([
        // El cliente viene embebido en la misma consulta: antes era una
        // tercera consulta EN FILA detrás de esta, y cada ida y vuelta a
        // la base cuesta más que los datos que trae.
        this.adminDb
          .from("orders")
          .select(
            "id, customer_id, fulfillment_method, shipping_address_street, shipping_address_city, notes, subtotal, vat_amount, total, customer_profiles ( id, full_name, email, phone )"
          )
          .in("id", ids),
        this.adminDb
          .from("order_items")
          .select("order_id, product_name_snapshot, quantity, unit_price, price_type")
        .in("order_id", ids)
        // Por nombre: así se arma el pedido en el depósito sin saltar de un lado a otro.
        .order("product_name_snapshot"),
      ]);
    if (ordersError) throw new Error(`No se pudieron leer los pedidos: ${ordersError.message}`);
    if (itemsError)
      throw new Error(`No se pudo leer el detalle de los pedidos: ${itemsError.message}`);

    const linesByOrder = new Map<string, OrderDetailLine[]>();
    for (const item of items ?? []) {
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unit_price);
      const list = linesByOrder.get(item.order_id) ?? [];
      list.push({
        productName: item.product_name_snapshot,
        quantity,
        unitPrice,
        lineTotal: Math.round(unitPrice * quantity * 100) / 100,
        priceType: item.price_type === "wholesale" ? "wholesale" : "retail",
      });
      linesByOrder.set(item.order_id, list);
    }

    for (const order of orders ?? []) {
      const lines = linesByOrder.get(order.id) ?? [];
      const hasWholesale = lines.some((l) => l.priceType === "wholesale");
      const hasRetail = lines.some((l) => l.priceType === "retail");
      // PostgREST devuelve la relación embebida como objeto o como array
      // de un elemento según la versión: se aceptan las dos formas.
      const embedded = order.customer_profiles as unknown;
      const customer = (Array.isArray(embedded) ? embedded[0] : embedded) as
        | { full_name: string; email: string; phone: string | null }
        | null
        | undefined;
      result.set(order.id, {
        orderId: order.id,
        customerName: customer?.full_name ?? null,
        customerEmail: customer?.email ?? null,
        customerPhone: customer?.phone ?? null,
        fulfillmentMethod: order.fulfillment_method,
        shippingStreet: order.shipping_address_street,
        shippingCity: order.shipping_address_city,
        notes: order.notes,
        subtotal: Number(order.subtotal),
        vatAmount: Number(order.vat_amount),
        total: Number(order.total),
        lines,
        priceSummary:
          hasWholesale && hasRetail ? "mixto" : hasWholesale ? "mayorista" : "minorista",
        totalUnits: lines.reduce((sum, l) => sum + l.quantity, 0),
      });
    }
    return result;
  }
}
