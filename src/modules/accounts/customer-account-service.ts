import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Cuenta corriente de los clientes (fiado).
 *
 * Qué NO hace, a propósito:
 *  - No crea pedidos, no toca stock y no factura. La venta fiada es una
 *    venta de mostrador común (mismo create_order, mismo
 *    confirm_order_paid, misma factura al entregar); lo único que se
 *    agrega es el movimiento que deja anotada la deuda.
 *  - No mueve plata: acá se registra lo que el cliente pagó, con la
 *    fecha y quién lo recibió.
 *
 * El saldo es la suma de los movimientos con signo: positivo es deuda
 * (ver migración 0027). Se calcula sumando, no se guarda en ninguna
 * columna: un saldo guardado se desincroniza en cuanto falla una
 * escritura, y estos volúmenes se suman sin problema.
 */

export interface AccountMovement {
  id: string;
  kind: "venta" | "pago" | "ajuste";
  amount: number;
  note: string | null;
  orderId: string | null;
  orderNumber: number | null;
  createdAt: string;
  createdByName: string | null;
}

export interface CustomerAccount {
  customerId: string;
  fullName: string;
  email: string;
  phone: string | null;
  creditEnabled: boolean;
  creditLimit: number | null;
  /** Positivo = debe. 0 = al día. */
  balance: number;
  lastMovementAt: string | null;
}

export class CustomerAccountService {
  constructor(private readonly adminDb: SupabaseClient) {}

  /** Saldo de un cliente. 0 si nunca tuvo movimientos. */
  async getBalance(customerId: string): Promise<number> {
    const { data, error } = await this.adminDb
      .from("customer_account_movements")
      .select("amount")
      .eq("customer_id", customerId);
    if (error) throw new Error(`No se pudo leer la cuenta corriente: ${error.message}`);
    return round2((data ?? []).reduce((sum, m) => sum + Number(m.amount), 0));
  }

  /** Saldo de varios clientes de una sola consulta. */
  async getBalances(customerIds: string[]): Promise<Map<string, number>> {
    const ids = [...new Set(customerIds)];
    const result = new Map<string, number>();
    if (!ids.length) return result;

    const { data, error } = await this.adminDb
      .from("customer_account_movements")
      .select("customer_id, amount")
      .in("customer_id", ids);
    if (error) throw new Error(`No se pudieron leer las cuentas corrientes: ${error.message}`);

    for (const m of data ?? []) {
      const id = m.customer_id as string;
      result.set(id, round2((result.get(id) ?? 0) + Number(m.amount)));
    }
    return result;
  }

  /**
   * Las cuentas que le importan al panel: las habilitadas para fiar y
   * las que tienen movimientos (una cuenta con deuda no desaparece de la
   * lista porque alguien le saque el permiso de fiar).
   */
  async listAccounts(): Promise<CustomerAccount[]> {
    const [{ data: enabled, error: enabledError }, { data: moved, error: movedError }] =
      await Promise.all([
        this.adminDb
          .from("customer_profiles")
          .select("id, full_name, email, phone, credit_enabled, credit_limit")
          .eq("credit_enabled", true),
        this.adminDb.from("customer_account_movements").select("customer_id, amount, created_at"),
      ]);
    if (enabledError) throw new Error(`No se pudieron leer los clientes: ${enabledError.message}`);
    if (movedError) throw new Error(`No se pudo leer la cuenta corriente: ${movedError.message}`);

    const balances = new Map<string, number>();
    const lastMovement = new Map<string, string>();
    for (const m of moved ?? []) {
      const id = m.customer_id as string;
      balances.set(id, round2((balances.get(id) ?? 0) + Number(m.amount)));
      const at = m.created_at as string;
      if (!lastMovement.has(id) || at > lastMovement.get(id)!) lastMovement.set(id, at);
    }

    // Los que tienen movimientos pero ya no están habilitados: hay que
    // traer sus datos igual.
    const enabledIds = new Set((enabled ?? []).map((c) => c.id as string));
    const missingIds = [...balances.keys()].filter((id) => !enabledIds.has(id));
    const { data: others } = missingIds.length
      ? await this.adminDb
          .from("customer_profiles")
          .select("id, full_name, email, phone, credit_enabled, credit_limit")
          .in("id", missingIds)
      : { data: [] as NonNullable<typeof enabled> };

    const rows = [...(enabled ?? []), ...(others ?? [])];
    return rows
      .map((c) => ({
        customerId: c.id as string,
        fullName: c.full_name as string,
        email: c.email as string,
        phone: (c.phone as string | null) ?? null,
        creditEnabled: Boolean(c.credit_enabled),
        creditLimit: c.credit_limit === null ? null : Number(c.credit_limit),
        balance: balances.get(c.id as string) ?? 0,
        lastMovementAt: lastMovement.get(c.id as string) ?? null,
      }))
      // Primero los que más deben: es lo que hay que ir a cobrar.
      .sort((a, b) => b.balance - a.balance || a.fullName.localeCompare(b.fullName, "es"));
  }

