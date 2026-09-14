"use client";

import { useState, useTransition } from "react";
import { updateCustomerFiscalDataAction } from "@/modules/customers/admin-actions";
import {
  CUSTOMER_IVA_CONDITIONS,
  CUSTOMER_IVA_CONDITION_LABELS,
  validateCustomerFiscalData,
  type CustomerIvaCondition,
} from "@/modules/customers/fiscal-rules";
import { formatCuit, isValidCuit } from "@/shared/utils/cuit";

/**
 * Datos fiscales de un cliente, con edición en línea.
 *
 * Avisa en rojo si lo guardado ya es inválido (un CUIT que no pasa el
 * dígito verificador con una condición que lo necesita: esas facturas
 * las rechaza ARCA), y avisa antes de guardar si el cambio altera qué
 * factura se le emite de ahora en más.
 */
export function CustomerFiscalEditor({
  customerId,
  initialCuit,
  initialCondition,
}: {
  customerId: string;
  initialCuit: string | null;
  initialCondition: CustomerIvaCondition;
}) {
  const [saved, setSaved] = useState({ cuit: initialCuit, condition: initialCondition });
  const [editing, setEditing] = useState(false);
  const [cuit, setCuit] = useState(initialCuit ?? "");
  const [condition, setCondition] = useState<CustomerIvaCondition>(initialCondition);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const savedIsBroken =
    (saved.condition !== "consumidor_final" && !isValidCuit(saved.cuit)) ||
    ((saved.cuit ?? "").replace(/\D/g, "").length === 11 && !isValidCuit(saved.cuit));

  const liveError = editing ? validateCustomerFiscalData({ cuitDni: cuit, ivaCondition: condition }) : null;

  const changesInvoiceLetter =
    condition !== saved.condition &&
    (condition === "responsable_inscripto" || saved.condition === "responsable_inscripto");

  function startEditing() {
    setCuit(saved.cuit ?? "");
    setCondition(saved.condition);
    setError(null);
    setNotice(null);
    setEditing(true);
  }

  function handleSave() {
    setError(null);
    const formData = new FormData();
    formData.set("cuitDni", cuit);
    formData.set("ivaCondition", condition);

    startTransition(async () => {
      const res = await updateCustomerFiscalDataAction(customerId, formData);
      if (res.error) {
        setError(res.error);
        return;
      }
      setSaved({ cuit: res.cuitDni ?? null, condition: res.ivaCondition ?? condition });
      setEditing(false);
      setNotice("Datos fiscales actualizados.");
    });
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="text-right">
          <p className="text-xs text-ink">
            {CUSTOMER_IVA_CONDITION_LABELS[saved.condition]}
            <span className="text-ink-muted"> · {saved.cuit ? formatCuit(saved.cuit) : "sin documento"}</span>
          </p>
          {savedIsBroken && (
            <span className="neu-badge mt-1 bg-danger-soft text-danger">
              CUIT inválido: ARCA va a rechazar sus facturas
            </span>
          )}
          {notice && <p className="mt-1 text-[11px] text-success">{notice}</p>}
        </div>
        <button type="button" onClick={startEditing} className="neu-btn !px-3 !py-1.5 !text-xs">
          Editar datos fiscales
        </button>
      </div>
    );
  }

  return (
    <div className="neu-inset w-full max-w-sm space-y-2 p-3 text-left">
      <label className="block text-xs font-medium text-ink">
        Condición frente al IVA
        <select
          value={condition}
          onChange={(e) => setCondition(e.target.value as CustomerIvaCondition)}
          className="neu-input mt-1 !py-1.5"
        >
          {CUSTOMER_IVA_CONDITIONS.map((c) => (
            <option key={c} value={c}>
              {CUSTOMER_IVA_CONDITION_LABELS[c]}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-xs font-medium text-ink">
        {condition === "consumidor_final" ? "DNI o CUIT (opcional)" : "CUIT"}
        <input
          value={cuit}
          onChange={(e) => setCuit(e.target.value)}
          inputMode="numeric"
          placeholder={condition === "consumidor_final" ? "7-8 dígitos o CUIT" : "11 dígitos"}
          className="neu-input mt-1 !py-1.5"
        />
      </label>

      {liveError && <p className="text-[11px] font-medium text-danger">{liveError}</p>}

      {changesInvoiceLetter && !liveError && (
        <p className="rounded-neu bg-warning-soft p-2 text-[11px] text-warning">
          Esto cambia la factura que se le emite en <span className="font-semibold">todas sus compras
          futuras</span>
          {condition === "responsable_inscripto" ? " (pasa a Factura A)." : " (deja de ser Factura A)."}
        </p>
      )}

      {error && <p className="text-[11px] font-medium text-danger">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || Boolean(liveError)}
          className="neu-btn neu-btn-primary !px-3 !py-1.5 !text-xs"
        >
          {pending ? "Guardando..." : "Guardar"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={pending}
          className="px-2 text-xs text-ink-muted hover:underline disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
