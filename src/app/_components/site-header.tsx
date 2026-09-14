import Link from "next/link";
import { logoutAction } from "@/modules/auth/actions";
import { Logo } from "./logo";

/**
 * Header del sitio público. Es un Server Component: recibe si hay
 * cliente logueado en lugar de averiguarlo, así lo puede usar
 * cualquier página sin volver a consultar la sesión.
 *
 * Lleva siempre un link explícito al catálogo: el logo también vuelve
 * al inicio, pero después de registrarse uno cae en Mi cuenta y con el
 * logo solo no se entiende que ahí se vuelve a comprar.
 *
 * En celular la navegación baja a una segunda fila en vez de
 * apretarse contra el logo — es donde va a comprar la mayoría.
 */
export function SiteHeader({
  isLoggedIn,
  showLogout = false,
}: {
  isLoggedIn: boolean;
  showLogout?: boolean;
}) {
  return (
    <header className="sticky top-0 z-20 bg-surface/95 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="rounded-neu-sm" aria-label="Casa Periotti — inicio">
            <Logo size="lg" showTagline />
          </Link>

          <nav className="flex flex-wrap items-center gap-2">
            <Link href="/" className="neu-chip">
              Catálogo
            </Link>
            <Link href="/carrito" className="neu-chip">
              Carrito
            </Link>
            {isLoggedIn ? (
              <Link href="/mi-cuenta" className="neu-chip">
                Mi cuenta
              </Link>
            ) : (
              <>
                <Link href="/login" className="neu-chip">
                  Ingresar
                </Link>
                <Link
                  href="/registro"
                  className="neu-btn neu-btn-primary !px-4 !py-2 !text-[0.8125rem]"
                >
                  Registrarme
                </Link>
              </>
            )}
            {showLogout && (
              <form action={logoutAction}>
                <button className="neu-chip">Cerrar sesión</button>
              </form>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
