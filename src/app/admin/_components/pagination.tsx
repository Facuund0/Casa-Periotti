import Link from "next/link";

/**
 * Paginación de los listados del panel. Navega por query string (no por
 * estado de cliente) para que los filtros y la página vivan en la URL:
 * el empleado puede recargar, compartir el link o volver atrás y ver lo
 * mismo.
 *
 * `params` son los filtros vigentes, que se arrastran en cada link —
 * cambiar de página nunca resetea el filtro.
 */
export function Pagination({
  basePath,
  params,
  page,
  pageCount,
  total,
  pageSize,
  emptyLabel,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  emptyLabel: string;
}) {
  const firstOnPage = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastOnPage = Math.min(page * pageSize, total);

  function hrefForPage(target: number): string {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, value);
    }
    if (target > 1) query.set("page", String(target));
    const qs = query.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-neutral-100 text-xs text-neutral-500">
      <p>
        {total === 0
          ? emptyLabel
          : `Mostrando ${firstOnPage}–${lastOnPage} de ${total.toLocaleString("es-AR")}`}
      </p>

      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link
              href={hrefForPage(page - 1)}
              className="border border-neutral-300 rounded-md px-2.5 py-1 hover:bg-neutral-50"
            >
              Anterior
            </Link>
          ) : (
            <span className="border border-neutral-200 rounded-md px-2.5 py-1 text-neutral-300">
              Anterior
            </span>
          )}

          <span className="tabular-nums">
            Página {page} de {pageCount}
          </span>

          {page < pageCount ? (
            <Link
              href={hrefForPage(page + 1)}
              className="border border-neutral-300 rounded-md px-2.5 py-1 hover:bg-neutral-50"
            >
              Siguiente
            </Link>
          ) : (
            <span className="border border-neutral-200 rounded-md px-2.5 py-1 text-neutral-300">
              Siguiente
            </span>
          )}
        </div>
      )}
    </div>
  );
}
