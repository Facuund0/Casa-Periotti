"use client";

import { useState } from "react";
import { importProductsAction, type ImportActionResult } from "@/modules/products/import-actions";

/**
 * Sube la planilla y muestra el resultado fila por fila. Arranca en modo
 * simulación: así el primer intento nunca escribe nada.
 */
export function ImportForm() {
  const [result, setResult] = useState<ImportActionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [dryRun, setDryRun] = useState(true);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setResult(null);
    setResult(await importProductsAction(formData));
    setLoading(false);
  }

  const summary = result?.summary;
  const errors = summary?.rows.filter((r) => r.action === "error") ?? [];

  return (
    <div className="space-y-4">
      <form action={handleSubmit} className="neu-card space-y-3 p-4">
        <div>
          <label htmlFor="archivo" className="mb-1 block text-sm font-medium text-ink">
            Archivo CSV
          </label>
          <input
            id="archivo"
            name="archivo"
            type="file"
            accept=".csv,text/csv,text/plain"
            required
            className="neu-input"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            name="dryRun"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
          />
          Solo simular (no guarda nada)
        </label>

        <button
          type="submit"
          disabled={loading}
          className={`neu-btn w-full ${dryRun ? "" : "neu-btn-primary"}`}
        >
          {loading ? "Procesando…" : dryRun ? "Simular importación" : "Importar de verdad"}
        </button>
        {!dryRun && (
          <p className="text-xs font-medium text-warning">
            Con la simulación destildada, esta importación va a crear y actualizar productos.
          </p>
        )}
      </form>

      {result?.error && (
        <div className="rounded-neu bg-danger-soft p-3 text-sm font-medium text-danger" role="alert">
          {result.error}
        </div>
      )}

      {summary && (
        <div className="neu-card p-4">
          <p className="text-sm font-semibold text-ink">
            {summary.dryRun ? "Simulación (no se guardó nada)" : "Importación aplicada"}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <Count label={summary.dryRun ? "Se crearían" : "Creados"} value={summary.created} tone="text-success" />
            <Count
              label={summary.dryRun ? "Se actualizarían" : "Actualizados"}
              value={summary.updated}
              tone="text-info"
            />
            <Count label="Con error" value={summary.failed} tone="text-danger" />
          </div>

          {errors.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                Filas con error
              </p>
              <ul className="space-y-1 text-xs">
                {errors.map((row) => (
                  <li key={row.line} className="text-danger">
                    <span className="font-semibold">Fila {row.line}</span>
                    {row.sku ? ` · ${row.sku}` : ""}: {row.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {summary.rows.some((r) => r.action !== "error") && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-medium text-brand">
                Ver las {summary.rows.filter((r) => r.action !== "error").length} filas sin error
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                {summary.rows
                  .filter((r) => r.action !== "error")
                  .map((row) => (
                    <li key={row.line}>
                      Fila {row.line} · {row.sku} · {row.name} →{" "}
                      <span className={row.action === "crear" ? "text-success" : "text-info"}>
                        {row.action}
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="neu-inset p-3">
      <p className={`text-xl font-bold tabular-nums ${tone}`}>{value}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{label}</p>
    </div>
  );
}
