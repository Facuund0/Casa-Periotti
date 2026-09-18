"use client";

import { useEffect } from "react";

/**
 * Abre el diálogo de impresión una sola vez al entrar con ?auto=1, para
 * que el empleado no tenga que hacer un clic extra después de cobrar.
 */
export function PrintOnLoad() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
