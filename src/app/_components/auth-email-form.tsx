"use client";

import { useState } from "react";
import type { AuthActionResult } from "@/modules/auth/actions";

/**
 * Formulario de un solo campo (email) para las acciones de cuenta que
 * mandan un correo: pedir el link de recuperación y reenviar la
 * confirmación. Muestra el mensaje genérico que devuelve la acción.
 */
export function AuthEmailForm({
  action,
  submitLabel,
  pendingLabel,
  defaultEmail,
  id,
}: {
  action: (formData: FormData) => Promise<AuthActionResult>;
  submitLabel: string;
  pendingLabel: string;
  defaultEmail?: string;
  id: string;
}) {
  const [result, setResult] = useState<AuthActionResult | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    setResult(null);
    setResult(await action(formData));
    setLoading(false);
  }

  return (
    <form action={handleSubmit} className="space-y-3">
      {result?.notice && (
        <div className="rounded-neu bg-success-soft p-3 text-sm font-medium text-success" role="status">
          {result.notice}
        </div>
      )}
      {result?.error && (
        <div className="rounded-neu bg-danger-soft p-3 text-sm font-medium text-danger" role="alert">
          {result.error}
        </div>
      )}
      <div>
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
          Email
        </label>
        <input id={id} name="email" type="email" required defaultValue={defaultEmail} className="neu-input" />
        {result?.fieldErrors?.email && (
          <p className="mt-1 text-xs font-medium text-danger">{result.fieldErrors.email}</p>
        )}
      </div>
      <button type="submit" disabled={loading} className="neu-btn neu-btn-primary w-full">
        {loading ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
