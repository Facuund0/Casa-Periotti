import type { MetadataRoute } from "next";

/**
 * Manifest de la PWA. Hace falta para que el panel se pueda agregar a la
 * pantalla de inicio, que es el único modo en que iOS entrega
 * notificaciones push.
 *
 * Los iconos son provisorios, generados por código (src/app/icon.tsx y
 * src/app/apple-icon.tsx). Para reemplazarlos por el logo real, ver
 * docs/iconos-y-notificaciones.md.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Casa Periotti",
    short_name: "Casa Periotti",
    description:
      "Corralón en Sunchales: sanitarios, ferretería, construcción y línea solar. Catálogo y panel interno.",
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#e8ecf1",
    theme_color: "#2c4a9e",
    lang: "es-AR",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
