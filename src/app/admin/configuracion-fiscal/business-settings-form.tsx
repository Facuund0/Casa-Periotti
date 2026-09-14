"use client";

import { useState } from "react";
import { updateBusinessSettingsAction } from "@/modules/billing/admin-actions";
import type { BusinessSettings } from "@/modules/billing/business-settings-service";

/**
 * Datos fiscales del emisor. Se pueden guardar incompletos (el dueño los
 * carga de a poco), pero mientras falte alguno de los obligatorios no se
 * puede facturar — por eso el aviso de arriba lista exactamente qué
 * falta, tanto al entrar como después de guardar.
 */
export function BusinessSettingsForm({
  settings,
  missing: initialMissing,
}: {
  settings: BusinessSettings | null;
  missing: string[];
}) {
  const [result, setResult] = useState<{ error?: string; ok?: boolean } | null>(null);
  const [missing, setMissing] = useState(initialMissing);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(formData: FormData) {
    setSaving(true);
    setResult(null);
    const res = await updateBusinessSettingsAction(formData);
    setResult(res);
    if (res.missing) setMissing(res.missing);
    setSaving(false);
  }

  return (
    <form action={handleSubmit} className="space-y-6 max-w-2xl">
      {missing.length > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-sm p-3">
          <p className="font-medium">Todavía no se puede facturar.</p>
          <p className="mt-1">Falta cargar: {missing.join(", ")}.</p>
        </div>
      )}

      {result?.error && (
        <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm p-3">
          {result.error}
        </div>
      )}
      {result?.ok && missing.length === 0 && (
        <div className="rounded-md bg-green-50 border border-green-200 text-green-700 text-sm p-3">
          Datos fiscales completos. La facturación ya los está usando.
        </div>
      )}
      {result?.ok && missing.length > 0 && (
        <div className="rounded-md bg-neutral-100 border border-neutral-200 text-neutral-600 text-sm p-3">
          Guardado.
        </div>
      )}

      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold uppercase text-neutral-500 mb-2">
          Identificación
        </legend>

        <Field
          name="legalName"
          label="Razón social"
          required
          defaultValue={settings?.legalName}
          placeholder="Tal como figura en la constancia de inscripción"
        />
        <Field
          name="tradeName"
          label="Nombre de fantasía"
          defaultValue={settings?.tradeName}
          placeholder="Casa Periotti"
          hint="El nombre comercial. Se imprime además de la razón social, no en lugar de ella."
        />
        <Field
          name="cuit"
          label="CUIT"
          required
          defaultValue={settings?.cuit}
          placeholder="11 dígitos, sin guiones"
          inputMode="numeric"
        />

        <div>
          <label className="block text-sm font-medium mb-1">
            Condición frente al IVA <span className="text-red-500">*</span>
          </label>
          <select
            name="ivaCondition"
            defaultValue={settings?.ivaCondition ?? ""}
            className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="">Sin especificar</option>
            <option value="responsable_inscripto">Responsable Inscripto</option>
            <option value="monotributista">Monotributista</option>
            <option value="exento">Exento</option>
          </select>
          <p className="text-xs text-neutral-400 mt-1">
            Determina qué comprobantes se pueden emitir: siendo Responsable Inscripto, Factura A a
            otro Responsable Inscripto y Factura B al resto.
          </p>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold uppercase text-neutral-500 mb-2">
          Domicilio comercial
        </legend>

        <Field
          name="addressStreet"
          label="Calle y número"
          required
          defaultValue={settings?.addressStreet}
          placeholder="Ej: Av. Belgrano 1234"
        />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field
            name="addressCity"
            label="Localidad"
            required
            defaultValue={settings?.addressCity}
            placeholder="Sunchales"
          />
          <Field
            name="addressProvince"
            label="Provincia"
            defaultValue={settings?.addressProvince}
            placeholder="Santa Fe"
          />
          <Field
            name="addressPostalCode"
            label="Código postal"
            defaultValue={settings?.addressPostalCode}
            placeholder="2322"
          />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold uppercase text-neutral-500 mb-2">
          Datos impositivos
        </legend>

        <Field
          name="grossIncomeNumber"
          label="Ingresos Brutos"
          defaultValue={settings?.grossIncomeNumber}
          placeholder="Número de inscripción o de Convenio Multilateral"
        />
        <div>
          <label className="block text-sm font-medium mb-1">Inicio de actividades</label>
          <input
            type="date"
            name="activitiesStartDate"
            defaultValue={settings?.activitiesStartDate ?? ""}
            className="border border-neutral-300 rounded-md px-3 py-2 text-sm"
          />
        </div>
        <Field
          name="salesPoint"
          label="Punto de venta habilitado en ARCA"
          required
          defaultValue={settings?.salesPoint != null ? String(settings.salesPoint) : ""}
          placeholder="1"
          inputMode="numeric"
          hint="Lo asigna ARCA al habilitar el punto de venta. Cambiarlo cambia la numeración de los comprobantes."
        />
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-xs font-semibold uppercase text-neutral-500 mb-2">Contacto</legend>

        <Field
          name="contactEmail"
          label="Email de contacto"
          defaultValue={settings?.contactEmail}
          placeholder="consultas@casaperiotti.com.ar"
          type="email"
        />
        <Field
          name="contactPhone"
          label="Teléfono de contacto"
          defaultValue={settings?.contactPhone}
          placeholder="03493 42-0000"
        />
      </fieldset>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={saving}
          className="bg-neutral-900 text-white rounded-md px-4 py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Guardar datos fiscales"}
        </button>
        {settings?.updatedAt && (
          <p className="text-xs text-neutral-400">
            Última modificación: {new Date(settings.updatedAt).toLocaleString("es-AR")}
          </p>
        )}
      </div>
    </form>
  );
}

function Field({
  name,
  label,
  defaultValue,
  placeholder,
  hint,
  required,
  type = "text",
  inputMode,
}: {
  name: string;
  label: string;
  defaultValue?: string | null;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  type?: string;
  inputMode?: "numeric" | "text";
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        name={name}
        type={type}
        inputMode={inputMode}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
      />
      {hint && <p className="text-xs text-neutral-400 mt-1">{hint}</p>}
    </div>
  );
}
