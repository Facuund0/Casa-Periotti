import Image from "next/image";

/**
 * Logo de Casa Periotti. Usa el archivo real de `public/logo.png`, que es
 * el mismo que embebe el PDF de la factura (ver invoice-pdf.ts) y del que
 * salen los iconos de la PWA y de las notificaciones (ver
 * docs/notificaciones-push.md).
 *
 * El archivo es horizontal (253×45) con fondo transparente, así que se
 * escala por alto y funciona igual en modo claro y oscuro.
 */
const LOGO_WIDTH = 253;
const LOGO_HEIGHT = 45;

const HEIGHTS = { sm: 18, md: 26, lg: 34 } as const;

export function Logo({
  size = "md",
  showTagline = false,
}: {
  size?: "sm" | "md" | "lg";
  showTagline?: boolean;
}) {
  const height = HEIGHTS[size];

  return (
    <span className="inline-flex flex-col leading-none">
      <Image
        src="/logo.png"
        alt="Casa Periotti"
        width={LOGO_WIDTH}
        height={LOGO_HEIGHT}
        style={{ height, width: "auto" }}
        // El logo está en el encabezado de todas las pantallas: conviene
        // que cargue con la primera pintura y no después.
        priority
      />
      {showTagline && (
        <span className="mt-1.5 text-[0.6875rem] font-medium text-ink-subtle">
          Sunchales, Santa Fe
        </span>
      )}
    </span>
  );
}