  /** Movimientos de un cliente, del más nuevo al más viejo. */
  async listMovements(customerId: string, limit = 50): Promise<AccountMovement[]> {
    const { data, error } = await this.adminDb
      .from("customer_account_movements")
      .select("id, kind, amount, note, order_id, created_by, created_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw new Error(`No se pudieron leer los movimientos: ${error.message}`);
    const rows = data ?? [];

    // Número de pedido y nombre del empleado, de a lote. created_by
    // apunta a auth.users, así que el nombre se busca en employee_profiles.
    const orderIds = rows.map((m) => m.order_id as string | null).filter((id): id is string => Boolean(id));
    const employeeIds = rows
      .map((m) => m.created_by as string | null)
      .filter((id): id is string => Boolean(id));

    const [{ data: orders }, { data: employees }] = await Promise.all([
      orderIds.length
        ? this.adminDb.from("orders").select("id, order_number").in("id", orderIds)
        : Promise.resolve({ data: [] as { id: string; order_number: number }[] }),
      employeeIds.length
        ? this.adminDb.from("employee_profiles").select("id, full_name").in("id", employeeIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    ]);
    const orderNumber = new Map((orders ?? []).map((o) => [o.id, o.order_number]));
    const employeeName = new Map((employees ?? []).map((e) => [e.id, e.full_name]));

    return rows.map((m) => ({
      id: m.id as string,
      kind: m.kind as AccountMovement["kind"],
      amount: Number(m.amount),
      note: (m.note as string | null) ?? null,
      orderId: (m.order_id as string | null) ?? null,
      orderNumber: m.order_id ? (orderNumber.get(m.order_id as string) ?? null) : null,
      createdAt: m.created_at as string,
      createdByName: m.created_by ? (employeeName.get(m.created_by as string) ?? null) : null,
    }));
  }

  /**
   * Últimos movimientos de varias cuentas, para el listado del panel. Una
   * sola consulta para todos, y en pantalla se muestran los primeros de
   * cada cliente.
   */
  async listRecentByCustomers(
    customerIds: string[],
    perCustomer = 10
  ): Promise<Map<string, AccountMovement[]>> {
    const ids = [...new Set(customerIds)];
    const result = new Map<string, AccountMovement[]>();
    if (!ids.length) return result;

    const { data, error } = await this.adminDb
      .from("customer_account_movements")
      .select("id, customer_id, kind, amount, note, order_id, created_by, created_at")
      .in("customer_id", ids)
      .order("created_at", { ascending: false })
      .limit(ids.length * perCustomer);
    if (error) throw new Error(`No se pudieron leer los movimientos: ${error.message}`);
    const rows = data ?? [];

    const orderIds = rows.map((m) => m.order_id as string | null).filter((id): id is string => Boolean(id));
    const employeeIds = rows
      .map((m) => m.created_by as string | null)
      .filter((id): id is string => Boolean(id));
    const [{ data: orders }, { data: employees }] = await Promise.all([
      orderIds.length
        ? this.adminDb.from("orders").select("id, order_number").in("id", orderIds)
        : Promise.resolve({ data: [] as { id: string; order_number: number }[] }),
      employeeIds.length
        ? this.adminDb.from("employee_profiles").select("id, full_name").in("id", employeeIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
    ]);
    const orderNumber = new Map((orders ?? []).map((o) => [o.id, o.order_number]));
    const employeeName = new Map((employees ?? []).map((e) => [e.id, e.full_name]));

    for (const m of rows) {
      const id = m.customer_id as string;
      const list = result.get(id) ?? [];
      if (list.length >= perCustomer) continue;
      list.push({
        id: m.id as string,
        kind: m.kind as AccountMovement["kind"],
        amount: Number(m.amount),
        note: (m.note as string | null) ?? null,
        orderId: (m.order_id as string | null) ?? null,
        orderNumber: m.order_id ? (orderNumber.get(m.order_id as string) ?? null) : null,
        createdAt: m.created_at as string,
        createdByName: m.created_by ? (employeeName.get(m.created_by as string) ?? null) : null,
      });
      result.set(id, list);
    }
    return result;
  }

  /**
   * Qué se puede fiarle a este cliente. No decide: informa, y el
   * mostrador ve el saldo y el límite antes de confirmar.
   */
  async creditStatus(customerId: string): Promise<{
    enabled: boolean;
    limit: number | null;
    balance: number;
    fullName: string | null;
  }> {
    const [{ data: customer }, balance] = await Promise.all([
      this.adminDb
        .from("customer_profiles")
        .select("full_name, credit_enabled, credit_limit")
        .eq("id", customerId)
        .maybeSingle(),
      this.getBalance(customerId),
    ]);
    return {
      enabled: Boolean(customer?.credit_enabled),
      limit: customer?.credit_limit === null || customer?.credit_limit === undefined
        ? null
        : Number(customer.credit_limit),
      balance,
      fullName: (customer?.full_name as string | null) ?? null,
    };
  }

  /**
   * Deja anotada la deuda de una venta fiada. La llama la venta de
   * mostrador ANTES de descontar el stock: si esto falla, la venta se
   * corta antes de mover nada, igual que la elección fiscal (0018).
   *
   * El índice único de la migración 0027 garantiza una sola deuda por
   * venta, así que un reintento no puede duplicarla.
   */
  async registerSaleDebit(params: {
    customerId: string;
    orderId: string;
    amount: number;
    employeeId: string;
  }): Promise<void> {
    if (params.amount <= 0) throw new Error("El importe de la venta fiada tiene que ser mayor a 0");

    const { error } = await this.adminDb.from("customer_account_movements").insert({
      customer_id: params.customerId,
      order_id: params.orderId,
      kind: "venta",
      amount: round2(params.amount),
      note: "Venta en cuenta corriente",
      created_by: params.employeeId,
    });
    if (error) {
      throw new Error(`No se pudo registrar la deuda de la venta: ${error.message}`);
    }
  }

  /** Cobranza: el cliente pagó parte o todo. Baja la deuda. */
  async registerPayment(params: {
    customerId: string;
    amount: number;
    note: string | null;
    employeeId: string;
  }): Promise<{ balance: number }> {
    if (!(params.amount > 0)) throw new Error("El importe tiene que ser mayor a 0");

    const { error } = await this.adminDb.from("customer_account_movements").insert({
      customer_id: params.customerId,
      kind: "pago",
      // Negativo: baja la deuda (ver migración 0027).
      amount: -round2(params.amount),
      note: params.note?.trim() || null,
      created_by: params.employeeId,
    });
    if (error) throw new Error(`No se pudo registrar el pago: ${error.message}`);

    await this.adminDb.from("audit_logs").insert({
      user_id: params.employeeId,
      action: "register_account_payment",
      entity_type: "customer_account",
      entity_id: params.customerId,
      data_after: { amount: round2(params.amount), note: params.note ?? null },
    });

    return { balance: await this.getBalance(params.customerId) };
  }

  /** Corrección a mano, en contra o a favor, siempre con motivo. */
  async registerAdjustment(params: {
    customerId: string;
    amount: number;
    note: string;
    employeeId: string;
  }): Promise<{ balance: number }> {
    if (params.amount === 0) throw new Error("El importe no puede ser 0");
    if (!params.note.trim()) throw new Error("Escribí el motivo del ajuste");

    const { error } = await this.adminDb.from("customer_account_movements").insert({
      customer_id: params.customerId,
      kind: "ajuste",
      amount: round2(params.amount),
      note: params.note.trim(),
      created_by: params.employeeId,
    });
    if (error) throw new Error(`No se pudo registrar el ajuste: ${error.message}`);

    await this.adminDb.from("audit_logs").insert({
      user_id: params.employeeId,
      action: "register_account_adjustment",
      entity_type: "customer_account",
      entity_id: params.customerId,
      data_after: { amount: round2(params.amount), note: params.note.trim() },
    });

    return { balance: await this.getBalance(params.customerId) };
  }

  /** Habilita o deshabilita el fiado, y el límite sugerido. */
  async setCreditSettings(params: {
    customerId: string;
    enabled: boolean;
    limit: number | null;
    employeeId: string;
  }): Promise<void> {
    const { data: before } = await this.adminDb
      .from("customer_profiles")
      .select("credit_enabled, credit_limit")
      .eq("id", params.customerId)
      .maybeSingle();

    const { error } = await this.adminDb
      .from("customer_profiles")
      .update({ credit_enabled: params.enabled, credit_limit: params.limit })
      .eq("id", params.customerId);
    if (error) throw new Error(`No se pudo cambiar la cuenta corriente: ${error.message}`);

    await this.adminDb.from("audit_logs").insert({
      user_id: params.employeeId,
      action: "update_customer_credit",
      entity_type: "customer_account",
      entity_id: params.customerId,
      data_before: before ?? null,
      data_after: { credit_enabled: params.enabled, credit_limit: params.limit },
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
