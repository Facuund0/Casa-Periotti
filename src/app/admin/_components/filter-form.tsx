import Link from "next/link";

export interface StatusOption {
  value: string;
  label: string;
}

/**
 * Barra de filtros de los listados del panel: rango de fechas, estado y
 * buscador.
 *
 * Es un form GET común, sin JavaScript: el navegador arma la query
 * string y la página (Server Component) vuelve a consultar con los
 * filtros nuevos. Dos ventajas sobre manejarlo con estado de cliente:
 * los filtros quedan en la URL (se puede recargar y compartir), y al
 * filtrar se pierde el parámetro `page`, así que siempre se vuelve a la
 * primera página — que es lo correcto, porque el resultado es otro.
 */
export function FilterForm({
  basePath,
  from,
  to,
  status,
  q,
  statusOptions,
  statusLabel = "Estado",
  searchLabel = "Buscar",
  searchPlaceholder,
}: {
  basePath: string;
  from?: string;
  to?: string;
  status?: string;
  q?: string;
  statusOptions: StatusOption[];
  statusLabel?: string;
  searchLabel?: string;
  searchPlaceholder: string;
}) {
  const hasFilters = Boolean(from || to || status || q);

  return (
    <form
      method="get"
      action={basePath}
      className="neu-card mb-4 flex flex-wrap items-end gap-3 p-4"
    >
      <label className="text-xs text-ink-muted">
        <span className="block mb-1">Desde</span>
        <input
          type="date"
          name="from"
          defaultValue={from ?? ""}
          className="neu-input !px-2 !py-1.5"
        />
      </label>

      <label className="text-xs text-ink-muted">
        <span className="block mb-1">Hasta</span>
        <input
          type="date"
          name="to"
          defaultValue={to ?? ""}
          className="neu-input !px-2 !py-1.5"
        />
      </label>

      <label className="text-xs text-ink-muted">
        <span className="block mb-1">{statusLabel}</span>
        <select
          name="status"
          defaultValue={status ?? ""}
          className="neu-input !px-2 !py-1.5"
        >
          <option value="">Todos</option>
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="text-xs text-ink-muted flex-1 min-w-[220px]">
        <span className="block mb-1">{searchLabel}</span>
        <input
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder={searchPlaceholder}
          className="neu-input !px-2 !py-1.5"
        />
      </label>

      <button className="neu-btn neu-btn-primary !px-4 !py-2 !text-xs">Filtrar</button>

      {hasFilters && (
        <Link href={basePath} className="text-xs text-ink-muted hover:underline px-1 py-2">
          Limpiar
        </Link>
      )}
    </form>
  );
}
