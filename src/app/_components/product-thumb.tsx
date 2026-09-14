import Image from "next/image";
import { productImageUrl } from "@/modules/products/image-config";

/**
 * Imagen de producto para el catálogo, el detalle y el carrito.
 *
 * Un solo componente para los tres lugares: cuando el producto no
 * tiene imagen cargada queda el recuadro gris de siempre, así que
 * nunca hay un hueco roto ni una imagen fallada.
 *
 * Se usa next/image con `fill` sobre un contenedor con relación de
 * aspecto: las fotos del catálogo no vienen todas del mismo tamaño y
 * `object-cover` las recorta parejo sin deformarlas.
 */
export function ProductThumb({
  storagePath,
  alt,
  className = "aspect-square rounded-md",
  sizes = "(max-width: 768px) 50vw, 25vw",
  priority = false,
}: {
  storagePath?: string | null;
  alt: string;
  className?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <div className={`relative overflow-hidden bg-neutral-100 ${className}`}>
      {storagePath && (
        <Image
          src={productImageUrl(storagePath)}
          alt={alt}
          fill
          sizes={sizes}
          priority={priority}
          className="object-cover"
        />
      )}
    </div>
  );
}
