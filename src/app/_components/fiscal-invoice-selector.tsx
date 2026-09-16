"use client";

import { useEffect, useRef, useState } from "react";
import type { FiscalInvoicePreview } from "@/modules/billing/buyer-fiscal-check";
import { fiscalIdDigits, formatCuit, isPlausibleDni, isValidCuit } from "@/shared/utils/cuit";

export type FiscalSelection =
  | { kind: "final_consumer"; dni: string | null; ready: boolean; problem: string | null }
  | { kind: "fiscal_data"; cuit: string; ready: boolean; problem: string | null };

/**
 * Elección del comprobante, idéntica en el checkout web y en el mostrador.
 *
 * Por defecto Consumidor Final sin pedir nada (el caso mayoritario). La
 * opción secundaria "Factura con datos fiscales" pide solo el CUIT, lo
 * consulta en el padrón y muestra antes de confirmar qué comprobante
 * corresponde y por qué. La letra no se elige: la decide el padrón.
 * Desde el umbral de ARCA, el Consumidor Final se identifica con DNI.
 */
export function FiscalInvoiceSelector({
  initialCuit,
  initialDni,
  initialFiscal,
  total,
  threshold,
  previewAction,
  onChange,
  subject = "tu",
}: {
  initialCuit?: string | null;
  initialDni?: string | null;
  initialFiscal?: boolean;
  total: number;
  threshold: number;
  previewAction: (cuit: string) => Promise<{ preview?: FiscalInvoicePreview; error?: string }>;
  onChange: (selection: FiscalSelection) => void;
  /** "tu" en el checkout, "el" en el mostrador (textos). */
  subject?: "tu" | "el";
}) {
  const [fiscal, setFiscal] = useState(Boolean(initialFiscal));
  const [cuit, setCuit] = useState(fiscalIdDigits(initialCuit).length === 11 ? fiscalIdDigits(initialCuit) : "");
  const [dni, setDni] = useState(initialDni ?? "");
  const [preview, setPreview] = useState<{ cuit: string; data?: FiscalInvoicePreview; error?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);

  const cuitDigits = fiscalIdDigits(cuit);
  const needsId = total >= threshold;

  // Consulta el padrón cada vez que hay un CUIT válido distinto.
  useEffect(() => {
    if (!fiscal || !isValidCuit(cuitDigits) || preview?.cuit === cuitDigits) return;
    const id = ++requestId.current;
    setLoading(true);
    previewAction(cuitDigits)
      .then((res) => {
        if (id === requestId.current) setPreview({ cuit: cuitDigits, data: res.preview, error: res.error });
      })
      .catch(() => {
        if (id === requestId.current) {
          setPreview({ cuit: cuitDigits, error: "No se pudo consultar ARCA. Probá de nuevo." });
        }
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [fiscal, cuitDigits, preview?.cuit, previewAction]);

  const currentPreview = preview?.cuit === cuitDigits ? preview : null;

  let selection: FiscalSelection;
  if (fiscal) {
    let problem: string | null = null;
    if (!cuitDigits) problem = "Ingresá el CUIT para la factura con datos fiscales.";
    else if (!isValidCuit(cuitDigits))
      problem = "El CUIT no es válido: revisá los 11 dígitos (el último es un dígito verificador).";
    else if (loading || !currentPreview) problem = "Esperá a que termine la consulta a ARCA.";
    else if (currentPreview.error) problem = currentPreview.error;
    selection = { kind: "fiscal_data", cuit: cuitDigits, ready: problem === null, problem };
  } else {
    const dniDigits = fiscalIdDigits(dni);
    let problem: string | null = null;
    if (dniDigits && !isPlausibleDni(dniDigits)) problem = "El DNI tiene que tener 7 u 8 dígitos.";
    else if (needsId && !dniDigits)
      problem = "Por el monto de la compra, ARCA exige identificar al comprador: ingresá el DNI.";
    selection = { kind: "final_consumer", dni: dniDigits || null, ready: problem === null, problem };
  }

  const selectionKey = JSON.stringify(selection);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current(JSON.parse(selectionKey));
  }, [selectionKey]);

  return (
    <div className="space-y-2 text-xs">
      <p className="text-ink-muted">
        Comprobante:{" "}
        <span className="font-semibold text-ink">
          {fiscal ? "Factura con datos fiscales" : "Factura B a Consumidor Final"}
        </span>
      </p>

      <label className="flex items-center gap-2 text-ink-muted">
        <input type="checkbox" checked={fiscal} onChange={(e) => setFiscal(e.target.checked)} />
        Factura con datos fiscales
      </label>

      {fiscal && (
        <div className="space-y-2">
          <input
            value={cuit}
            onChange={(e) => setCuit(e.target.value)}
            placeholder="CUIT (11 dígitos)"
            inputMode="numeric"
            className="neu-input"
          />
          <p className="text-ink-subtle">
            La letra de la factura no se elige: la decide el padrón de ARCA según la condición frente
            al IVA de ese CUIT.
          </p>

          {cuitDigits && !isValidCuit(cuitDigits) && (
            <p className="font-medium text-danger">
              El CUIT no es válido: revisá los 11 dígitos (el último es un dígito verificador).
            </p>
          )}
          {loading && <p className="text-ink-muted">Consultando el padrón de ARCA…</p>}
          {!loading && currentPreview?.error && (
            <div className="rounded-neu bg-danger-soft p-3 font-medium text-danger">{currentPreview.error}</div>
          )}
          {!loading && currentPreview?.data && <PreviewCard cuit={cuitDigits} preview={currentPreview.data} />}
        </div>
      )}

      {!fiscal && (needsId || dni) && (
        <div className="space-y-1">
          {needsId && (
            <p className="font-medium text-warning">
              Por el monto de la compra, ARCA exige identificar al Consumidor Final con su DNI. Para
              identificar{subject === "tu" ? "te" : "lo"} con CUIT, usá &quot;Factura con datos fiscales&quot;.
            </p>
          )}
          <input
            value={dni}
            onChange={(e) => setDni(e.target.value)}
            placeholder="DNI (7 u 8 dígitos)"
            inputMode="numeric"
            className="neu-input"
          />
        </div>
      )}
    </div>
  );
}

function PreviewCard({ cuit, preview }: { cuit: string; preview: FiscalInvoicePreview }) {
  return (
    <div
      className={`space-y-1 rounded-neu p-3 ${
        preview.verified ? "bg-info-soft text-info" : "bg-warning-soft text-warning"
      }`}
      role="status"
    >
      <p className="text-sm font-semibold">Corresponde Factura {preview.letter}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <dt>Razón social:</dt>
        <dd className="font-medium">{preview.legalName ?? "no informada por ARCA"}</dd>
        <dt>CUIT:</dt>
        <dd className="font-medium">{formatCuit(cuit)}</dd>
        <dt>Condición frente al IVA:</dt>
        <dd className="font-medium">{preview.verified ? preview.conditionLabel : "no verificada"}</dd>
      </dl>
      <p>{preview.reason}</p>
      {preview.legend && <p className="italic">Se imprime la leyenda: “{preview.legend}”.</p>}
    </div>
  );
}
