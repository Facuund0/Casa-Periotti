"use client";

import { useEffect, useState } from "react";

/**
 * Aviso del panel que se puede cerrar con una X. Al cerrarlo se recuerda
 * (en este navegador) la versión que se cerró; si el servidor manda una
 * versión distinta (por ejemplo, un rechazo más nuevo), el aviso vuelve a
 * aparecer. No se muestra hasta leer esa memoria, para que un aviso ya
 * cerrado no aparezca por un instante al cargar la página.
 */
export function DismissibleAlert({
  storageKey,
  version,
  children,
}: {
  storageKey: string;
  version: string;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let dismissed: string | null = null;
    try {
      dismissed = window.localStorage.getItem(storageKey);
    } catch {
      // Sin acceso a localStorage (modo privado estricto): se muestra siempre.
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisible(dismissed !== version);
  }, [storageKey, version]);

  if (!visible) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(storageKey, version);
    } catch {
      // Si no se puede guardar, igual se oculta hasta recargar.
    }
    setVisible(false);
  }

  return (
    <div className="relative">
      {children}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Cerrar aviso"
        title="Cerrar aviso"
        className="absolute right-5 top-2 flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken hover:text-ink lg:right-1"
      >
        ×
      </button>
    </div>
  );
}
