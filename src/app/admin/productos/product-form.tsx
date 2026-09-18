"use client";

import { useState } from "react";
import type { AdminActionResult } from "@/modules/products/admin-actions";
import { priceBreakdown } from "@/modules/products/pricing";

interface CategoryOption {
  id: string;
  name: string;
}

interface ProductFormProps {
  categories: CategoryOption[];
  action: (formData: FormData) => Promise<AdminActionResult>;
  defaultValues?: {
    sku: string;
    name: string;
    slug: string;
    description: string | null;
    brand: string | null;
    categoryId: string | null;
    /** Precios NETOS (sin IVA) — los calcula la página a partir de lo guardado. */
    priceRetailNet: number;
    priceWholesaleNet: number;
    vatRate: number;
    unit: string;
    stockMinimum: number;
    wholesaleMinQuantity: number;
    costNet: number | null;
    barcode: string | null;
    decimalQuantity: boolean;
  };
  showInitialStock?: boolean;
  /** Bloque de imágenes: solo se puede usar sobre un producto ya creado. */
  imagesSlot?: React.ReactNode;
}

export function ProductForm({
  categories,
  action,
  defaultValues,
  showInitialStock,
  imagesSlot,
}: ProductFormProps) {
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Desglose en vivo. Es solo para que el empleado vea a qué precio
  // final va a quedar el producto antes de guardar; el cálculo que
  // vale lo hace el servidor con la MISMA función (ver pricing.ts).
  const [retailNet, setRetailNet] = useState(
    defaultValues?.priceRetailNet != null ? String(defaultValues.priceRetailNet) : ""
  );
  const [wholesaleNet, setWholesaleNet] = useState(
    defaultValues?.priceWholesaleNet != null ? String(defaultValues.priceWholesaleNet) : ""
  );
  const [vatRate, setVatRate] = useState(String(defaultValues?.vatRate ?? 21));
  // El costo también se controla desde React para poder mostrar el margen
  // mientras se carga. No cambia lo que se guarda.
  const [costNet, setCostNet] = useState(
    defaultValues?.costNet != null ? String(defaultValues.costNet) : ""
  );

  const vat = Number(vatRate) || 0;

  // Margen sobre la venta, comparando neto contra neto (el costo también
  // se carga sin IVA). Es la misma cuenta que hace el reporte.
  const cost = Number(costNet);
  const margin =
    Number.isFinite(cost) && cost > 0 && Number(retailNet) > 0
      ? {
          retail: Math.round(((Number(retailNet) - cost) / Number(retailNet)) * 1000) / 10,
          wholesale:
            Number(wholesaleNet) > 0
              ? Math.round(((Number(wholesaleNet) - cost) / Number(wholesaleNet)) * 1000) / 10
              : null,
        }
      : null;
  const retail = priceBreakdown(Number(retailNet) || 0, vat);
  const wholesale = priceBreakdown(Number(wholesaleNet) || 0, vat);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setResult(null);
    const res = await action(formData);
    setResult(res);
    setLoading(false);
  }

  const err = result?.fieldErrors;

  return (
    <form action={handleSubmit} className="space-y-4 max-w-xl">
      {result?.error && (
        <div className="rounded-neu bg-danger-soft p-3 text-sm font-medium text-danger">
          {result.error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <TextField label="SKU" name="sku" defaultValue={defaultValues?.sku} error={err?.sku} />
        <TextField
          label="Slug (URL)"
          name="slug"
          defaultValue={defaultValues?.slug}
          error={err?.slug}
          hint="minúsculas y guiones, ej: canilla-fv-monocomando"
        />
      </div>

      <TextField label="Nombre" name="name" defaultValue={defaultValues?.name} error={err?.name} />
      <TextField label="Marca" name="brand" defaultValue={defaultValues?.brand ?? ""} error={err?.brand} />

      <div>
        <label className="block text-sm font-medium text-ink mb-1">Descripción</label>
        <textarea
          name="description"
          defaultValue={defaultValues?.description ?? ""}
          rows={3}
          className="neu-input"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-ink mb-1">Categoría</label>
        <select
          name="categoryId"
          defaultValue={defaultValues?.categoryId ?? ""}
          required
          className="neu-input"
        >
          <option value="" disabled>
            Elegí una categoría
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {err?.categoryId && <p className="text-xs text-danger mt-1">{err.categoryId}</p>}
      </div>

      <div className="neu-inset space-y-3 p-4">
        <div>
          <p className="text-sm font-medium text-ink">Precios de venta y costo</p>
          <p className="text-xs text-ink-subtle">
            Todo se carga <span className="font-medium">sin IVA</span>. El precio final con IVA lo
            calcula el sistema y es el que ve el cliente.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Venta minorista
              <span className="block text-xs font-normal text-ink-subtle">
                Lo que paga cualquier cliente
              </span>
            </label>
            <input
              name="priceRetailNet"
              type="number"
              step="0.01"
              min="0"
              required
              value={retailNet}
              onChange={(e) => setRetailNet(e.target.value)}
              className="neu-input"
            />
            {err?.priceRetailNet && (
              <p className="text-xs text-danger mt-1">{err.priceRetailNet}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">
              Venta mayorista
              <span className="block text-xs font-normal text-ink-subtle">
                Lo que paga un mayorista aprobado
              </span>
            </label>
            <input
              name="priceWholesaleNet"
              type="number"
              step="0.01"
              min="0"
              required
              value={wholesaleNet}
              onChange={(e) => setWholesaleNet(e.target.value)}
              className="neu-input"
            />
            {err?.priceWholesaleNet && (
              <p className="text-xs text-danger mt-1">{err.priceWholesaleNet}</p>
            )}
          </div>

          <div>
            <label htmlFor="costNet" className="block text-sm font-medium text-ink mb-1">
              Costo de compra
              <span className="block text-xs font-normal text-ink-subtle">
                Lo que le pagás al proveedor
              </span>
            </label>
            <input
              id="costNet"
              name="costNet"
              type="number"
              step="0.01"
              min="0"
              value={costNet}
              onChange={(e) => setCostNet(e.target.value)}
              className="neu-input"
            />
            <p className="text-xs text-ink-subtle mt-1">
              <span className="font-medium">No es un precio de venta.</span> Es el de la factura de
              tu proveedor, sin IVA. Opcional, y el cliente nunca lo ve: sirve para ver el margen en
              Reportes.
            </p>
            {margin && (
              <p className="mt-1 text-xs font-medium text-success">
                Con este costo te queda {margin.retail}% de margen vendiendo al minorista
                {margin.wholesale !== null && ` y ${margin.wholesale}% al mayorista`}.
              </p>
            )}
            {err?.costNet && <p className="text-xs text-danger mt-1">{err.costNet}</p>}
          </div>

          <div>
            <label htmlFor="wholesaleMinQuantity" className="block text-sm font-medium text-ink mb-1">
              Mínimo para precio mayorista
            </label>
            <input
              id="wholesaleMinQuantity"
              name="wholesaleMinQuantity"
              type="number"
              step="1"
              min="1"
              required
              defaultValue={(defaultValues?.wholesaleMinQuantity ?? 1).toString()}
              className="neu-input"
            />
            <p className="text-xs text-ink-subtle mt-1">
              Unidades de este producto en un mismo pedido. 1 = sin mínimo. Por debajo, el mayorista
              paga precio minorista.
            </p>
            {err?.wholesaleMinQuantity && (
              <p className="text-xs text-danger mt-1">{err.wholesaleMinQuantity}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1">IVA %</label>
            <input
              name="vatRate"
              type="number"
              step="0.01"
              min="0"
              max="100"
              required
              value={vatRate}
              onChange={(e) => setVatRate(e.target.value)}
              className="neu-input"
            />
            {err?.vatRate && <p className="text-xs text-danger mt-1">{err.vatRate}</p>}
          </div>
        </div>

        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-ink-subtle">
            <tr>
              <th className="text-left font-medium py-1"></th>
              <th className="text-right font-medium py-1">Neto</th>
              <th className="text-right font-medium py-1">IVA {vat}%</th>
              <th className="text-right font-medium py-1">Precio final</th>
            </tr>
          </thead>
          <tbody>
            <BreakdownRow label="Minorista" breakdown={retail} />
            <BreakdownRow label="Mayorista" breakdown={wholesale} />
          </tbody>
        </table>

        <p className="text-xs text-ink-subtle">
          El precio final es el que se guarda y el que ve el cliente en la web.
        </p>
      </div>

      {imagesSlot}

      <div className="grid grid-cols-2 gap-4">
        <TextField
          label="Código de barras"
          name="barcode"
          defaultValue={defaultValues?.barcode ?? ""}
          error={err?.barcode}
          hint="El del envase, para leerlo con el escáner en el mostrador. Distinto del SKU."
        />
        <TextField
          label="Unidad de medida"
          name="unit"
          defaultValue={defaultValues?.unit ?? "unidad"}
          error={err?.unit}
        />
        <TextField
          label="Stock mínimo (alerta)"
          name="stockMinimum"
          type="number"
          step="any"
          defaultValue={(defaultValues?.stockMinimum ?? 0).toString()}
          error={err?.stockMinimum}
        />
      </div>

      {/* Arena, piedra, cal a granel: se venden 2,5 m³. Los productos por
          unidad quedan como están, y la base rechaza medias unidades. */}
      <label className="neu-inset flex items-start gap-2 p-3 text-sm text-ink">
        <input
          type="checkbox"
          name="decimalQuantity"
          defaultChecked={defaultValues?.decimalQuantity ?? false}
          className="mt-0.5"
        />
        <span>
          Se vende con decimales
          <span className="block text-xs text-ink-muted">
            Para lo que se mide: metros cúbicos, kilos, metros. Permite vender 2,5. Si queda
            destildado, solo se puede vender por unidades enteras.
          </span>
        </span>
      </label>

      {showInitialStock && (
        <TextField
          label="Stock inicial"
          name="initialStock"
          type="number"
          step="any"
          defaultValue="0"
          hint="Se registra como movimiento de entrada por compra, con trazabilidad."
        />
      )}

      <button
        type="submit"
        disabled={loading}
        className="neu-btn neu-btn-primary"
      >
        {loading ? "Guardando..." : "Guardar producto"}
      </button>
    </form>
  );
}

function BreakdownRow({
  label,
  breakdown,
}: {
  label: string;
  breakdown: { net: number; vat: number; gross: number };
}) {
  return (
    <tr className="neu-row">
      <td className="py-1.5 text-ink-muted">{label}</td>
      <td className="py-1.5 text-right tabular-nums">{formatMoney(breakdown.net)}</td>
      <td className="py-1.5 text-right tabular-nums text-ink-muted">
        {formatMoney(breakdown.vat)}
      </td>
      <td className="py-1.5 text-right tabular-nums font-semibold">
        {formatMoney(breakdown.gross)}
      </td>
    </tr>
  );
}

function formatMoney(amount: number): string {
  return `$ ${amount.toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function TextField({
  label,
  name,
  type = "text",
  step,
  defaultValue,
  error,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  step?: string;
  defaultValue?: string;
  error?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">{label}</label>
      <input
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        required={name !== "brand" && name !== "initialStock"}
        className="neu-input"
      />
      {hint && <p className="text-xs text-ink-subtle mt-1">{hint}</p>}
      {error && <p className="text-xs text-danger mt-1">{error}</p>}
    </div>
  );
}
