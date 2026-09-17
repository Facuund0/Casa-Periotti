/**
 * Se muestra al instante al navegar dentro del panel, mientras el
 * servidor arma la página. Queda dentro del layout: el menú lateral no
 * desaparece, solo el contenido pasa a este esqueleto. También marca hasta
 * dónde puede precargar Next los links del menú.
 */
export default function AdminLoading() {
  return (
    <div role="status" aria-live="polite" className="space-y-5">
      <span className="sr-only">Cargando…</span>
      <div className="h-6 w-48 rounded-neu-sm bg-surface-sunken motion-safe:animate-pulse" />
      <div className="h-4 w-80 max-w-full rounded-neu-sm bg-surface-sunken motion-safe:animate-pulse" />
      <div className="neu-card space-y-3 p-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-4">
            <div className="h-4 flex-1 rounded-neu-sm bg-surface-sunken motion-safe:animate-pulse" />
            <div className="h-4 w-24 rounded-neu-sm bg-surface-sunken motion-safe:animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
