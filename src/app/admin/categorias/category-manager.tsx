"use client";

import { Fragment, useState, useTransition } from "react";
import {
  createCategoryAction,
  updateCategoryAction,
  setCategoryActiveAction,
  deleteCategoryAction,
  type CategoryActionResult,
} from "@/modules/products/category-actions";
import type { CategoryAdminRow } from "@/modules/products/category-admin-service";
import { slugify } from "@/shared/utils/slugify";

/**
 * Alta, edición, activación y borrado de categorías.
 *
 * Desactivar y borrar son cosas distintas a propósito: desactivar saca
 * la categoría de la web dejando los productos intactos, y borrar solo
 * se ofrece cuando la categoría está vacía (el servidor lo vuelve a
 * verificar igual).
 */
export function CategoryManager({ categories }: { categories: CategoryAdminRow[] }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  function runRowAction(categoryId: string, action: () => Promise<CategoryActionResult>) {
    setRowError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) setRowError({ id: categoryId, message: res.error });
      else setConfirmingDelete(null);
    });
  }

  return (
    <div className="space-y-6">
      <div className="neu-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="neu-table-head text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Nombre</th>
                <th className="text-left px-4 py-3">Slug</th>
                <th className="text-left px-4 py-3">Dentro de</th>
                <th className="text-center px-4 py-3">Orden</th>
                <th className="text-center px-4 py-3">Productos</th>
                <th className="text-center px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                // La key va en el Fragment porque cada categoría rinde
                // dos <tr>: la fila y, si se está editando, el formulario.
                <Fragment key={category.id}>
                  <tr className="neu-row">
                    <td className="px-4 py-3 font-medium">{category.name}</td>
                    <td className="px-4 py-3 text-ink-muted font-mono text-xs">
                      {category.slug}
                    </td>
                    <td className="px-4 py-3 text-ink-muted">{category.parentName ?? "—"}</td>
                    <td className="px-4 py-3 text-center tabular-nums text-ink-muted">
                      {category.displayOrder}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">{category.productCount}</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`neu-badge ${
                          category.active
                            ? "bg-success-soft text-success"
                            : "bg-surface-sunken text-ink-muted"
                        }`}
                      >
                        {category.active ? "Activa" : "Inactiva"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 justify-end flex-wrap">
                        <button
                          type="button"
                          onClick={() =>
                            setEditingId(editingId === category.id ? null : category.id)
                          }
                          className="neu-btn !px-2.5 !py-1 !text-xs"
                        >
                          {editingId === category.id ? "Cerrar" : "Editar"}
                        </button>
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            runRowAction(category.id, () =>
                              setCategoryActiveAction(category.id, !category.active)
                            )
                          }
                          className="neu-btn !px-2.5 !py-1 !text-xs"
                        >
                          {category.active ? "Desactivar" : "Activar"}
                        </button>
                        {category.productCount === 0 && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => setConfirmingDelete(category.id)}
                            className="neu-btn neu-btn-danger !px-2.5 !py-1 !text-xs"
                          >
                            Borrar
                          </button>
                        )}
                      </div>

                      {confirmingDelete === category.id && (
                        <div className="neu-inset mt-2 p-2 text-left">
                          <p className="text-xs text-ink mb-1.5">
                            Se borra &quot;{category.name}&quot; definitivamente. No tiene productos
                            asociados.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() =>
                                runRowAction(category.id, () => deleteCategoryAction(category.id))
                              }
                              className="neu-btn neu-btn-danger !px-2.5 !py-1 !text-xs"
                            >
                              {pending ? "Borrando..." : "Sí, borrar"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDelete(null)}
                              className="text-xs text-ink-muted px-1 hover:underline"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}

                      {rowError?.id === category.id && (
                        <p className="text-[10px] text-danger mt-1 text-right max-w-[260px] ml-auto">
                          {rowError.message}
                        </p>
                      )}
                    </td>
                  </tr>

                  {editingId === category.id && (
                    <tr className="border-t border-[color:var(--hairline)] bg-surface-sunken">
                      <td colSpan={7} className="px-4 py-4">
                        <CategoryForm
                          categories={categories}
                          category={category}
                          onDone={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}

              {categories.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-ink-subtle">
                    Todavía no hay categorías.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="neu-card p-4">
        {creating ? (
          <>
            <p className="text-sm font-medium mb-3">Nueva categoría</p>
            <CategoryForm categories={categories} onDone={() => setCreating(false)} />
          </>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="neu-btn neu-btn-primary"
          >
            Nueva categoría
          </button>
        )}
      </div>
    </div>
  );
}

function CategoryForm({
  categories,
  category,
  onDone,
}: {
  categories: CategoryAdminRow[];
  category?: CategoryAdminRow;
  onDone: () => void;
}) {
  const [result, setResult] = useState<CategoryActionResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");

  // Vista previa del slug que se va a guardar: si el campo está vacío
  // se genera del nombre, con la misma función que usa el servidor.
  const effectiveSlug = slug.trim() ? slugify(slug) : slugify(name);

  async function handleSubmit(formData: FormData) {
    setSaving(true);
    setResult(null);
    const res = category
      ? await updateCategoryAction(category.id, formData)
      : await createCategoryAction(formData);
    setResult(res);
    setSaving(false);
    if (res.ok) onDone();
  }

  const err = result?.fieldErrors;
  // No se puede elegir a sí misma como padre; el resto de los ciclos
  // los rechaza el servidor.
  const parentOptions = categories.filter((c) => c.id !== category?.id);

  return (
    <form action={handleSubmit} className="space-y-3">
      {result?.error && (
        <div className="rounded-neu bg-danger-soft p-2 text-xs font-medium text-danger">
          {result.error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1">Nombre</label>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="neu-input"
          />
          {err?.name && <p className="text-xs text-danger mt-1">{err.name}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1">
            Slug (opcional)
          </label>
          <input
            name="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="se genera del nombre"
            className="neu-input"
          />
          <p className="text-xs text-ink-subtle mt-1">
            {effectiveSlug ? (
              <>
                URL: <span className="font-mono">/categoria/{effectiveSlug}</span>
              </>
            ) : (
              "Cargá el nombre para ver la URL"
            )}
          </p>
          {err?.slug && <p className="text-xs text-danger mt-1">{err.slug}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1">
            Dentro de (opcional)
          </label>
          <select
            name="parentId"
            defaultValue={category?.parentId ?? ""}
            className="neu-input"
          >
            <option value="">Ninguna (categoría principal)</option>
            {parentOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {err?.parentId && <p className="text-xs text-danger mt-1">{err.parentId}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1">
            Orden en el menú
          </label>
          <input
            name="displayOrder"
            type="number"
            min={0}
            defaultValue={category?.displayOrder ?? 0}
            className="neu-input"
          />
          {err?.displayOrder && <p className="text-xs text-danger mt-1">{err.displayOrder}</p>}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="neu-btn neu-btn-primary !px-4 !py-2 !text-sm"
        >
          {saving ? "Guardando..." : category ? "Guardar cambios" : "Crear categoría"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={saving}
          className="text-sm text-ink-muted px-2 hover:underline disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
