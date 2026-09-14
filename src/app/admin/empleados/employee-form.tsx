"use client";

import { useState } from "react";
import { createEmployeeAction, type EmployeeActionResult } from "@/modules/employees/admin-actions";
import { EMPLOYEE_ROLES, EMPLOYEE_ROLE_LABELS } from "@/modules/employees/types";

export function EmployeeForm() {
  const [result, setResult] = useState<EmployeeActionResult | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <form
      action={async (formData) => {
        setLoading(true);
        setResult(null);
        const res = await createEmployeeAction(formData);
        setResult(res);
        setLoading(false);
        if (res.ok) {
          (document.getElementById("employee-form") as HTMLFormElement | null)?.reset();
        }
      }}
      id="employee-form"
      className="neu-card h-fit max-w-md space-y-3 p-4"
    >
      <p className="text-sm font-medium">Dar de alta empleado</p>
      <p className="text-xs text-ink-muted">
        Buscamos por email a un usuario que ya se haya registrado. No se crean cuentas nuevas
        desde acá.
      </p>

      {result?.error && <p className="text-xs text-danger">{result.error}</p>}
      {result?.ok && <p className="text-xs text-success">Empleado dado de alta correctamente.</p>}

      <div>
        <input
          name="email"
          type="email"
          placeholder="Email ya registrado"
          required
          className="neu-input"
        />
        {result?.fieldErrors?.email && (
          <p className="text-xs text-danger mt-1">{result.fieldErrors.email}</p>
        )}
      </div>

      <div>
        <input
          name="fullName"
          placeholder="Nombre y apellido"
          required
          className="neu-input"
        />
        {result?.fieldErrors?.fullName && (
          <p className="text-xs text-danger mt-1">{result.fieldErrors.fullName}</p>
        )}
      </div>

      <select
        name="role"
        defaultValue="ventas"
        className="neu-input"
      >
        {EMPLOYEE_ROLES.map((r) => (
          <option key={r} value={r}>
            {EMPLOYEE_ROLE_LABELS[r]}
          </option>
        ))}
      </select>

      <button
        type="submit"
        disabled={loading}
        className="neu-btn neu-btn-primary w-full"
      >
        {loading ? "Guardando..." : "Dar de alta"}
      </button>
    </form>
  );
}
