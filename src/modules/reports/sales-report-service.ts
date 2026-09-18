import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  PAYMENT_METHODS_ON_CREDIT,
  PAYMENT_METHOD_LABELS,
  type PosPaymentMethod,
} from "@/modules/pos/schemas";
import { CustomerAccountService } from "@/modules/accounts/customer-account-service";
import { endOfDayInArgentina, startOfDayInArgentina } from "@/shared/utils/date-range";

/**
 * Reportes de ventas del panel. SOLO LEE: no modifica nada y no participa
 * de ninguna venta ni facturación.
 *
 * Qué cuenta como venta: los pedidos que ya se cobraron, es decir de
 * 'paid' en adelante. Quedan afuera los que esperan pago, los rechazados
 * y los cancelados, que no son plata que entró.
 *
 * El rango se interpreta en hora de Argentina (ver date-range.ts): un
 * pedido de las 22:00 del lunes cuenta en el lunes, no en el martes UTC.
 */

/** Estados en los que el pedido ya se cobró. */
const SOLD_STATUSES = ["paid", "preparing", "ready_for_pickup", "shipped", "completed"] as const;

export interface ReportTotals {
  orders: number;
  gross: number;
  net: number;
  vat: number;
  averageTicket: number;
}

export interface ReportChannel {
  label: string;
  orders: number;
  total: number;
}

export interface ReportPaymentMethod {
  label: string;
  orders: number;
  total: number;
}

export interface ReportProduct {
  name: string;
  quantity: number;
  total: number;
}

export interface ReportIdleProduct {
  name: string;
  sku: string;
  stockAvailable: number;
}

export interface ReportMargin {
  /** Venta neta (sin IVA) de los productos que tienen costo cargado. */
  netRevenue: number;
  /** Costo de esas mismas unidades. */
  cost: number;
  margin: number;
  marginPct: number;
  /** Cuántos productos vendidos tienen y no tienen costo cargado. */
  productsWithCost: number;
  productsWithoutCost: number;
}

export interface ReportInvoices {
  authorized: number;
  rejected: number;
  other: number;
}

export interface CashClose {
  orders: number;
  /** Plata que entró de verdad: NO incluye lo fiado. */
  total: number;
  byMethod: ReportPaymentMethod[];
  /** Ventas de mostrador que quedaron en cuenta corriente. */
  onCredit: { orders: number; total: number };
  /**
   * Cobranzas de cuenta corriente del período: plata que entró por
   * deudas, incluido lo que se paga en el momento de una venta fiada.
   */
  collections: { total: number; byMethod: { method: string; amount: number; count: number }[] };
  /** Ventas cobradas + cobranzas: todo lo que entró en el período. */
  totalIn: number;
  firstSaleAt: string | null;
  lastSaleAt: string | null;
}

export interface ReportAccounts {
  /** Lo que se fió en el período (suma a las cuentas de los clientes). */
  soldOnCredit: number;
  soldOnCreditSales: number;
  /** Lo que los clientes pagaron de su cuenta en el período. */
  collected: number;
  collectedPayments: number;
  /** Deuda total de todos los clientes hoy. No depende del rango. */
  outstanding: number;
}

export interface SalesReport {
  from: string;
  to: string;
  totals: ReportTotals;
  channels: ReportChannel[];
  paymentMethods: ReportPaymentMethod[];
  topProducts: ReportProduct[];
  idleProducts: ReportIdleProduct[];
  invoices: ReportInvoices;
  /** Margen estimado con el costo ACTUAL de cada producto (ver abajo). */
  margin: ReportMargin;
  /** Cierre de caja: solo las ventas de mostrador del rango. */
  cashClose: CashClose;
  /** Cuenta corriente: fiado, cobranzas y deuda total. */
  accounts: ReportAccounts;
}

interface OrderRow {
  id: string;
  total: number;
  subtotal: number;
  vat_amount: number;
  created_at: string;
  fulfillment_method: string;
}

