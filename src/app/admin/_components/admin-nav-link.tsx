"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Item de navegación del panel.
 *
 * La sección activa se dibuja HUNDIDA, que es la forma que tiene el
 * neumorfismo de decir "esto está puesto" — el mismo lenguaje que un
 * botón presionado. El resto queda elevado y se eleva más al pasar el
 * mouse.
 *
 * Es cliente porque necesita saber la ruta actual.
 */
export function AdminNavLink({
  href,
  children,
  badge,
}: {
  href: string;
  children: React.ReactNode;
  badge?: number;
}) {
  const pathname = usePathname();
  // Coincidencia por prefijo para que /admin/productos/nuevo siga
  // marcando "Productos y stock" como la sección activa.
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`neu-chip shrink-0 whitespace-nowrap lg:w-full lg:justify-between lg:rounded-neu lg:px-3.5 lg:py-2.5 ${
        active ? "neu-chip-active font-semibold" : ""
      }`}
    >
      <span>{children}</span>
      {badge ? (
        <span className="neu-badge ml-2 bg-warning-soft text-warning">{badge}</span>
      ) : null}
    </Link>
  );
}
