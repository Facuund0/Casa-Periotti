"use server";

import { createClient } from "@/infrastructure/database/supabase-server";
import { loginSchema, signUpSchema } from "./schemas";
import { redirect } from "next/navigation";

export interface AuthActionResult {
  error?: string;
  fieldErrors?: Record<string, string>;
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
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] = issue.message;
    }
    return { fieldErrors };
  }

  const { fullName, email, password, phone, wantsWholesale, cuit } = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
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

  redirect("/registro/confirmar");
}

export async function loginAction(formData: FormData): Promise<AuthActionResult> {
  const parsed = loginSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[String(issue.path[0])] = issue.message;
    }
    return { fieldErrors };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    return { error: "Email o contraseña incorrectos." };
  }

  redirect("/mi-cuenta");
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
