"use client";

import { useState } from "react";
import { signUpAction, type AuthActionResult } from "@/modules/auth/actions";
import Link from "next/link";

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
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4 py-12">
      <div className="w-full max-w-md bg-white rounded-xl border border-neutral-200 p-8">
        <h1 className="text-xl font-bold mb-1">Crear cuenta</h1>
        <p className="text-sm text-neutral-500 mb-6">Casa Periotti — Sunchales, Santa Fe</p>

        {result?.error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm p-3">
            {result.error}
          </div>
        )}

        <form action={handleSubmit} className="space-y-4">
          <Field label="Nombre completo" name="fullName" error={result?.fieldErrors?.fullName} />
          <Field label="Email" name="email" type="email" error={result?.fieldErrors?.email} />
          <Field label="Teléfono" name="phone" error={result?.fieldErrors?.phone} />
          <Field
            label="Contraseña"
            name="password"
            type="password"
            error={result?.fieldErrors?.password}
          />

          <div className="border-t border-neutral-100 pt-4">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="wantsWholesale"
                checked={wantsWholesale}
                onChange={(e) => setWantsWholesale(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Quiero precios mayoristas (queda pendiente de aprobación por Casa Periotti)
              </span>
            </label>

            {wantsWholesale && (
              <div className="mt-3">
                <Field label="CUIT" name="cuit" error={result?.fieldErrors?.cuit} />
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-neutral-900 text-white rounded-md py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
          >
            {loading ? "Creando cuenta..." : "Crear cuenta"}
          </button>
        </form>

        <p className="text-sm text-neutral-500 mt-6 text-center">
          ¿Ya tenés cuenta?{" "}
          <Link href="/login" className="text-neutral-900 font-medium hover:underline">
            Ingresá
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
      <label className="block text-sm font-medium text-neutral-700 mb-1">{label}</label>
      <input
        name={name}
        type={type}
        required
        className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
      />
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
