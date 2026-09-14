import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type IssuerIvaCondition = "responsable_inscripto" | "monotributista" | "exento";

export interface BusinessSettings {
  legalName: string | null;
  tradeName: string | null;
  cuit: string | null;
  addressStreet: string | null;
  addressCity: string | null;
  addressProvince: string | null;
  addressPostalCode: string | null;
  ivaCondition: IssuerIvaCondition | null;
  grossIncomeNumber: string | null;
  activitiesStartDate: string | null;
  salesPoint: number | null;
  contactEmail: string | null;
  contactPhone: string | null;
  updatedAt: string | null;
}

export type BusinessSettingsInput = Omit<BusinessSettings, "updatedAt">;

/**
 * Datos fiscales completos, ya validados: es lo que necesita la
 * facturación para poder emitir. La diferencia con BusinessSettings es
 * que acá los campos obligatorios ya no son nullables, así que quien lo
 * recibe no tiene que volver a chequear nada.
 */
export interface CompleteBusinessSettings {
  legalName: string;
  tradeName: string | null;
  cuit: string;
  cuitDigits: string;
  addressStreet: string;
  addressCity: string;
  addressProvince: string | null;
  addressPostalCode: string | null;
  ivaCondition: IssuerIvaCondition;
  grossIncomeNumber: string | null;
  activitiesStartDate: string | null;
  salesPoint: number;
  contactEmail: string | null;
  contactPhone: string | null;
}

export class BusinessSettingsIncompleteError extends Error {
  constructor(missing: string[]) {
    super(
      `Faltan datos fiscales de Casa Periotti para poder facturar: ${missing.join(
        ", "
      )}. Cargalos en /admin/configuracion-fiscal (solo super_admin).`
    );
    this.name = "BusinessSettingsIncompleteError";
  }
}

// La fila de business_settings es siempre la misma (id=1, con un CHECK
// en la base que lo garantiza) — no hay varias configuraciones posibles.
const SETTINGS_ROW_ID = 1;

/**
 * Datos fiscales del emisor: los que ARCA exige que figuren en todo
 * comprobante impreso (razón social, domicilio comercial, CUIT,
 * condición frente al IVA, Ingresos Brutos, inicio de actividades) más
 * el punto de venta habilitado.
 *
 * Viven en la base y no en variables de entorno para que el dueño los
 * pueda cargar y corregir sin un deploy, y para que cada cambio quede
 * atribuido en audit_logs: un CUIT o un punto de venta mal cargado
 * invalida todos los comprobantes que se emitan después.
 */
export class BusinessSettingsService {
  constructor(private readonly db: SupabaseClient) {}

