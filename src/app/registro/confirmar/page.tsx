import Link from "next/link";
import { Logo } from "../../_components/logo";

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
            Te enviamos un email para confirmar tu cuenta. Una vez confirmada, ya podés iniciar
            sesión. Si pediste precio mayorista, un empleado de Casa Periotti va a revisar tu
            solicitud antes de habilitarte esos precios.
          </p>
          <Link href="/login" className="neu-btn neu-btn-primary mt-6 w-full">
            Ir a iniciar sesión
          </Link>
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
