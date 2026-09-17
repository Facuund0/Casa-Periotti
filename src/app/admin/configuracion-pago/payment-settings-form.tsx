"use client";

import { useState } from "react";
import { updatePaymentSettingsAction } from "@/modules/payments/admin-actions";
import type { PaymentSettings } from "@/modules/payments/payment-settings-service";

import { formatDateTimeAR } from "@/shared/utils/argentina-time";
/**
 * Datos bancarios que se le muestran al cliente en el checkout para que
 * transfiera. Se guardan en la base (no en variables de entorno) para
 * poder cambiarlos sin un deploy; cada cambio queda en audit_logs.
 */
export function PaymentSettingsForm({ settings }: { settings: PaymentSettings | null }) {
  const [result, setResult] = useState<{ error?: string; ok?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(formData: FormData) {
    setSaving(true);
    setResult(null);
    const res = await updatePaymentSettingsAction(formData);
    setResult(res);
    setSaving(false);
  }

  return (
    <form action={handleSubmit} className="space-y-4 max-w-md">
      {result?.error && (
        <div className="rounded-neu bg-danger-soft p-3 text-sm font-medium text-danger">
          {result.error}
        </div>
      )}
      {result?.ok && (
        <div className="rounded-neu bg-success-soft p-3 text-sm font-medium text-success">
          Datos guardados. El checkout ya los está mostrando.
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Alias</label>
        <input
          name="alias"
          defaultValue={settings?.alias ?? ""}
          placeholder="casa.periotti.mp"
          className="neu-input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">CBU</label>
        <input
          name="cbu"
          defaultValue={settings?.cbu ?? ""}
          placeholder="22 dígitos"
          inputMode="numeric"
          className="neu-input"
        />
        <p className="text-xs text-ink-subtle mt-1">
          Con al menos uno de los dos (alias o CBU) alcanza para que el cliente pueda transferir.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Titular de la cuenta</label>
        <input
          name="accountHolder"
          defaultValue={settings?.accountHolder ?? ""}
          placeholder="Razón social o nombre del titular"
          className="neu-input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Banco</label>
        <input
          name="bankName"
          defaultValue={settings?.bankName ?? ""}
          placeholder="Ej: Banco Nación"
          className="neu-input"
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="neu-btn neu-btn-primary"
      >
        {saving ? "Guardando..." : "Guardar datos bancarios"}
      </button>

      {settings?.updatedAt && (
        <p className="text-xs text-ink-subtle">
          Última modificación: {formatDateTimeAR(settings.updatedAt)}
        </p>
      )}
    </form>
  );
}
