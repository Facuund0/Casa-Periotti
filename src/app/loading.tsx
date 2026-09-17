/**
 * Se muestra al instante al navegar entre páginas públicas (catálogo,
 * producto, mi cuenta, checkout, pedido) mientras el servidor arma la
 * página, en vez de dejar la pantalla congelada en la anterior.
 */
export default function Loading() {
  return (
    <main role="status" aria-live="polite" className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <span className="sr-only">Cargando…</span>
      <div className="h-8 w-40 rounded-neu-sm bg-surface-sunken motion-safe:animate-pulse" />
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div key={i} className="neu-card space-y-3 p-3">
            <div className="aspect-square w-full rounded-neu-sm bg-surface-sunken motion-safe:animate-pulse" />
            <div className="h-4 w-3/4 rounded-neu-sm bg-surface-sunken motion-safe:animate-pulse" />
            <div className="h-4 w-1/3 rounded-neu-sm bg-surface-sunken motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    </main>
  );
}
