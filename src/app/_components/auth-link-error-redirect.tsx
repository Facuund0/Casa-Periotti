"use client";

import { useEffect } from "react";

/**
 * Cuando un link de mail de Supabase Auth falla (vencido, ya usado, o
 * consumido por un rastreador de clics o el antivirus del correo),
 * Supabase redirige con el error en el fragmento de la URL
 * (#error=access_denied&error_code=otp_expired&...). El fragmento no
 * llega al servidor, así que sin esto la persona ve el catálogo sin
 * ninguna explicación. Se lo manda a la página que explica qué pasó.
 */
export function AuthLinkErrorRedirect() {
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash.includes("error_code=") && !hash.includes("error=access_denied")) return;
    window.location.replace("/auth/link-invalido");
  }, []);
  return null;
}
