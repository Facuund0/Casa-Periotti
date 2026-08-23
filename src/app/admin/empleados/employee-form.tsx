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
      className="bg-white rounded-lg border border-neutral-200 p-4 space-y-3 max-w-md h-fit"
    >
      <p className="text-sm font-medium">Dar de alta empleado</p>
      <p className="text-xs text-neutral-500">
        Buscamos por email a un usuario que ya se haya registrado. No se crean cuentas nuevas
        desde acá.
      </p>

      {result?.error && <p className="text-xs text-red-600">{result.error}</p>}
      {result?.ok && <p className="text-xs text-green-700">Empleado dado de alta correctamente.</p>}

      <div>
        <input
          name="email"
          type="email"
          placeholder="Email ya registrado"
          required
          className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
        />
        {result?.fieldErrors?.email && (
          <p className="text-xs text-red-600 mt-1">{result.fieldErrors.email}</p>
        )}
      </div>

      <div>
        <input
          name="fullName"
          placeholder="Nombre y apellido"
          required
          className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
        />
        {result?.fieldErrors?.fullName && (
          <p className="text-xs text-red-600 mt-1">{result.fieldErrors.fullName}</p>
        )}
      </div>

      <select
        name="role"
        defaultValue="ventas"
        className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
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
        className="w-full bg-neutral-900 text-white rounded-md py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
      >
        {loading ? "Guardando..." : "Dar de alta"}
      </button>
    </form>
  );
}
