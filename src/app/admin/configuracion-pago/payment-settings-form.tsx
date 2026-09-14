"use client";

import { useState } from "react";
import { updatePaymentSettingsAction } from "@/modules/payments/admin-actions";
import type { PaymentSettings } from "@/modules/payments/payment-settings-service";

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
        <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm p-3">
          {result.error}
        </div>
      )}
      {result?.ok && (
        <div className="rounded-md bg-green-50 border border-green-200 text-green-700 text-sm p-3">
          Datos guardados. El checkout ya los está mostrando.
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Alias</label>
        <input
          name="alias"
          defaultValue={settings?.alias ?? ""}
          placeholder="casa.periotti.mp"
          className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">CBU</label>
        <input
          name="cbu"
          defaultValue={settings?.cbu ?? ""}
          placeholder="22 dígitos"
          inputMode="numeric"
          className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
        />
        <p className="text-xs text-neutral-400 mt-1">
          Con al menos uno de los dos (alias o CBU) alcanza para que el cliente pueda transferir.
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Titular de la cuenta</label>
        <input
          name="accountHolder"
          defaultValue={settings?.accountHolder ?? ""}
          placeholder="Razón social o nombre del titular"
          className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Banco</label>
        <input
          name="bankName"
          defaultValue={settings?.bankName ?? ""}
          placeholder="Ej: Banco Nación"
          className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={saving}
        className="bg-neutral-900 text-white rounded-md px-4 py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
      >
        {saving ? "Guardando..." : "Guardar datos bancarios"}
      </button>

      {settings?.updatedAt && (
        <p className="text-xs text-neutral-400">
          Última modificación: {new Date(settings.updatedAt).toLocaleString("es-AR")}
        </p>
      )}
    </form>
  );
}
