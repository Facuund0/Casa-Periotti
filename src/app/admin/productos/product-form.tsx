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

  const vat = Number(vatRate) || 0;
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
        <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-sm p-3">
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
        <label className="block text-sm font-medium text-neutral-700 mb-1">Descripción</label>
        <textarea
          name="description"
          defaultValue={defaultValues?.description ?? ""}
          rows={3}
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-neutral-700 mb-1">Categoría</label>
        <select
          name="categoryId"
          defaultValue={defaultValues?.categoryId ?? ""}
          required
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
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
        {err?.categoryId && <p className="text-xs text-red-600 mt-1">{err.categoryId}</p>}
      </div>

      <div className="rounded-md border border-neutral-200 p-4 space-y-3">
        <div>
          <p className="text-sm font-medium text-neutral-700">Precios</p>
          <p className="text-xs text-neutral-400">
            Se cargan <span className="font-medium">sin IVA</span>, como vienen del proveedor. El
            precio final lo calcula el sistema.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Minorista sin IVA
            </label>
            <input
              name="priceRetailNet"
              type="number"
              step="0.01"
              min="0"
              required
              value={retailNet}
              onChange={(e) => setRetailNet(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            {err?.priceRetailNet && (
              <p className="text-xs text-red-600 mt-1">{err.priceRetailNet}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">
              Mayorista sin IVA
            </label>
            <input
              name="priceWholesaleNet"
              type="number"
              step="0.01"
              min="0"
              required
              value={wholesaleNet}
              onChange={(e) => setWholesaleNet(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            {err?.priceWholesaleNet && (
              <p className="text-xs text-red-600 mt-1">{err.priceWholesaleNet}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">IVA %</label>
            <input
              name="vatRate"
              type="number"
              step="0.01"
              min="0"
              max="100"
              required
              value={vatRate}
              onChange={(e) => setVatRate(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
            {err?.vatRate && <p className="text-xs text-red-600 mt-1">{err.vatRate}</p>}
          </div>
        </div>

        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-400">
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

        <p className="text-xs text-neutral-400">
          El precio final es el que se guarda y el que ve el cliente en la web.
        </p>
      </div>

      {imagesSlot}

      <div className="grid grid-cols-2 gap-4">
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
          defaultValue={(defaultValues?.stockMinimum ?? 0).toString()}
          error={err?.stockMinimum}
        />
      </div>

      {showInitialStock && (
        <TextField
          label="Stock inicial"
          name="initialStock"
          type="number"
          defaultValue="0"
          hint="Se registra como movimiento de entrada por compra, con trazabilidad."
        />
      )}

      <button
        type="submit"
        disabled={loading}
        className="bg-neutral-900 text-white rounded-md px-4 py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
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
    <tr className="border-t border-neutral-100">
      <td className="py-1.5 text-neutral-500">{label}</td>
      <td className="py-1.5 text-right tabular-nums">{formatMoney(breakdown.net)}</td>
      <td className="py-1.5 text-right tabular-nums text-neutral-500">
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
      <label className="block text-sm font-medium text-neutral-700 mb-1">{label}</label>
      <input
        name={name}
        type={type}
        step={step}
        defaultValue={defaultValue}
        required={name !== "brand" && name !== "initialStock"}
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
      {hint && <p className="text-xs text-neutral-400 mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
