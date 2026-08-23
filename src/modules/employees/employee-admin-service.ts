import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateEmployeeInput } from "./schemas";
import type { EmployeeRole } from "./types";

export class UnauthorizedError extends Error {
  constructor(message = "No tenés permiso para realizar esta acción") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

/**
 * Todas las escrituras sobre empleados pasan por acá. Aunque la base de
 * datos también tiene RLS que bloquea esto (defensa en profundidad), este
 * service es el que da el mensaje de error claro y registra auditoría —
 * nunca hay que confiar en que "ya está protegido por RLS" como única
 * barrera.
 */
export class EmployeeAdminService {
  constructor(
    private readonly adminDb: SupabaseClient,
    private readonly currentEmployee: { id: string; role: string }
  ) {}

  private assertIsSuperAdmin() {
    if (this.currentEmployee.role !== "super_admin") {
      throw new UnauthorizedError("Solo un super_admin puede administrar empleados");
    }
  }

  /**
   * Busca un usuario ya registrado en Supabase Auth por email. Nunca crea
   * cuentas nuevas: el alta de empleado solo puede apuntar a alguien que ya
   * se registró (como cliente o mediante otro flujo).
   */
  private async findAuthUserByEmail(email: string) {
    const normalized = email.trim().toLowerCase();
    let page = 1;

    // Tope de páginas como salvaguarda; con perPage=200 cubre 10.000 usuarios.
    for (let i = 0; i < 50; i++) {
      const { data, error } = await this.adminDb.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(`No se pudo buscar el usuario: ${error.message}`);

      const match = data.users.find((u) => u.email?.toLowerCase() === normalized);
      if (match) return match;

      if (!data.nextPage) break;
      page = data.nextPage;
    }

    return null;
  }

  async create(input: CreateEmployeeInput) {
    this.assertIsSuperAdmin();

    const authUser = await this.findAuthUserByEmail(input.email);
    if (!authUser) {
      throw new Error(
        "No encontramos ningún usuario registrado con ese email. Tiene que crearse una cuenta antes de poder darlo de alta como empleado."
      );
    }

    const { data: existing } = await this.adminDb
      .from("employee_profiles")
      .select("id")
      .eq("id", authUser.id)
      .maybeSingle();

    if (existing) {
      throw new Error("Ese usuario ya es un empleado.");
    }

    const { error } = await this.adminDb.from("employee_profiles").insert({
      id: authUser.id,
      full_name: input.fullName,
      role: input.role,
      active: true,
    });

    if (error) throw new Error(`No se pudo dar de alta al empleado: ${error.message}`);

    await this.audit("create", authUser.id, null, { fullName: input.fullName, role: input.role });
  }

  async updateRole(employeeId: string, role: EmployeeRole) {
    this.assertIsSuperAdmin();

    if (employeeId === this.currentEmployee.id && role !== "super_admin") {
      throw new Error(
        "No podés quitarte tu propio rol de super_admin — el sistema se quedaría sin nadie que pueda administrar empleados."
      );
    }

    const { data: before } = await this.adminDb
      .from("employee_profiles")
      .select("role")
      .eq("id", employeeId)
      .maybeSingle();

    const { error } = await this.adminDb
      .from("employee_profiles")
      .update({ role })
      .eq("id", employeeId);

    if (error) throw new Error(`No se pudo cambiar el rol: ${error.message}`);

    await this.audit("update_role", employeeId, before, { role });
  }

  /** Nunca se borra un empleado físicamente. Se desactiva. */
  async deactivate(employeeId: string) {
    this.assertIsSuperAdmin();

    if (employeeId === this.currentEmployee.id) {
      throw new Error(
        "No podés desactivar tu propia cuenta — el sistema se quedaría sin nadie que pueda administrar empleados."
      );
    }

    const { error } = await this.adminDb
      .from("employee_profiles")
      .update({ active: false })
      .eq("id", employeeId);

    if (error) throw new Error(`No se pudo desactivar al empleado: ${error.message}`);

    await this.audit("deactivate", employeeId, null, null);
  }

  private async audit(action: string, entityId: string, before: unknown, after: unknown) {
    await this.adminDb.from("audit_logs").insert({
      user_id: this.currentEmployee.id,
      action,
      entity_type: "employee",
      entity_id: entityId,
      data_before: before,
      data_after: after,
    });
  }
}
