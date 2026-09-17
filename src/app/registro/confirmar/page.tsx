import Link from "next/link";
import { Logo } from "../../_components/logo";
import { AuthEmailForm } from "../../_components/auth-email-form";
import { resendConfirmationAction } from "@/modules/auth/actions";

export default function ConfirmarRegistroPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" className="inline-block rounded-neu-sm">
            <Logo size="lg" showTagline />
          </Link>
        </div>

        <div className="neu-card p-6 text-center sm:p-8">
          <span className="neu-badge bg-success-soft text-success">Cuenta creada</span>
          <h1 className="mt-3 text-xl font-bold text-ink">¡Ya casi!</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Te enviamos un email para confirmar tu cuenta. <strong>Abrí el link del correo</strong>{" "}
            para activarla: hasta confirmarla no vas a poder iniciar sesión ni comprar. Si pediste
            precio mayorista, un empleado de Casa Periotti va a revisar tu solicitud antes de
            habilitarte esos precios.
          </p>
          <Link href="/login" className="neu-btn neu-btn-primary mt-6 w-full">
            Ya confirmé, iniciar sesión
          </Link>
          <div className="mt-6 border-t border-[color:var(--hairline)] pt-6 text-left">
            <p className="mb-3 text-sm text-ink-muted">
              ¿No te llegó? Revisá la carpeta de spam o pedí que te lo reenviemos.
            </p>
            <AuthEmailForm
              id="confirm-resend-email"
              action={resendConfirmationAction}
              submitLabel="Reenviar el correo"
              pendingLabel="Reenviando..."
            />
          </div>
        </div>

        <p className="mt-5 text-center">
          <Link href="/" className="neu-chip">
            Volver al catálogo
          </Link>
        </p>
      </div>
    </main>
  );
}
