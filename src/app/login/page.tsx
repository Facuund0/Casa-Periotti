"use client";

import { useState } from "react";
import { loginAction, resendConfirmationAction, type AuthActionResult } from "@/modules/auth/actions";
import Link from "next/link";
import { Logo } from "../_components/logo";
import { AuthEmailForm } from "../_components/auth-email-form";

export default function LoginPage() {
  const [result, setResult] = useState<AuthActionResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setResult(null);
    const res = await loginAction(formData);
    setResult(res);
    setLoading(false);
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" className="inline-block rounded-neu-sm">
            <Logo size="lg" showTagline />
          </Link>
        </div>

        <div className="neu-card p-6 sm:p-8">
          <h1 className="text-xl font-bold text-ink">Ingresar</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Entrá con tu cuenta para ver tus pedidos y tus precios.
          </p>

          {result?.error && (
            <div className="mt-4 rounded-neu bg-danger-soft p-3 text-sm font-medium text-danger">
              {result.error}
            </div>
          )}

          {/* Email sin confirmar: se ofrece reenviar el correo ahí mismo. */}
          {result?.unconfirmedEmail && (
            <div className="mt-4 neu-inset p-4">
              <p className="mb-3 text-sm text-ink-muted">
                ¿No te llegó o se venció? Te lo reenviamos.
              </p>
              <AuthEmailForm
                id="login-resend-email"
                action={resendConfirmationAction}
                defaultEmail={result.unconfirmedEmail}
                submitLabel="Reenviar el correo de confirmación"
                pendingLabel="Reenviando..."
              />
            </div>
          )}

          <form action={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-ink">
                Email
              </label>
              <input id="email" name="email" type="email" required className="neu-input" />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink">
                Contraseña
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="neu-input"
              />
              <p className="mt-1.5 text-right text-xs">
                <Link href="/recuperar-contrasena" className="text-brand hover:underline">
                  ¿Olvidaste tu contraseña?
                </Link>
              </p>
            </div>
            <button type="submit" disabled={loading} className="neu-btn neu-btn-primary w-full">
              {loading ? "Ingresando..." : "Ingresar"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-ink-muted">
            ¿No tenés cuenta?{" "}
            <Link href="/registro" className="font-semibold text-brand hover:underline">
              Registrate
            </Link>
          </p>
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
