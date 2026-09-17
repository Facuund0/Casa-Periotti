import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // Un link de mail de Supabase Auth puede volver a la raíz del sitio (la
  // Site URL) en vez de a /auth/confirm: pasa con las plantillas de mail
  // por defecto o si la dirección de vuelta no está permitida. Sin esto
  // se abre el catálogo y el código del link se pierde.
  const { pathname, searchParams } = request.nextUrl;
  if (pathname === "/" && (searchParams.has("code") || searchParams.has("token_hash"))) {
    const confirmUrl = request.nextUrl.clone();
    confirmUrl.pathname = "/auth/confirm";
    return NextResponse.redirect(confirmUrl);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresca el token de sesión si venció (y reescribe las cookies) y
  // verifica su firma. No borrar este await: sin él la sesión puede
  // caducar de forma impredecible.
  //
  // getClaims y no getUser: el proyecto firma las sesiones con claves
  // asimétricas (ES256), así que la firma se verifica acá mismo con la
  // clave pública, sin viajar al servidor de Auth en cada pedido. El proxy
  // corre en TODOS los pedidos (incluidas las precargas de links) y desde
  // otra región que la base: ese viaje era casi la mitad del tiempo de
  // cada clic en el panel.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub ?? null;

  // /admin/* sin sesión → login. Es un chequeo optimista (la guía de
  // autenticación de Next recomienda que el proxy solo lea la sesión, sin
  // consultar la base). Que la sesión sea de un empleado ACTIVO con el rol
  // correcto lo verifica cada página del panel (getCurrentEmployee +
  // rol), cada Server Action, y la RLS de la base.
  if (request.nextUrl.pathname.startsWith("/admin") && !userId) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
