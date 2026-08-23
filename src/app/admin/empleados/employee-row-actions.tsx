"use client";

import { useState, useTransition } from "react";
import { updateEmployeeRoleAction, deactivateEmployeeAction } from "@/modules/employees/admin-actions";
import { EMPLOYEE_ROLES, EMPLOYEE_ROLE_LABELS, type EmployeeRole } from "@/modules/employees/types";

export function EmployeeRowActions({
  employeeId,
  role,
  active,
  isSelf,
}: {
  employeeId: string;
  role: EmployeeRole;
  active: boolean;
  isSelf: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleRoleChange(newRole: string) {
    setError(null);
    const formData = new FormData();
    formData.set("employeeId", employeeId);
    formData.set("role", newRole);
    startTransition(async () => {
      const result = await updateEmployeeRoleAction(formData);
      if (result.error) setError(result.error);
    });
  }

  function handleDeactivate() {
    setError(null);
    startTransition(async () => {
      const result = await deactivateEmployeeAction(employeeId);
      if (result.error) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-1 items-end">
      <div className="flex items-center gap-2">
        <select
          value={role}
          disabled={pending || isSelf}
          onChange={(e) => handleRoleChange(e.target.value)}
          className="text-xs border border-neutral-300 rounded px-1.5 py-1 disabled:opacity-50"
        >
          {EMPLOYEE_ROLES.map((r) => (
            <option key={r} value={r}>
              {EMPLOYEE_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        {active && (
          <button
            type="button"
            onClick={handleDeactivate}
            disabled={pending || isSelf}
            className="text-xs text-red-600 hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
          >
            Desactivar
          </button>
        )}
      </div>
      {isSelf && (
        <p className="text-[10px] text-neutral-400">No podés modificar tu propia cuenta</p>
      )}
      {error && <p className="text-[10px] text-red-600 max-w-[220px] text-right">{error}</p>}
    </div>
  );
}