  async get(): Promise<BusinessSettings | null> {
    const { data, error } = await this.db
      .from("business_settings")
      .select(
        "legal_name, trade_name, cuit, address_street, address_city, address_province, address_postal_code, iva_condition, gross_income_number, activities_start_date, sales_point, contact_email, contact_phone, updated_at"
      )
      .eq("id", SETTINGS_ROW_ID)
      .maybeSingle();

    if (error) {
      throw new Error(`No se pudieron leer los datos fiscales: ${error.message}`);
    }
    if (!data) return null;

    return {
      legalName: data.legal_name,
      tradeName: data.trade_name,
      cuit: data.cuit,
      addressStreet: data.address_street,
      addressCity: data.address_city,
      addressProvince: data.address_province,
      addressPostalCode: data.address_postal_code,
      ivaCondition: data.iva_condition,
      grossIncomeNumber: data.gross_income_number,
      activitiesStartDate: data.activities_start_date,
      salesPoint: data.sales_point,
      contactEmail: data.contact_email,
      contactPhone: data.contact_phone,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Los datos fiscales listos para facturar, o una excepción que dice
   * exactamente qué falta. La usa BillingService antes de emitir: es
   * mejor cortar acá con un mensaje claro que mandarle a ARCA un
   * comprobante sin CUIT o emitir un PDF sin domicilio.
   */
  async getComplete(): Promise<CompleteBusinessSettings> {
    const settings = await this.get();
    const complete = BusinessSettingsService.toComplete(settings);
    if (!complete) {
      throw new BusinessSettingsIncompleteError(BusinessSettingsService.missingFields(settings));
    }
    return complete;
  }

  async update(input: BusinessSettingsInput, employeeId: string): Promise<void> {
    const before = await this.get();

    const { error } = await this.db
      .from("business_settings")
      .update({
        legal_name: input.legalName,
        trade_name: input.tradeName,
        cuit: input.cuit,
        address_street: input.addressStreet,
        address_city: input.addressCity,
        address_province: input.addressProvince,
        address_postal_code: input.addressPostalCode,
        iva_condition: input.ivaCondition,
        gross_income_number: input.grossIncomeNumber,
        activities_start_date: input.activitiesStartDate,
        sales_point: input.salesPoint,
        contact_email: input.contactEmail,
        contact_phone: input.contactPhone,
        updated_by: employeeId,
      })
      .eq("id", SETTINGS_ROW_ID);

    if (error) {
      throw new Error(`No se pudieron guardar los datos fiscales: ${error.message}`);
    }

    await this.db.from("audit_logs").insert({
      user_id: employeeId,
      action: "update_business_settings",
      entity_type: "business_settings",
      // entity_id es uuid en audit_logs y esta tabla usa un id entero
      // fijo (siempre 1) — no hay nada que identificar fila por fila.
      entity_id: null,
      data_before: before,
      data_after: input,
    });
  }

  /**
   * Campos que todavía faltan para poder facturar, con el nombre con el
   * que aparecen en el formulario (así el mensaje de error le dice al
   * empleado exactamente qué ir a completar).
   *
   * Provincia, código postal, nombre de fantasía, Ingresos Brutos,
   * inicio de actividades, email y teléfono quedan afuera de esta lista
   * a propósito: se imprimen si están, pero su ausencia no impide
   * emitir el comprobante.
   */
  static missingFields(settings: BusinessSettings | null): string[] {
    if (!settings) return ["todos (no hay ninguna configuración cargada)"];

    const missing: string[] = [];
    if (!settings.legalName?.trim()) missing.push("razón social");
    if (!isValidCuit(settings.cuit)) missing.push("CUIT (11 dígitos)");
    if (!settings.addressStreet?.trim()) missing.push("domicilio comercial");
    if (!settings.addressCity?.trim()) missing.push("localidad");
    if (!settings.ivaCondition) missing.push("condición frente al IVA");
    if (!settings.salesPoint || settings.salesPoint <= 0) missing.push("punto de venta de ARCA");
    return missing;
  }

  static isComplete(settings: BusinessSettings | null): boolean {
    return BusinessSettingsService.missingFields(settings).length === 0;
  }

  /**
   * Devuelve los datos con los obligatorios ya garantizados, o null si
   * falta alguno. Es el único lugar donde se hace ese estrechamiento de
   * tipos, así que no puede quedar desincronizado con missingFields().
   */
  static toComplete(settings: BusinessSettings | null): CompleteBusinessSettings | null {
    if (!settings || !BusinessSettingsService.isComplete(settings)) return null;

    return {
      legalName: settings.legalName!.trim(),
      tradeName: settings.tradeName?.trim() || null,
      cuit: settings.cuit!.trim(),
      cuitDigits: settings.cuit!.replace(/\D/g, ""),
      addressStreet: settings.addressStreet!.trim(),
      addressCity: settings.addressCity!.trim(),
      addressProvince: settings.addressProvince?.trim() || null,
      addressPostalCode: settings.addressPostalCode?.trim() || null,
      ivaCondition: settings.ivaCondition!,
      grossIncomeNumber: settings.grossIncomeNumber?.trim() || null,
      activitiesStartDate: settings.activitiesStartDate,
      salesPoint: settings.salesPoint!,
      contactEmail: settings.contactEmail?.trim() || null,
      contactPhone: settings.contactPhone?.trim() || null,
    };
  }
}

function isValidCuit(cuit: string | null): boolean {
  return (cuit ?? "").replace(/\D/g, "").length === 11;
}

export const ISSUER_IVA_CONDITION_LABELS: Record<IssuerIvaCondition, string> = {
  responsable_inscripto: "Responsable Inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
};
