import Link from "next/link";
import { Logo } from "./logo";

/** Marco de las pantallas de cuenta (login, registro, recuperación). */
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" className="inline-block rounded-neu-sm">
            <Logo size="lg" showTagline />
          </Link>
        </div>
        <div className="neu-card p-6 sm:p-8">{children}</div>
        <p className="mt-5 text-center">
          <Link href="/" className="neu-chip">
            Volver al catálogo
          </Link>
        </p>
      </div>
    </main>
  );
}
