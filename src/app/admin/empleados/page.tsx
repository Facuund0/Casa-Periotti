import { redirect } from "next/navigation";
import { createClient } from "@/infrastructure/database/supabase-server";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { EMPLOYEE_ROLE_LABELS } from "@/modules/employees/types";
import { EmployeeForm } from "./employee-form";
import { EmployeeRowActions } from "./employee-row-actions";

export const dynamic = "force-dynamic";

export default async function AdminEmployeesPage() {
  const employee = await getCurrentEmployee();
  if (!employee || employee.role !== "super_admin") {
    redirect("/admin");
  }

  const supabase = await createClient();

  const { data: employees } = await supabase
    .from("employee_profiles")
    .select("id, full_name, role, active")
    .order("full_name");

  return (
    <div>
      <h1 className="text-lg font-bold mb-6">Empleados</h1>

      <div className="grid md:grid-cols-[1fr_320px] gap-6">
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Nombre</th>
                <th className="text-center px-4 py-3">Estado</th>
                <th className="text-right px-4 py-3">Rol / acciones</th>
              </tr>
            </thead>
            <tbody>
              {(employees ?? []).map((e) => (
                <tr key={e.id} className="border-t border-neutral-100">
                  <td className="px-4 py-3">
                    {e.full_name}
                    {e.id === employee.id && (
                      <span className="text-xs text-neutral-400"> (vos)</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        e.active ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"
                      }`}
                    >
                      {e.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <EmployeeRowActions
                      employeeId={e.id}
                      role={e.role}
                      active={e.active}
                      isSelf={e.id === employee.id}
                    />
                  </td>
                </tr>
              ))}
              {(!employees || employees.length === 0) && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-neutral-400">
                    Todavía no hay empleados cargados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <EmployeeForm />
      </div>

      <p className="text-xs text-neutral-400 mt-4">
        Roles: {Object.values(EMPLOYEE_ROLE_LABELS).join(" · ")}
      </p>
    </div>
  );
}
