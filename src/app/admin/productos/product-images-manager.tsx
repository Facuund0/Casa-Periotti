"use client";

import { useState, useTransition } from "react";
import {
  uploadProductImageAction,
  deleteProductImageAction,
  reorderProductImagesAction,
} from "@/modules/products/image-actions";
import { prepareProductImage, ImageProcessingError } from "@/modules/products/client-image-processing";
import {
  PRODUCT_IMAGE_PICK_ACCEPT,
  PRODUCT_IMAGE_MAX_PER_PRODUCT,
  describeProductImageLimits,
  productImageUrl,
  validateProductImageFile,
} from "@/modules/products/image-config";
import type { ProductImageRow } from "@/modules/products/product-image-service";

/**
 * Carga y orden de las imágenes del catálogo.
 *
 * Vive fuera del <form> del producto a propósito: las imágenes se
 * suben de a una en el momento (cada una es su propia operación contra
 * Storage), no al guardar el producto. Así el empleado ve cada foto
 * subida al instante y no arriesga perder todo si algo falla.
 *
 * La primera imagen del orden es la que se muestra en el catálogo y en
 * el carrito.
 */
export function ProductImagesManager({
  productId,
  images: initialImages,
}: {
  productId: string;
  images: ProductImageRow[];
}) {
  const [images, setImages] = useState(initialImages);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const remaining = PRODUCT_IMAGE_MAX_PER_PRODUCT - images.length;
    if (remaining <= 0) {
      setError(
        `Este producto ya tiene ${PRODUCT_IMAGE_MAX_PER_PRODUCT} imágenes. Borrá alguna antes de subir otra.`
      );
      return;
    }

    const selected = Array.from(files).slice(0, remaining);
    if (selected.length < files.length) {
      setError(`Solo se subieron las primeras ${selected.length}: es el máximo que queda libre.`);
    }

    for (const [index, original] of selected.entries()) {
      setProgress(`Procesando ${index + 1} de ${selected.length}...`);

      let prepared: File;
      try {
        // Redimensionado y conversión a webp acá, antes de que viaje
        // por la red (ver client-image-processing.ts).
        prepared = await prepareProductImage(original);
      } catch (err) {
        setProgress(null);
        setError(
          err instanceof ImageProcessingError ? err.message : `No se pudo procesar "${original.name}".`
        );
        return;
      }

      // Misma validación que hace el servidor, para dar el error al
      // instante en vez de después de subir.
      const invalid = validateProductImageFile({ type: prepared.type, size: prepared.size });
      if (invalid) {
        setProgress(null);
        setError(invalid);
        return;
      }

      setProgress(`Subiendo ${index + 1} de ${selected.length}...`);

      const formData = new FormData();
      formData.set("productId", productId);
      formData.set("image", prepared);

      const res = await uploadProductImageAction(formData);
      if (res.error) {
        setProgress(null);
        setError(res.error);
        return;
      }
      if (res.image) setImages((prev) => [...prev, res.image!]);
    }

    setProgress(null);
  }

  function handleDelete(imageId: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteProductImageAction(imageId);
      if (res.error) setError(res.error);
      else setImages((prev) => prev.filter((img) => img.id !== imageId));
    });
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;

    const reordered = [...images];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setImages(reordered);
    setError(null);

    startTransition(async () => {
      const res = await reorderProductImagesAction(
        productId,
        reordered.map((img) => img.id)
      );
      // Si el servidor rechaza el reorden, se vuelve al orden anterior
      // para no mostrar algo distinto de lo que quedó guardado.
      if (res.error) {
        setError(res.error);
        setImages(images);
      }
    });
  }

  return (
    <div className="rounded-md border border-neutral-200 p-4 space-y-3">
      <div>
        <p className="text-sm font-medium text-neutral-700">Imágenes</p>
        <p className="text-xs text-neutral-400">{describeProductImageLimits()}</p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-xs p-2">
          {error}
        </div>
      )}

      {images.length > 0 && (
        <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {images.map((image, index) => (
            <li key={image.id} className="border border-neutral-200 rounded-md overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={productImageUrl(image.storagePath)}
                alt={image.altText ?? ""}
                className="w-full aspect-square object-cover bg-neutral-50"
              />
              <div className="flex items-center justify-between px-1.5 py-1 gap-1">
                <span className="text-[10px] text-neutral-400">
                  {index === 0 ? "Principal" : index + 1}
                </span>
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={pending || index === 0}
                    title="Mover antes"
                    className="text-xs px-1 text-neutral-500 hover:text-neutral-900 disabled:opacity-25"
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={pending || index === images.length - 1}
                    title="Mover después"
                    className="text-xs px-1 text-neutral-500 hover:text-neutral-900 disabled:opacity-25"
                  >
                    →
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(image.id)}
                    disabled={pending}
                    title="Eliminar"
                    className="text-xs px-1 text-red-600 hover:underline disabled:opacity-40"
                  >
                    ✕
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-3">
        <label className="text-xs border border-neutral-300 rounded-md px-3 py-2 cursor-pointer hover:bg-neutral-50">
          Agregar imágenes
          <input
            type="file"
            accept={PRODUCT_IMAGE_PICK_ACCEPT}
            multiple
            className="hidden"
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        {progress && <p className="text-xs text-neutral-500">{progress}</p>}
        {images.length === 0 && !progress && (
          <p className="text-xs text-neutral-400">
            Sin imágenes: el producto se muestra con un recuadro gris.
          </p>
        )}
      </div>
    </div>
  );
}
