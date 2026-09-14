/**
 * Logo de Casa Periotti.
 *
 * PENDIENTE: todavía no tengo el archivo del logo, así que por ahora
 * esto reproduce el logotipo con tipografía, respetando la identidad
 * (CASA en el gris del logo, PERIOTTI en el azul corporativo). No
 * intenta dibujar el monograma "CP", porque adivinar la forma de un
 * isotipo queda peor que no ponerlo.
 *
 * Cuando el archivo esté en `public/logo.svg` (o .png), se cambia solo
 * el interior de este componente por un <Image> y queda aplicado en
 * los tres lugares de una vez: header del sitio, sidebar del panel y
 * cabecera del PDF de la factura.
 */
export function Logo({
  size = "md",
  showTagline = false,
}: {
  size?: "sm" | "md" | "lg";
  showTagline?: boolean;
}) {
  const wordmark = {
    sm: "text-sm",
    md: "text-lg",
    lg: "text-2xl",
  }[size];

  return (
    <span className="inline-flex flex-col leading-none">
      <span className={`${wordmark} font-bold tracking-tight`}>
        <span className="text-secondary">CASA</span>{" "}
        <span className="text-brand">PERIOTTI</span>
      </span>
      {showTagline && (
        <span className="mt-1 text-[0.6875rem] font-medium text-ink-subtle">
          Sunchales, Santa Fe
        </span>
      )}
    </span>
  );
}
