import Link from "next/link";
import { requestPasswordResetAction } from "@/modules/auth/actions";
import { AuthEmailForm } from "../_components/auth-email-form";
import { AuthShell } from "../_components/auth-shell";

export default function RecuperarContrasenaPage() {
  return (
    <AuthShell>
      <h1 className="text-xl font-bold text-ink">Recuperar contraseña</h1>
      <p className="mt-1 mb-6 text-sm text-ink-muted">
        Ingresá el email de tu cuenta y te mandamos un link para crear una contraseña nueva.
      </p>
      <AuthEmailForm
        id="recovery-email"
        action={requestPasswordResetAction}
        submitLabel="Enviarme el link"
        pendingLabel="Enviando..."
      />
      <p className="mt-6 text-center text-sm text-ink-muted">
        ¿Te acordaste?{" "}
        <Link href="/login" className="font-semibold text-brand hover:underline">
          Iniciá sesión
        </Link>
      </p>
    </AuthShell>
  );
}
