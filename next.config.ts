import type { NextConfig } from "next";

/**
 * Las imágenes del catálogo se sirven desde el bucket público
 * 'productos' de Supabase, así que hay que habilitar ese host para
 * next/image. El hostname se deriva de NEXT_PUBLIC_SUPABASE_URL en vez
 * de estar escrito a mano, para que no haya que tocar este archivo si
 * se cambia de proyecto de Supabase.
 */
const supabaseHostname = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    console.warn(`[next.config] NEXT_PUBLIC_SUPABASE_URL="${url}" no es una URL válida.`);
    return null;
  }
})();

const nextConfig: NextConfig = {
  experimental: {
    // Volver a una página abierta hace menos de 30 segundos la muestra al
    // instante desde la memoria del navegador. Las acciones que cambian
    // datos llaman a revalidatePath, que invalida esa memoria.
    staleTimes: {
      dynamic: 30,
    },
  },
  images: {
    remotePatterns: supabaseHostname
      ? [
          {
            protocol: "https",
            hostname: supabaseHostname,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : [],
  },
};

export default nextConfig;
