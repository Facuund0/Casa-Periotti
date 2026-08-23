import type { Metadata } from "next";
import { CartProvider } from "@/modules/cart/cart-context";
import "./globals.css";

export const metadata: Metadata = {
  title: "Casa Periotti | Sanitarios, Ferretería y Construcción en Sunchales",
  description:
    "Corralón en Sunchales, Santa Fe. Sanitarios, piscinas, electricidad, ferretería, artefactos, construcción y línea solar. Precios minoristas y mayoristas.",
  metadataBase: new URL("https://casaperiotti.com.ar"),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <CartProvider>{children}</CartProvider>
      </body>
    </html>
  );
}
