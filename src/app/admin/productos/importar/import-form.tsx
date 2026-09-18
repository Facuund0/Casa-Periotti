"use client";

import { useState } from "react";
import { importProductsAction, type ImportActionResult } from "@/modules/products/import-actions";

/**
 * Sube la planilla y muestra el resultado fila por fila.
 *
 * Son dos pasos, siempre en este orden: primero se simula (no escribe
 * nada) y recién después aparece el botón para aplicarla de verdad. El
 * archivo elegido se guarda en memoria, así el segundo paso no obliga a
 * buscarlo otra vez.
 */
export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportActionResult | null>(null);
  const [loading, setLoading] = useState<"simular" | "aplicar" | null>(null);
  const [applied, setApplied] = useState(false);

  async function run(dryRun: boolean) {
    if (!file) return;
    setLoading(dryRun ? "simular" : "aplicar");
    setResult(null);
    const formData = new FormData();
    formData.set("archivo", file);
    if (dryRun) formData.set("dryRun", "on");
    const res = await importProductsAction(formData);
    setResult(res);
    setApplied(!dryRun && Boolean(res.summary));
    setLoading(null);
  }

  const summary = result?.summary;
  const errors = summary?.rows.filter((r) => r.action === "error") ?? [];
  const aCargar = summary ? summary.created + summary.updated : 0;
  // Se puede aplicar lo que salió bien de la simulación, incluso si otras
  // filas fallaron: esas simplemente no se cargan.
  const puedeAplicar = Boolean(summary?.dryRun) && aCargar > 0 && !applied;

  return (
    <div className="space-y-4">
      <div className="neu-card space-y-3 p-4">
        <div>
          <label htmlFor="archivo" className="mb-1 block text-sm font-medium text-ink">
            Paso 1 · Elegí el archivo CSV
          </label>
          <input
            id="archivo"
            name="archivo"
            type="file"
            accept=".csv,text/csv,text/plain"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setApplied(false);
            }}
            className="neu-input"
          />
          {file && (
            <p className="mt-1 text-xs text-ink-muted">
              {file.name} · {(file.size / 1024).toFixed(0)} KB
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => run(true)}
          disabled={!file || loading !== null}
          className="neu-btn neu-btn-primary w-full"
        >
          {loading === "simular" ? "Revisando…" : "Paso 2 · Simular (no guarda nada)"}
        </button>
        <p className="text-xs text-ink-subtle">
          La simulación valida todo y te muestra qué haría. Recién después aparece el botón para
          aplicarla.
        </p>
      </div>

      {result?.error && (
        <div className="rounded-neu bg-danger-soft p-3 text-sm font-medium text-danger" role="alert">
          {result.error}
        </div>
      )}

      {summary && (
        <div className="neu-card p-4">
          <p className="text-sm font-semibold text-ink">
            {summary.dryRun ? "Simulación — todavía no se guardó nada" : "Importación aplicada"}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-3 text-center">
            <Count
              label={summary.dryRun ? "Se crearían" : "Creados"}
              value={summary.created}
              tone="text-success"
            />
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
                Filas con error — estas no se cargan
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

          {puedeAplicar && (
            <div className="neu-inset mt-4 p-3">
              <p className="text-sm text-ink">
                Si está bien, aplicala:{" "}
                <span className="font-medium">
                  se {summary.created > 0 ? `crean ${summary.created}` : "crean 0"} y se{" "}
                  {summary.updated > 0 ? `actualizan ${summary.updated}` : "actualizan 0"} productos
                </span>
                .
              </p>
              <button
                type="button"
                onClick={() => run(false)}
                disabled={loading !== null}
                className="neu-btn neu-btn-primary mt-2 w-full"
              >
                {loading === "aplicar" ? "Guardando…" : "Paso 3 · Aplicar de verdad"}
              </button>
              <p className="mt-2 text-xs text-ink-subtle">
                No toca el stock: eso se sigue moviendo con ajustes y entradas.
              </p>
            </div>
          )}

          {applied && (
            <p className="mt-4 text-sm font-medium text-success">
              Listo. Ya podés verlos en Productos y stock.
            </p>
          )}

          {summary.dryRun && aCargar === 0 && (
            <p className="mt-4 text-sm text-warning">
              La simulación no encontró ninguna fila para cargar. Revisá los errores de arriba —
              acordate de que las filas que empiezan con # son ejemplos y se ignoran.
            </p>
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
