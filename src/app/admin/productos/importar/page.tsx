import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/modules/auth/current-user";
import { ImportForm } from "./import-form";

export const dynamic = "force-dynamic";

/** Carga masiva de productos desde una planilla. Mismo permiso que editar productos. */
export default async function ImportarProductosPage() {
  const employee = await getCurrentEmployee();
  if (!employee || !["admin", "super_admin", "stock"].includes(employee.role)) {
    redirect("/admin");
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-ink">Importar productos</h1>
        <Link href="/admin/productos" className="neu-chip">
          Volver a Productos
        </Link>
      </div>

      <div className="neu-card mb-4 p-4 text-sm text-ink-muted">
        <p className="font-medium text-ink">Cómo funciona</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            Descargá la plantilla, completala en Excel y guardala como{" "}
            <strong>CSV (delimitado por punto y coma)</strong>.
          </li>
          <li>
            Elegí el archivo y tocá <strong>Simular</strong>: se valida todo y se muestra qué haría,{" "}
            <strong>sin guardar nada</strong>.
          </li>
          <li>
            Si el resultado está bien, aparece el botón <strong>Aplicar de verdad</strong> abajo del
            resumen. Ahí sí se guarda.
          </li>
        </ol>
        <ul className="mt-3 space-y-1">
          <li>
            · Se identifica cada producto por <strong>SKU</strong>: si ya existe se actualiza, si no
            se crea.
          </li>
          <li>
            · <strong>Las celdas vacías no borran nada:</strong> en un producto que ya existe, lo que
            dejes en blanco queda como está. Sirve para cargar de a una sola cosa — por ejemplo una
            planilla con nada más que las columnas <strong>SKU</strong> y{" "}
            <strong>Codigo de barras</strong> carga los códigos sin tocar ningún precio.
          </li>
          <li>
            · Para un producto <strong>nuevo</strong> sí hacen falta nombre, categoría y precio
            minorista: si falta alguno, esa fila se informa y las demás siguen.
          </li>
          <li>
            · Los precios se cargan <strong>sin IVA</strong>, igual que en el formulario; el precio
            con IVA lo calcula el sistema.
          </li>
          <li>
            · La categoría se escribe con su nombre y tiene que existir. Si falta, creala primero en
            Categorías.
          </li>
          <li>
            · <strong>No toca el stock:</strong> se sigue moviendo con ajustes y entradas, para no
            perder la trazabilidad.
          </li>
          <li>
            · En <strong>Decimales</strong> poné &quot;si&quot; para lo que se vende medido (m³, kg,
            metros) y se pueda vender 2,5. Vacío o &quot;no&quot;: solo cantidades enteras.
          </li>
          <li>· Si una fila tiene un error, se informa y las demás siguen.</li>
        </ul>
        {/* <a> y no <Link>: del otro lado no hay una página sino un route
            handler que devuelve el archivo, y tiene que bajarlo el navegador. */}
        <a
          href="/admin/productos/importar/plantilla"
          download
          className="neu-btn mt-4 !px-3 !py-2 !text-xs"
        >
          Descargar plantilla
        </a>
      </div>

      <ImportForm />
    </div>
  );
}
