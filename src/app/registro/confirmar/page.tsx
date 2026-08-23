import Link from "next/link";

export default function ConfirmarRegistroPage() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-bold mb-2">¡Ya casi!</h1>
        <p className="text-sm text-neutral-600">
          Te enviamos un email para confirmar tu cuenta. Una vez confirmada, ya podés iniciar
          sesión. Si pediste precio mayorista, un empleado de Casa Periotti va a revisar tu
          solicitud antes de habilitarte esos precios.
        </p>
        <Link href="/login" className="inline-block mt-6 text-sm font-medium underline">
          Ir a iniciar sesión
        </Link>
      </div>
    </main>
  );
}
