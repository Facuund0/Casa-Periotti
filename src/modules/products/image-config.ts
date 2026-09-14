/**
 * Configuración de las imágenes de producto, compartida por el
 * navegador y el servidor.
 *
 * Las imágenes son lo que más espacio ocupa en un e-commerce, así que
 * se redimensionan y se convierten a webp ANTES de subirlas (ver
 * client-image-processing.ts). El servidor vuelve a validar tipo y
 * tamaño: la conversión del navegador es una optimización, no una
 * garantía — nunca se confía en ella.
 *
 * A diferencia del bucket de comprobantes, este es PÚBLICO: son fotos
 * del catálogo, las tiene que poder ver cualquiera que entre a la web,
 * y firmar una URL por imagen en cada carga de página no tendría
 * sentido.
 *
 * Este archivo no lleva "server-only" a propósito: el componente
 * cliente necesita las mismas constantes y la misma validación.
 */

export const PRODUCT_IMAGE_BUCKET = "productos";

/** Lado máximo en píxeles. Alcanza de sobra para el detalle de producto. */
export const PRODUCT_IMAGE_MAX_DIMENSION = 1200;

/** Calidad de la conversión a webp: buen balance entre peso y nitidez. */
export const PRODUCT_IMAGE_WEBP_QUALITY = 0.82;

/**
 * Tope del archivo YA convertido. Un webp de 1200px pesa normalmente
 * entre 100 y 300 KB, así que 2 MB deja margen de sobra y a la vez
 * corta cualquier cosa que no haya pasado por la conversión.
 */
export const PRODUCT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/** Lo que el servidor acepta guardar. */
export const PRODUCT_IMAGE_ALLOWED_MIMES = ["image/webp", "image/jpeg", "image/png"] as const;

/** Lo que el selector de archivos deja elegir, antes de convertir. */
export const PRODUCT_IMAGE_PICK_ACCEPT = "image/*";

export const PRODUCT_IMAGE_MAX_PER_PRODUCT = 8;

export function describeProductImageLimits(): string {
  return `Hasta ${PRODUCT_IMAGE_MAX_PER_PRODUCT} imágenes por producto. Se redimensionan a ${PRODUCT_IMAGE_MAX_DIMENSION}px y se convierten a webp automáticamente.`;
}

/**
 * Validación del archivo que se va a guardar. Devuelve null si está
 * bien, o el mensaje listo para mostrar.
 */
export function validateProductImageFile(file: { type: string; size: number }): string | null {
  if (!PRODUCT_IMAGE_ALLOWED_MIMES.includes(file.type as (typeof PRODUCT_IMAGE_ALLOWED_MIMES)[number])) {
    return `Ese tipo de archivo no se puede subir (${file.type || "desconocido"}). Tiene que ser una imagen JPG, PNG o WEBP.`;
  }
  if (file.size === 0) return "El archivo está vacío.";
  if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
    return `La imagen quedó en ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo es ${
      PRODUCT_IMAGE_MAX_BYTES / 1024 / 1024
    } MB.`;
  }
  return null;
}

/**
 * URL pública de una imagen del catálogo. Se arma a mano en vez de
 * pedirle la URL al cliente de Supabase porque es una plantilla fija y
 * así funciona igual en un Server Component, en el navegador y sin
 * instanciar nada.
 */
export function productImageUrl(storagePath: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${storagePath}`;
}
