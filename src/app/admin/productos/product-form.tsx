"use client";

import { useState } from "react";
import type { AdminActionResult } from "@/modules/products/admin-actions";

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
    priceRetail: number;
    priceWholesale: number;
    vatRate: number;
    unit: string;
    stockMinimum: number;
  };
  showInitialStock?: boolean;
}

export function ProductForm({ categories, action, defaultValues, showInitialStock }: ProductFormProps) {
  const [result, setResult] = useState<AdminActionResult | null>(null);
  const [loading, setLoading] = useState(false);

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

      <div className="grid grid-cols-3 gap-4">
        <TextField
          label="Precio minorista"
          name="priceRetail"
          type="number"
          step="0.01"
          defaultValue={defaultValues?.priceRetail?.toString()}
          error={err?.priceRetail}
        />
        <TextField
          label="Precio mayorista"
          name="priceWholesale"
          type="number"
          step="0.01"
          defaultValue={defaultValues?.priceWholesale?.toString()}
          error={err?.priceWholesale}
        />
        <TextField
          label="IVA %"
          name="vatRate"
          type="number"
          step="0.01"
          defaultValue={(defaultValues?.vatRate ?? 21).toString()}
          error={err?.vatRate}
        />
      </div>

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
