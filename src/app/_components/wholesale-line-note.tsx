import type { CustomerType } from "@/modules/products/types";

/**
 * Qué precio se aplica a un renglón y, si no llega al mínimo mayorista,
 * cuánto falta. Mismo texto en el carrito y en el mostrador. Solo tiene
 * sentido para mayoristas aprobados: a los demás no se les muestra nada.
 */
export function WholesaleLineNote({
  customerType,
  priceType,
  missingForWholesale,
  minimum,
}: {
  customerType: CustomerType;
  priceType: "wholesale" | "retail";
  missingForWholesale: number | null;
  minimum: number;
}) {
  if (customerType !== "mayorista") return null;

  if (priceType === "wholesale") {
    return (
      <span className="neu-badge mt-1 bg-success-soft text-success">
        Precio mayorista{minimum > 1 ? ` (desde ${minimum} u.)` : ""}
      </span>
    );
  }

  return (
    <span className="mt-1 flex flex-wrap items-center gap-1.5">
      <span className="neu-badge bg-secondary-soft text-ink-muted">Precio minorista</span>
      {missingForWholesale != null && missingForWholesale > 0 && (
        <span className="text-xs font-medium text-warning">
          {missingForWholesale === 1
            ? "Falta 1 unidad"
            : `Faltan ${missingForWholesale} unidades`}{" "}
          para precio mayorista (mínimo {minimum})
        </span>
      )}
    </span>
  );
}
