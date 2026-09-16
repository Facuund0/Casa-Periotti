import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isCustomerIvaCondition,
  normalizeFiscalId,
  validateCustomerFiscalData,
  type CustomerIvaCondition,
} from "./fiscal-rules";

const ROLES_QUE_PUEDEN_EDITAR_CLIENTES = ["admin", "super_admin", "ventas"] as const;

export class UnauthorizedError extends Error {
  constructor() {
    super("Tu rol no tiene permiso para editar datos de clientes");
    this.name = "UnauthorizedError";
  }
}

export class InvalidFiscalDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFiscalDataError";
  }
}

export interface CustomerFiscalRow {
  id: string;
  fullName: string;
  email: string;
  customerType: string;
  cuitDni: string | null;
  ivaCondition: CustomerIvaCondition;
}

const SELECT = "id, full_name, email, customer_type, cuit_dni, iva_condition, created_at";
const LIMIT = 25;

/**
 * Datos fiscales de los clientes desde el panel.
 *
 * El CUIT del perfil se precarga en "Factura con datos fiscales"; la
 * letra la decide el padrón de ARCA en cada emisión (invoice-decision.ts)
 * y la condición guardada es solo la última informada. Si alguien se
 * equivoca de CUIT, un empleado lo corrige acá.
 *
 * Cada cambio queda en audit_logs con el antes y el después.
 */
export class CustomerFiscalService {
  constructor(
    private readonly adminDb: SupabaseClient,
    private readonly employee: { id: string; role: string }
  ) {}

  private assertCanEdit() {
    if (!ROLES_QUE_PUEDEN_EDITAR_CLIENTES.includes(this.employee.role as never)) {
      throw new UnauthorizedError();
    }
  }

  /**
   * Sin búsqueda, los clientes más recientes. Con búsqueda, por nombre,
   * email o documento. Son consultas ilike separadas y no un .or()
   * armado a mano, para que lo que se tipea nunca se interprete como
   * parte del filtro de PostgREST.
   */
  async search(query?: string): Promise<CustomerFiscalRow[]> {
    this.assertCanEdit();
    const term = query?.trim();

    if (!term) {
      const { data, error } = await this.adminDb
        .from("customer_profiles")
        .select(SELECT)
        .order("created_at", { ascending: false })
        .limit(LIMIT);
      if (error) throw new Error(`No se pudieron leer los clientes: ${error.message}`);
      return (data ?? []).map(mapRow);
    }

    const pattern = `%${escapeLike(term)}%`;
    const digits = term.replace(/\D/g, "");

    const lookups = [
      this.adminDb.from("customer_profiles").select(SELECT).ilike("full_name", pattern).limit(LIMIT),
      this.adminDb.from("customer_profiles").select(SELECT).ilike("email", pattern).limit(LIMIT),
    ];
    if (digits.length >= 3) {
      lookups.push(
        this.adminDb.from("customer_profiles").select(SELECT).ilike("cuit_dni", `%${digits}%`).limit(LIMIT)
      );
    }

    const results = await Promise.all(lookups);
    const merged = new Map<string, CustomerFiscalRow>();
    for (const { data, error } of results) {
      if (error) throw new Error(`No se pudieron buscar clientes: ${error.message}`);
      for (const row of data ?? []) merged.set(row.id, mapRow(row));
    }
    return Array.from(merged.values()).slice(0, LIMIT);
  }

  async updateFiscalData(
    customerId: string,
    input: { cuitDni: string | null; ivaCondition: string }
  ): Promise<{ cuitDni: string | null; ivaCondition: CustomerIvaCondition }> {
    this.assertCanEdit();

    const invalid = validateCustomerFiscalData(input);
    if (invalid) throw new InvalidFiscalDataError(invalid);

    // validateCustomerFiscalData ya garantizó que la condición es válida;
    // el chequeo es para que TypeScript lo sepa.
    if (!isCustomerIvaCondition(input.ivaCondition)) {
      throw new InvalidFiscalDataError("Condición frente al IVA inválida.");
    }

    const { data: before, error: readError } = await this.adminDb
      .from("customer_profiles")
      .select("cuit_dni, iva_condition")
      .eq("id", customerId)
      .maybeSingle();

    if (readError) throw new Error(`No se pudo leer el cliente: ${readError.message}`);
    if (!before) throw new Error("El cliente no existe");

    const next = {
      cuitDni: normalizeFiscalId(input.cuitDni),
      ivaCondition: input.ivaCondition,
    };

    const { error } = await this.adminDb
      .from("customer_profiles")
      .update({ cuit_dni: next.cuitDni, iva_condition: next.ivaCondition })
      .eq("id", customerId);

    if (error) throw new Error(`No se pudieron guardar los datos fiscales: ${error.message}`);

    await this.adminDb.from("audit_logs").insert({
      user_id: this.employee.id,
      action: "update_customer_fiscal_data",
      entity_type: "customer",
      entity_id: customerId,
      data_before: { cuit_dni: before.cuit_dni, iva_condition: before.iva_condition },
      data_after: { cuit_dni: next.cuitDni, iva_condition: next.ivaCondition },
    });

    return next;
  }
}

function mapRow(row: {
  id: string;
  full_name: string;
  email: string;
  customer_type: string;
  cuit_dni: string | null;
  iva_condition: string | null;
}): CustomerFiscalRow {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    customerType: row.customer_type,
    cuitDni: row.cuit_dni,
    ivaCondition: isCustomerIvaCondition(row.iva_condition) ? row.iva_condition : "consumidor_final",
  };
}

/** % y _ son comodines de LIKE: si los tipeó el usuario, son literales. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (c) => `\\${c}`);
}
