/**
 * Redimensionado y conversión a webp en el navegador, antes de subir.
 *
 * Se hace del lado del cliente a propósito: lo que viaja por la red es
 * la imagen ya liviana (una foto de celular de 4 MB queda en ~200 KB),
 * el servidor no tiene que procesar nada y no hace falta agregar una
 * dependencia nativa como sharp. El servidor igual revalida tipo y
 * tamaño de lo que recibe (ver image-config.ts).
 *
 * Solo corre en el navegador — usa createImageBitmap y canvas.
 */

import {
  PRODUCT_IMAGE_MAX_DIMENSION,
  PRODUCT_IMAGE_WEBP_QUALITY,
} from "./image-config";

export class ImageProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageProcessingError";
  }
}

/**
 * Devuelve la imagen redimensionada y convertida a webp. Si el
 * navegador no puede codificar webp, cae a JPEG (que soporta desde
 * siempre) en vez de fallar.
 */
export async function prepareProductImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new ImageProcessingError(`"${file.name}" no es una imagen.`);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Pasa sobre todo con HEIC de iPhone en navegadores que no lo
    // decodifican. Es mejor decirlo claro que subir un archivo que
    // después no se va a poder mostrar en el catálogo.
    throw new ImageProcessingError(
      `No se pudo leer "${file.name}". Si es una foto de iPhone (HEIC), convertila a JPG antes de subirla.`
    );
  }

  const { width, height } = fitWithin(
    bitmap.width,
    bitmap.height,
    PRODUCT_IMAGE_MAX_DIMENSION
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new ImageProcessingError("El navegador no pudo procesar la imagen.");
  }

  // Fondo blanco: un PNG con transparencia convertido a webp/jpeg
  // quedaría con el fondo negro si no se pinta antes.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const webp = await toBlob(canvas, "image/webp", PRODUCT_IMAGE_WEBP_QUALITY);
  const blob = webp ?? (await toBlob(canvas, "image/jpeg", 0.85));

  if (!blob) {
    throw new ImageProcessingError("El navegador no pudo convertir la imagen.");
  }

  const extension = blob.type === "image/webp" ? "webp" : "jpg";
  return new File([blob], `${baseName(file.name)}.${extension}`, { type: blob.type });
}

/** Escala para que el lado más largo no pase de `max`, sin agrandar. */
function fitWithin(
  width: number,
  height: number,
  max: number
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const ratio = max / longest;
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob && blob.type === type ? blob : null),
      type,
      quality
    );
  });
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").slice(0, 60) || "imagen";
}
