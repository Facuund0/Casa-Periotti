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
      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
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
                  <tr className="border-t border-neutral-100">
                    <td className="px-4 py-3 font-medium">{category.name}</td>
                    <td className="px-4 py-3 text-neutral-500 font-mono text-xs">
                      {category.slug}
                    </td>
                    <td className="px-4 py-3 text-neutral-500">{category.parentName ?? "—"}</td>
                    <td className="px-4 py-3 text-center tabular-nums text-neutral-500">
                      {category.displayOrder}
                    </td>
                    <td className="px-4 py-3 text-center tabular-nums">{category.productCount}</td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          category.active
                            ? "bg-green-100 text-green-700"
                            : "bg-neutral-100 text-neutral-500"
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
                          className="text-xs border border-neutral-300 rounded-md px-2.5 py-1 hover:bg-neutral-50"
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
                          className="text-xs border border-neutral-300 rounded-md px-2.5 py-1 hover:bg-neutral-50 disabled:opacity-50"
                        >
                          {category.active ? "Desactivar" : "Activar"}
                        </button>
                        {category.productCount === 0 && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => setConfirmingDelete(category.id)}
                            className="text-xs text-red-600 border border-red-200 rounded-md px-2.5 py-1 hover:bg-red-50 disabled:opacity-50"
                          >
                            Borrar
                          </button>
                        )}
                      </div>

                      {confirmingDelete === category.id && (
                        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-left">
                          <p className="text-xs text-neutral-700 mb-1.5">
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
                              className="text-xs bg-red-600 text-white rounded-md px-2.5 py-1 disabled:opacity-50"
                            >
                              {pending ? "Borrando..." : "Sí, borrar"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDelete(null)}
                              className="text-xs text-neutral-500 px-1 hover:underline"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}

                      {rowError?.id === category.id && (
                        <p className="text-[10px] text-red-600 mt-1 text-right max-w-[260px] ml-auto">
                          {rowError.message}
                        </p>
                      )}
                    </td>
                  </tr>

                  {editingId === category.id && (
                    <tr className="border-t border-neutral-100 bg-neutral-50">
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
                  <td colSpan={7} className="px-4 py-8 text-center text-neutral-400">
                    Todavía no hay categorías.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-neutral-200 p-4">
        {creating ? (
          <>
            <p className="text-sm font-medium mb-3">Nueva categoría</p>
            <CategoryForm categories={categories} onDone={() => setCreating(false)} />
          </>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-sm bg-neutral-900 text-white rounded-md px-4 py-2"
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
        <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-xs p-2">
          {result.error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Nombre</label>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
          />
          {err?.name && <p className="text-xs text-red-600 mt-1">{err.name}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">
            Slug (opcional)
          </label>
          <input
            name="slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="se genera del nombre"
            className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
          />
          <p className="text-xs text-neutral-400 mt-1">
            {effectiveSlug ? (
              <>
                URL: <span className="font-mono">/categoria/{effectiveSlug}</span>
              </>
            ) : (
              "Cargá el nombre para ver la URL"
            )}
          </p>
          {err?.slug && <p className="text-xs text-red-600 mt-1">{err.slug}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">
            Dentro de (opcional)
          </label>
          <select
            name="parentId"
            defaultValue={category?.parentId ?? ""}
            className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="">Ninguna (categoría principal)</option>
            {parentOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {err?.parentId && <p className="text-xs text-red-600 mt-1">{err.parentId}</p>}
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">
            Orden en el menú
          </label>
          <input
            name="displayOrder"
            type="number"
            min={0}
            defaultValue={category?.displayOrder ?? 0}
            className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
          />
          {err?.displayOrder && <p className="text-xs text-red-600 mt-1">{err.displayOrder}</p>}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="text-sm bg-neutral-900 text-white rounded-md px-4 py-2 disabled:opacity-50"
        >
          {saving ? "Guardando..." : category ? "Guardar cambios" : "Crear categoría"}
        </button>
        <button
          type="button"
          onClick={onDone}
          disabled={saving}
          className="text-sm text-neutral-500 px-2 hover:underline disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
