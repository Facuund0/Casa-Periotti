"use client";

import { useState } from "react";
import Link from "next/link";
import { updatePasswordAction, type AuthActionResult } from "@/modules/auth/actions";

export function NewPasswordForm() {
  const [result, setResult] = useState<AuthActionResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setResult(null);
    setResult(await updatePasswordAction(formData));
    setLoading(false);
  }

  if (result?.notice) {
    return (
      <div className="space-y-4">
        <div className="rounded-neu bg-success-soft p-3 text-sm font-medium text-success" role="status">
          {result.notice}
        </div>
        <Link href="/mi-cuenta" className="neu-btn neu-btn-primary w-full">
          Ir a Mi cuenta
        </Link>
      </div>
    );
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      {result?.error && (
        <div className="rounded-neu bg-danger-soft p-3 text-sm font-medium text-danger" role="alert">
          {result.error}{" "}
          {result.error.includes("venció") && (
            <Link href="/recuperar-contrasena" className="underline">
              Pedir un link nuevo
            </Link>
          )}
        </div>
      )}
      <div>
        <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-ink">
          Contraseña nueva
        </label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" className="neu-input" />
        {result?.fieldErrors?.password && (
          <p className="mt-1 text-xs font-medium text-danger">{result.fieldErrors.password}</p>
        )}
      </div>
      <div>
        <label htmlFor="confirmPassword" className="mb-1.5 block text-sm font-medium text-ink">
          Repetí la contraseña
        </label>
        <input id="confirmPassword" name="confirmPassword" type="password" required autoComplete="new-password" className="neu-input" />
        {result?.fieldErrors?.confirmPassword && (
          <p className="mt-1 text-xs font-medium text-danger">{result.fieldErrors.confirmPassword}</p>
        )}
      </div>
      <button type="submit" disabled={loading} className="neu-btn neu-btn-primary w-full">
        {loading ? "Guardando..." : "Guardar contraseña"}
      </button>
    </form>
  );
}