/**
 * Nombre legible del medio de pago. En el mostrador lo elige el empleado;
 * en la web, el proveedor. Quedan pagos viejos de Mercado Pago de antes de
 * pasar a transferencia: se muestran con su nombre, no con el técnico.
 */
function paymentLabel(provider: string, methodId: string | null): string {
  if (provider === "pos") {
    return PAYMENT_METHOD_LABELS[methodId as PosPaymentMethod] ?? methodId ?? "Otro";
  }
  if (provider === "transferencia") return "Transferencia (web)";
  if (provider === "mercadopago") return "Mercado Pago";
  return provider;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class SalesReportService {
  constructor(private readonly db: SupabaseClient) {}

  async build(range: { from: string; to: string }): Promise<SalesReport> {
    const fromTs = startOfDayInArgentina(range.from);
    const toTs = endOfDayInArgentina(range.to);
    if (!fromTs || !toTs) throw new Error("Rango de fechas inválido");

    const { data: orders, error: ordersError } = await this.db
      .from("orders")
      .select("id, total, subtotal, vat_amount, created_at, fulfillment_method")
      .in("status", [...SOLD_STATUSES])
      .gte("created_at", fromTs)
      .lte("created_at", toTs)
      .order("created_at");
    if (ordersError) throw new Error(`No se pudieron leer las ventas: ${ordersError.message}`);

    const sold = (orders ?? []) as OrderRow[];
    const orderIds = sold.map((o) => o.id);

    // Cuenta corriente: no depende de las ventas del rango, así que se
    // pide junto con lo demás en vez de esperar su turno. Cada ida y
    // vuelta a la base cuesta más que los datos que trae.
    const accountsPromise = Promise.all([
      this.db
        .from("customer_account_movements")
        .select("kind, amount")
        .gte("created_at", fromTs)
        .lte("created_at", toTs),
      this.db.from("customer_account_movements").select("amount"),
      new CustomerAccountService(this.db).collectionsBetween(fromTs, toTs),
    ]);

    // Productos: una sola consulta para las dos cosas que se necesitan
    // —el costo de lo vendido y qué productos activos no se vendieron—.
    // Antes eran dos consultas, cada una esperando su turno.
    const productsPromise = this.db
      .from("products")
      .select("id, sku, name, cost_net, vat_rate, stock_quantity, stock_reserved, active")
      .order("name");

    // Pagos, ítems y facturas del rango, en paralelo.
    const [paymentsResult, itemsResult, invoicesResult] = await Promise.all([
      orderIds.length
        ? this.db
            .from("payments")
            .select("order_id, provider, payment_method_id, amount, status")
            .in("order_id", orderIds)
            .eq("status", "approved")
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? this.db
            .from("order_items")
            .select("order_id, product_id, product_name_snapshot, quantity, unit_price")
            .in("order_id", orderIds)
        : Promise.resolve({ data: [], error: null }),
      this.db
        .from("invoices")
        .select("status")
        .gte("created_at", fromTs)
        .lte("created_at", toTs),
    ]);
    if (paymentsResult.error) throw new Error(`No se pudieron leer los pagos: ${paymentsResult.error.message}`);
    if (itemsResult.error) throw new Error(`No se pudo leer el detalle: ${itemsResult.error.message}`);

    const payments = paymentsResult.data ?? [];
    const items = itemsResult.data ?? [];

    // ---------- totales ----------
    const gross = round2(sold.reduce((s, o) => s + Number(o.total), 0));
    const totals: ReportTotals = {
      orders: sold.length,
      gross,
      net: round2(sold.reduce((s, o) => s + Number(o.subtotal), 0)),
      vat: round2(sold.reduce((s, o) => s + Number(o.vat_amount), 0)),
      averageTicket: sold.length ? round2(gross / sold.length) : 0,
    };

    // ---------- canal: mostrador (pago 'pos') o web ----------
    const posOrderIds = new Set(
      payments.filter((p) => p.provider === "pos").map((p) => p.order_id as string)
    );
    const counter = (rows: OrderRow[]) => ({
      orders: rows.length,
      total: round2(rows.reduce((s, o) => s + Number(o.total), 0)),
    });
    const posOrders = sold.filter((o) => posOrderIds.has(o.id));
    const webOrders = sold.filter((o) => !posOrderIds.has(o.id));
    const channels: ReportChannel[] = [
      { label: "Mostrador", ...counter(posOrders) },
      { label: "Web", ...counter(webOrders) },
    ];

    // ---------- medios de pago ----------
    const byMethod = new Map<string, { orders: number; total: number }>();
    for (const payment of payments) {
      const label = paymentLabel(payment.provider as string, payment.payment_method_id as string | null);
      const current = byMethod.get(label) ?? { orders: 0, total: 0 };
      current.orders += 1;
      current.total = round2(current.total + Number(payment.amount));
      byMethod.set(label, current);
    }
    const paymentMethods: ReportPaymentMethod[] = [...byMethod]
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.total - a.total);

    // ---------- productos vendidos ----------
    const byProduct = new Map<string, ReportProduct & { productId: string | null }>();
    for (const item of items) {
      const key = (item.product_id as string) ?? (item.product_name_snapshot as string);
      const current =
        byProduct.get(key) ??
        { name: item.product_name_snapshot as string, quantity: 0, total: 0, productId: (item.product_id as string) ?? null };
      current.quantity += Number(item.quantity);
      current.total = round2(current.total + Number(item.unit_price) * Number(item.quantity));
      byProduct.set(key, current);
    }
    const topProducts = [...byProduct.values()]
      .sort((a, b) => b.quantity - a.quantity)
      .map(({ name, quantity, total }) => ({ name, quantity, total }));

    // ---------- margen estimado ----------
    //
    // Con el costo ACTUAL del producto, no el del día de la venta: el
    // costo no se guarda por renglón (eso sería tocar create_order, que
    // maneja precios y stock). Si un costo cambió después de vender, el
    // margen de esa venta sale con el costo nuevo. Para el uso normal
    // —saber qué deja cada cosa— alcanza, y queda dicho en la pantalla.
    const { data: productRows } = await productsPromise;
    const costById = new Map((productRows ?? []).map((p) => [p.id, p]));

    let marginNetRevenue = 0;
    let marginCost = 0;
    let withCost = 0;
    let withoutCost = 0;
    for (const product of byProduct.values()) {
      const row = product.productId ? costById.get(product.productId) : undefined;
      if (!row || row.cost_net === null || row.cost_net === undefined) {
        withoutCost += 1;
        continue;
      }
      withCost += 1;
      const vatRate = Number(row.vat_rate) || 0;
      // El precio de venta está cargado CON IVA; el costo es neto. Para
      // comparar se pasa la venta a neto.
      marginNetRevenue = round2(marginNetRevenue + product.total / (1 + vatRate / 100));
      marginCost = round2(marginCost + Number(row.cost_net) * product.quantity);
    }
    const margin: ReportMargin = {
      netRevenue: marginNetRevenue,
      cost: marginCost,
      margin: round2(marginNetRevenue - marginCost),
      marginPct: marginNetRevenue ? round2(((marginNetRevenue - marginCost) / marginNetRevenue) * 100) : 0,
      productsWithCost: withCost,
      productsWithoutCost: withoutCost,
    };

    // ---------- productos activos sin ventas en el rango ----------
    const soldProductIds = new Set(
      [...byProduct.values()].map((p) => p.productId).filter((id): id is string => Boolean(id))
    );
    const idleProducts: ReportIdleProduct[] = (productRows ?? [])
      .filter((p) => p.active && !soldProductIds.has(p.id))
      .map((p) => ({
        name: p.name,
        sku: p.sku,
        stockAvailable: Number(p.stock_quantity) - Number(p.stock_reserved),
      }));

    // ---------- facturas emitidas en el rango ----------
    const invoiceRows = invoicesResult.data ?? [];
    const invoices: ReportInvoices = {
      authorized: invoiceRows.filter((i) => i.status === "authorized").length,
      rejected: invoiceRows.filter((i) => i.status === "rejected").length,
      other: invoiceRows.filter((i) => !["authorized", "rejected"].includes(i.status as string)).length,
    };

    // ---------- cierre de caja: solo mostrador ----------
    //
    // Lo fiado queda afuera del total: la venta existe y se facturó, pero
    // esa plata no está en el cajón. Se informa aparte para que al cerrar
    // la caja cuadre con lo que hay.
    const allPosPayments = payments.filter((p) => p.provider === "pos");
    const isOnCredit = (p: (typeof allPosPayments)[number]) =>
      PAYMENT_METHODS_ON_CREDIT.includes(p.payment_method_id as PosPaymentMethod);
    const posPayments = allPosPayments.filter((p) => !isOnCredit(p));
    const creditPayments = allPosPayments.filter(isOnCredit);
    const cashByMethod = new Map<string, { orders: number; total: number }>();
    for (const payment of posPayments) {
      const label =
        PAYMENT_METHOD_LABELS[payment.payment_method_id as PosPaymentMethod] ??
        payment.payment_method_id ??
        "Otro";
      const current = cashByMethod.get(label) ?? { orders: 0, total: 0 };
      current.orders += 1;
      current.total = round2(current.total + Number(payment.amount));
      cashByMethod.set(label, current);
    }
    // Las cobranzas se leen del movimiento de la cuenta, con su medio de
    // pago (migración 0030). Incluyen lo que el cliente paga en el
    // momento de una venta fiada, que no puede ir en payments porque un
    // pedido admite un solo pago (migración 0007). Ya se pidieron arriba.
    const [{ data: rangeMovements }, { data: allMovements }, collections] = await accountsPromise;

    const cashClose: CashClose = {
      orders: new Set(posPayments.map((p) => p.order_id as string)).size,
      total: round2(posPayments.reduce((s, p) => s + Number(p.amount), 0)),
      byMethod: [...cashByMethod].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.total - a.total),
      onCredit: {
        orders: new Set(creditPayments.map((p) => p.order_id as string)).size,
        total: round2(creditPayments.reduce((s, p) => s + Number(p.amount), 0)),
      },
      collections,
      totalIn: round2(round2(posPayments.reduce((s, p) => s + Number(p.amount), 0)) + collections.total),
      firstSaleAt: posOrders[0]?.created_at ?? null,
      lastSaleAt: posOrders.at(-1)?.created_at ?? null,
    };

    // ---------- cuenta corriente ----------
    const creditSales = (rangeMovements ?? []).filter((m) => m.kind === "venta");
    const paidMovements = (rangeMovements ?? []).filter((m) => m.kind === "pago");
    const accounts: ReportAccounts = {
      soldOnCredit: round2(creditSales.reduce((s, m) => s + Number(m.amount), 0)),
      soldOnCreditSales: creditSales.length,
      // Los pagos se guardan en negativo: se informan en positivo.
      collected: round2(-paidMovements.reduce((s, m) => s + Number(m.amount), 0)),
      collectedPayments: paidMovements.length,
      outstanding: round2((allMovements ?? []).reduce((s, m) => s + Number(m.amount), 0)),
    };

    return {
      from: range.from,
      to: range.to,
      totals,
      channels,
      paymentMethods,
      topProducts,
      idleProducts,
      invoices,
      margin,
      cashClose,
      accounts,
    };
  }
}

/** "yyyy-mm-dd" de hoy en Argentina, para los valores por defecto del filtro. */
export function todayInArgentina(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** "yyyy-mm-dd" de hace N días en Argentina. */
export function daysAgoInArgentina(days: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
}
