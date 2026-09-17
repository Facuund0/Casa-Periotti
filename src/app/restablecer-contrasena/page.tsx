import Link from "next/link";
import { hasRecentEmailLinkSession } from "@/modules/auth/recovery-session";
import { AuthShell } from "../_components/auth-shell";
import { NewPasswordForm } from "./new-password-form";

export const dynamic = "force-dynamic";

/**
 * Se llega desde el link del mail de recuperación (/auth/confirm abre la
 * sesión y redirige acá). Sin esa sesión reciente no se muestra el
 * formulario: nadie puede cambiar la contraseña de una cuenta con solo
 * tener la sesión iniciada.
 */
export default async function RestablecerContrasenaPage() {
  const allowed = await hasRecentEmailLinkSession();

  return (
    <AuthShell>
      <h1 className="text-xl font-bold text-ink">Contraseña nueva</h1>
      {allowed ? (
        <>
          <p className="mt-1 mb-6 text-sm text-ink-muted">
            Elegí la contraseña nueva para tu cuenta. Al guardarla se cierran las demás sesiones
            abiertas.
          </p>
          <NewPasswordForm />
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-muted">
            Para crear una contraseña nueva tenés que entrar desde el link que te mandamos por mail.
            Si el link venció o ya lo usaste, pedí uno nuevo.
          </p>
          <Link href="/recuperar-contrasena" className="neu-btn neu-btn-primary mt-6 w-full">
            Pedir un link nuevo
          </Link>
        </>
      )}
    </AuthShell>
  );
}
