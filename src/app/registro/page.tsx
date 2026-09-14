"use client";

import { useState } from "react";
import { signUpAction, type AuthActionResult } from "@/modules/auth/actions";
import Link from "next/link";
import { Logo } from "../_components/logo";

export default function RegistroPage() {
  const [wantsWholesale, setWantsWholesale] = useState(false);
  const [result, setResult] = useState<AuthActionResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setResult(null);
    const res = await signUpAction(formData);
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
          <h1 className="text-xl font-bold text-ink">Crear cuenta</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Con tu cuenta seguís tus pedidos y, si sos mayorista, ves tus precios.
          </p>

          {result?.error && (
            <div className="mt-4 rounded-neu bg-danger-soft p-3 text-sm font-medium text-danger">
              {result.error}
            </div>
          )}

          <form action={handleSubmit} className="mt-6 space-y-4">
            <Field label="Nombre completo" name="fullName" error={result?.fieldErrors?.fullName} />
            <Field label="Email" name="email" type="email" error={result?.fieldErrors?.email} />
            <Field label="Teléfono" name="phone" error={result?.fieldErrors?.phone} />
            <Field
              label="Contraseña"
              name="password"
              type="password"
              error={result?.fieldErrors?.password}
            />

            {/* El bloque mayorista va hundido para que se lea como una
                zona aparte, sin necesidad de una línea divisoria. */}
            <div className="neu-inset p-4">
              <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink">
                <input
                  type="checkbox"
                  name="wantsWholesale"
                  checked={wantsWholesale}
                  onChange={(e) => setWantsWholesale(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[var(--brand)]"
                />
                <span>
                  Quiero precios mayoristas
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    Queda pendiente de aprobación por Casa Periotti.
                  </span>
                </span>
              </label>

              {wantsWholesale && (
                <div className="mt-3">
                  <Field label="CUIT" name="cuit" error={result?.fieldErrors?.cuit} />
                </div>
              )}
            </div>

            <button type="submit" disabled={loading} className="neu-btn neu-btn-primary w-full">
              {loading ? "Creando cuenta..." : "Crear cuenta"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-ink-muted">
            ¿Ya tenés cuenta?{" "}
            <Link href="/login" className="font-semibold text-brand hover:underline">
              Ingresá
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

function Field({
  label,
  name,
  type = "text",
  error,
}: {
  label: string;
  name: string;
  type?: string;
  error?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <input id={name} name={name} type={type} required className="neu-input" />
      {error && <p className="mt-1 text-xs font-medium text-danger">{error}</p>}
    </div>
  );
}
