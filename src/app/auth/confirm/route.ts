import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/infrastructure/database/supabase-server";
import { safeNextPath } from "@/modules/auth/site-url";

/**
 * Destino de los links que manda Supabase Auth por mail: confirmación de
 * registro y recuperación de contraseña. Abre la sesión y redirige.
 *
 * Acepta los dos formatos de link:
 *  - ?token_hash=...&type=... (plantillas de mail recomendadas): se
 *    verifica acá con verifyOtp. Funciona aunque el mail se abra en otro
 *    dispositivo.
 *  - ?code=... (plantillas por defecto de Supabase, flujo PKCE): se
 *    canjea con exchangeCodeForSession. Solo funciona en el mismo
 *    navegador donde se pidió; en otro, el canje falla.
 *
 * Los links son de un solo uso y vencen según "Email OTP Expiration" en
 * Supabase (Authentication → Providers → Email).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  const isRecovery = type === "recovery" || next === "/restablecer-contrasena";
  const supabase = await createClient();

  let ok = false;
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    ok = !error;
    if (error) console.warn("[auth/confirm] verifyOtp:", error.message);
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
    if (error) console.warn("[auth/confirm] exchangeCodeForSession:", error.message);
  }

  if (!ok) {
    return NextResponse.redirect(
      new URL(`/auth/link-invalido?tipo=${isRecovery ? "recuperacion" : "registro"}`, origin)
    );
  }

  const destination = isRecovery
    ? "/restablecer-contrasena"
    : safeNextPath(next, "/mi-cuenta");
  return NextResponse.redirect(new URL(destination, origin));
}
