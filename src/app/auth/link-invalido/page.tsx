import Link from "next/link";
import { resendConfirmationAction } from "@/modules/auth/actions";
import { firstParam } from "@/shared/utils/search-params";
import { AuthEmailForm } from "../../_components/auth-email-form";
import { AuthShell } from "../../_components/auth-shell";

/** Destino de /auth/confirm cuando el link venció, ya se usó o no es válido. */
export default async function LinkInvalidoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tipo = firstParam((await searchParams).tipo);

  if (tipo === "recuperacion") {
    return (
      <AuthShell>
        <h1 className="text-xl font-bold text-ink">El link venció</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Los links para crear una contraseña nueva sirven una sola vez y vencen al rato. Pedí uno
          nuevo y abrilo apenas te llegue.
        </p>
        <Link href="/recuperar-contrasena" className="neu-btn neu-btn-primary mt-6 w-full">
          Pedir un link nuevo
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <h1 className="text-xl font-bold text-ink">No pudimos confirmar con este link</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Puede que ya lo hayas usado, que haya vencido, o que lo hayas abierto en otro dispositivo.
        Si ya confirmaste tu email, iniciá sesión. Si no, pedí que te reenviemos el correo.
      </p>
      <Link href="/login" className="neu-btn neu-btn-primary mt-6 w-full">
        Iniciar sesión
      </Link>
      <div className="mt-6 border-t border-[color:var(--hairline)] pt-6">
        <AuthEmailForm
          id="resend-email"
          action={resendConfirmationAction}
          submitLabel="Reenviar el correo de confirmación"
          pendingLabel="Reenviando..."
        />
      </div>
    </AuthShell>
  );
}
