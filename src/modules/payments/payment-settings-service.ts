import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface PaymentSettings {
  alias: string | null;
  cbu: string | null;
  accountHolder: string | null;
  bankName: string | null;
  /** Cobro con la terminal Point (migración 0029). */
  pointEnabled: boolean;
  pointDeviceId: string | null;
  updatedAt: string | null;
}

export interface PaymentSettingsInput {
  alias: string | null;
  cbu: string | null;
  accountHolder: string | null;
  bankName: string | null;
}

// La fila de payment_settings es siempre la misma (id=1, con un CHECK en
// la base que lo garantiza) — no hay varias configuraciones posibles.
const SETTINGS_ROW_ID = 1;

/**
 * Datos bancarios que se le muestran al cliente para que transfiera.
 * Viven en la base y no en variables de entorno para que un admin los
 * pueda cambiar desde el panel sin un deploy, y para que cada cambio
 * quede registrado en audit_logs.
 */
export class PaymentSettingsService {
  constructor(private readonly db: SupabaseClient) {}

  async get(): Promise<PaymentSettings | null> {
    const { data, error } = await this.db
      .from("payment_settings")
      .select("alias, cbu, account_holder, bank_name, point_enabled, point_device_id, updated_at")
      .eq("id", SETTINGS_ROW_ID)
      .maybeSingle();

    if (error) {
      throw new Error(`No se pudo leer la configuración de pago: ${error.message}`);
    }
    if (!data) return null;

    return {
      alias: data.alias,
      cbu: data.cbu,
      accountHolder: data.account_holder,
      bankName: data.bank_name,
      pointEnabled: Boolean(data.point_enabled),
      pointDeviceId: data.point_device_id,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Qué terminal Point usa el mostrador y si está activa. Queda en
   * audit_logs igual que los datos bancarios: cambiar de terminal cambia
   * a dónde va la plata de las tarjetas.
   */
  async updatePoint(
    input: { enabled: boolean; deviceId: string | null },
    employeeId: string
  ): Promise<void> {
    const before = await this.get();

    const { error } = await this.db
      .from("payment_settings")
      .update({
        point_enabled: input.enabled,
        point_device_id: input.deviceId,
        updated_by: employeeId,
      })
      .eq("id", SETTINGS_ROW_ID);
    if (error) {
      throw new Error(`No se pudo guardar la terminal Point: ${error.message}`);
    }

    await this.db.from("audit_logs").insert({
      user_id: employeeId,
      action: "update_point_settings",
      entity_type: "payment_settings",
      entity_id: null,
      data_before: before
        ? { pointEnabled: before.pointEnabled, pointDeviceId: before.pointDeviceId }
        : null,
      data_after: input,
    });
  }

  /**
   * Guarda los datos bancarios y deja el cambio en audit_logs con el
   * antes y el después — son los datos a los que un cliente le va a
   * transferir plata, así que cualquier modificación tiene que quedar
   * atribuida a alguien.
   */
  async update(input: PaymentSettingsInput, employeeId: string): Promise<void> {
    const before = await this.get();

    const { error } = await this.db
      .from("payment_settings")
      .update({
        alias: input.alias,
        cbu: input.cbu,
        account_holder: input.accountHolder,
        bank_name: input.bankName,
        updated_by: employeeId,
      })
      .eq("id", SETTINGS_ROW_ID);

    if (error) {
      throw new Error(`No se pudo guardar la configuración de pago: ${error.message}`);
    }

    await this.db.from("audit_logs").insert({
      user_id: employeeId,
      action: "update_payment_settings",
      entity_type: "payment_settings",
      // entity_id es uuid en audit_logs y esta tabla usa un id entero
      // fijo (siempre 1) — no hay nada que identificar fila por fila.
      entity_id: null,
      data_before: before,
      data_after: input,
    });
  }

  /**
   * ¿Están los datos mínimos para que alguien pueda transferir? Sin
   * alias ni CBU no hay forma de pagar, así que el checkout lo tiene que
   * poder detectar antes de dejar confirmar un pedido.
   */
  static isUsable(settings: PaymentSettings | null): boolean {
    if (!settings) return false;
    return Boolean(settings.alias?.trim() || settings.cbu?.trim());
  }
}
