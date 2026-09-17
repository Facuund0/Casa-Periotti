"use server";

import { createClient } from "@/infrastructure/database/supabase-server";
import { emailOnlySchema, loginSchema, newPasswordSchema, signUpSchema } from "./schemas";
import { redirect } from "next/navigation";
import { getRequestOrigin } from "./site-url";
import { hasRecentEmailLinkSession } from "./recovery-session";

export interface AuthActionResult {
  error?: string;
  fieldErrors?: Record<string, string>;
  /** Mensaje de éxito para mostrar en el formulario. */
  notice?: string;
  /** El login falló porque el email no está confirmado: se ofrece reenviar. */
  unconfirmedEmail?: string;
}

function fieldErrorsOf(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) fieldErrors[String(issue.path[0])] = issue.message;
  return fieldErrors;
}

export async function signUpAction(formData: FormData): Promise<AuthActionResult> {
  const raw = {
    fullName: String(formData.get("fullName") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    wantsWholesale: formData.get("wantsWholesale") === "on",
    cuit: String(formData.get("cuit") ?? ""),
  };

  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error.issues) };
  }

  const { fullName, email, password, phone, wantsWholesale, cuit } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // El link del mail de confirmación vuelve a /auth/confirm, que abre
      // la sesión y manda a Mi cuenta.
      emailRedirectTo: `${await getRequestOrigin()}/auth/confirm?next=/mi-cuenta`,
      data: {
        full_name: fullName,
        phone,
        wants_wholesale: wantsWholesale ? "true" : "false",
        cuit_dni: cuit ?? null,
      },
    },
  });

  if (error) {
    console.error("[signUpAction] Error de Supabase:", error.message, error);
    // Mensajes de Supabase Auth traducidos a algo entendible, sin
    // exponer detalles técnicos internos.
    if (error.message.includes("already registered")) {
      return { error: "Ese email ya está registrado. Probá iniciar sesión." };
    }
    return { error: "No pudimos crear tu cuenta. Intentá de nuevo en un momento." };
  }

  // Con "Confirm email" desactivado en Supabase, la cuenta queda con la
  // sesión abierta y no hay mail que esperar.
  if (data.session) redirect("/mi-cuenta");

  redirect("/registro/confirmar");
}

export async function loginAction(formData: FormData): Promise<AuthActionResult> {
  const parsed = loginSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    return { fieldErrors: fieldErrorsOf(parsed.error.issues) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Supabase solo devuelve este código si la contraseña es correcta, así
    // que avisarlo no le revela nada a quien no conoce la contraseña.
    if (error.code === "email_not_confirmed") {
      return {
        error: "Todavía no confirmaste tu email. Abrí el link que te mandamos al registrarte.",
        unconfirmedEmail: parsed.data.email,
      };
    }
    return { error: "Email o contraseña incorrectos." };
  }

  redirect("/mi-cuenta");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

/**
 * Reenvía el mail de confirmación de registro. El mensaje es el mismo
 * exista o no la cuenta, y esté o no confirmada.
 */
export async function resendConfirmationAction(formData: FormData): Promise<AuthActionResult> {
  const parsed = emailOnlySchema.safeParse({ email: String(formData.get("email") ?? "") });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues) };

  const supabase = await createClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email: parsed.data.email,
    options: { emailRedirectTo: `${await getRequestOrigin()}/auth/confirm?next=/mi-cuenta` },
  });

  if (error?.status === 429) {
    return { error: "Pediste varios correos seguidos. Esperá unos minutos y probá de nuevo." };
  }
  if (error) console.warn("[resendConfirmationAction]", error.message);

  return {
    notice:
      "Si hay una cuenta sin confirmar con ese email, te reenviamos el correo. Revisá también la carpeta de spam.",
  };
}

/**
 * Pide el link de recuperación. El mensaje es el mismo exista o no la
 * cuenta, para no revelar qué emails están registrados.
 */
export async function requestPasswordResetAction(formData: FormData): Promise<AuthActionResult> {
  const parsed = emailOnlySchema.safeParse({ email: String(formData.get("email") ?? "") });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues) };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await getRequestOrigin()}/auth/confirm?next=/restablecer-contrasena`,
  });

  // El límite de envíos aplica igual exista o no la cuenta: avisarlo no
  // revela nada.
  if (error?.status === 429) {
    return { error: "Pediste varios correos seguidos. Esperá unos minutos y probá de nuevo." };
  }
  if (error) console.warn("[requestPasswordResetAction]", error.message);

  return {
    notice:
      "Si hay una cuenta con ese email, te mandamos un link para crear una contraseña nueva. El link vence en una hora y sirve una sola vez. Revisá también la carpeta de spam.",
  };
}

export async function updatePasswordAction(formData: FormData): Promise<AuthActionResult> {
  const parsed = newPasswordSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsOf(parsed.error.issues) };

  if (!(await hasRecentEmailLinkSession())) {
    return {
      error: "El link de recuperación venció. Pedí uno nuevo para crear tu contraseña.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    console.warn("[updatePasswordAction]", error.message);
    if (error.code === "same_password") {
      return { error: "La contraseña nueva tiene que ser distinta de la anterior." };
    }
    return { error: "No pudimos guardar la contraseña nueva. Pedí un link nuevo e intentá otra vez." };
  }

  // Cierra las demás sesiones abiertas de la cuenta: si alguien más tenía
  // acceso, lo pierde con el cambio de contraseña.
  await supabase.auth.signOut({ scope: "others" });

  return { notice: "Listo, tu contraseña quedó actualizada." };
}
