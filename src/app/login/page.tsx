"use client";

import { useState } from "react";
import { loginAction, type AuthActionResult } from "@/modules/auth/actions";
import Link from "next/link";

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
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="w-full max-w-md bg-white rounded-xl border border-neutral-200 p-8">
        <h1 className="text-xl font-bold mb-1">Ingresar</h1>
        <p className="text-sm text-neutral-500 mb-6">Casa Periotti</p>

        {result?.error && (
          <div className="mb-4 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm p-3">
            {result.error}
          </div>
        )}

        <form action={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Email</label>
            <input
              name="email"
              type="email"
              required
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Contraseña</label>
            <input
              name="password"
              type="password"
              required
              className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-neutral-900 text-white rounded-md py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
          >
            {loading ? "Ingresando..." : "Ingresar"}
          </button>
        </form>

        <p className="text-sm text-neutral-500 mt-6 text-center">
          ¿No tenés cuenta?{" "}
          <Link href="/registro" className="text-neutral-900 font-medium hover:underline">
            Registrate
          </Link>
        </p>
      </div>
    </main>
  );
}
