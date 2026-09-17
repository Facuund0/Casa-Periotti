import type {
  OrderAdminDetail,
  OrderPriceSummary,
} from "@/modules/orders/order-admin-detail-service";

/**
 * Piezas del detalle de un pedido en el panel. La fila muestra lo
 * esencial (OrderSummaryChips) y el detalle completo va en un desplegable
 * (OrderDetailBody), así un listado largo se recorre rápido. Lo usan
 * Pedidos y Comprobantes, para que se vean igual.
 */

const PRICE_SUMMARY: Record<OrderPriceSummary, { label: string; className: string }> = {
  minorista: {
    label: "Precio minorista",
    className: "bg-secondary-soft text-ink-muted",
  },
  mayorista: {
    label: "Precio mayorista",
    className: "bg-success-soft text-success",
  },
  mixto: {
    label: "Mayorista y minorista",
    className: "bg-warning-soft text-warning",
  },
};

function money(n: number): string {
  return `$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function OrderSummaryChips({ detail }: { detail: OrderAdminDetail }) {
  const price = PRICE_SUMMARY[detail.priceSummary];
  const products = detail.lines.length;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span
        className={`neu-badge ${detail.fulfillmentMethod === "delivery" ? "bg-info-soft text-info" : "bg-surface-sunken text-ink-muted"}`}
      >
        {detail.fulfillmentMethod === "delivery" ? "Envío a domicilio" : "Retiro en local"}
      </span>
      <span className={`neu-badge ${price.className}`}>{price.label}</span>
      <span className="text-xs text-ink-muted tabular-nums">
        {products} {products === 1 ? "producto" : "productos"} · {detail.totalUnits}{" "}
        {detail.totalUnits === 1 ? "unidad" : "unidades"}
      </span>
    </div>
  );
}

export function OrderDetailBody({ detail }: { detail: OrderAdminDetail }) {
  return (
    <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_260px]">
      <div className="min-w-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-xs">
            <thead className="text-ink-subtle">
              <tr className="border-b border-[color:var(--hairline)]">
                <th className="py-1.5 pr-2 text-left font-medium">Producto</th>
                <th className="px-2 py-1.5 text-right font-medium">Cant.</th>
                <th className="px-2 py-1.5 text-right font-medium">Precio unit.</th>
                <th className="px-2 py-1.5 text-right font-medium">Subtotal</th>
                <th className="py-1.5 pl-2 text-left font-medium">Precio</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((line, i) => (
                <tr key={i} className="border-b border-[color:var(--hairline)] last:border-0">
                  <td className="py-1.5 pr-2 text-ink">{line.productName}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-ink">
                    {line.quantity}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(line.unitPrice)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{money(line.lineTotal)}</td>
                  <td className="py-1.5 pl-2">
                    <span
                      className={`neu-badge ${
                        line.priceType === "wholesale"
                          ? "bg-success-soft text-success"
                          : "bg-secondary-soft text-ink-muted"
                      }`}
                    >
                      {line.priceType === "wholesale" ? "Mayorista" : "Minorista"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-ink-subtle">Precios con IVA incluido.</p>
        {detail.notes && (
          <p className="mt-2 text-xs text-ink-muted">
            <span className="font-medium text-ink">Nota del cliente:</span> {detail.notes}
          </p>
        )}
      </div>

      <div className="space-y-3 text-xs">
        <dl className="neu-inset grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 p-3 tabular-nums">
          <dt className="text-ink-muted">Subtotal (sin IVA)</dt>
          <dd className="text-right">{money(detail.subtotal)}</dd>
          <dt className="text-ink-muted">IVA</dt>
          <dd className="text-right">{money(detail.vatAmount)}</dd>
          <dt className="border-t border-[color:var(--hairline)] pt-1 font-semibold text-ink">
            Total
          </dt>
          <dd className="border-t border-[color:var(--hairline)] pt-1 text-right font-semibold text-ink">
            {money(detail.total)}
          </dd>
        </dl>

        <div className="space-y-1">
          <p className="font-medium text-ink">Contacto</p>
          <p className="text-ink">{detail.customerName ?? "Cliente sin perfil"}</p>
          {detail.customerPhone ? (
            <p>
              <a href={`tel:${detail.customerPhone}`} className="text-brand hover:underline">
                {detail.customerPhone}
              </a>
            </p>
          ) : (
            <p className="text-ink-subtle">Sin teléfono cargado</p>
          )}
          {detail.customerEmail ? (
            <p className="break-all">
              <a href={`mailto:${detail.customerEmail}`} className="text-brand hover:underline">
                {detail.customerEmail}
              </a>
            </p>
          ) : (
            <p className="text-ink-subtle">Sin email</p>
          )}
        </div>

        {detail.fulfillmentMethod === "delivery" && (
          <div className="space-y-1">
            <p className="font-medium text-ink">Dirección de entrega</p>
            {detail.shippingStreet || detail.shippingCity ? (
              <p className="text-ink">
                {[detail.shippingStreet, detail.shippingCity].filter(Boolean).join(", ")}
              </p>
            ) : (
              <p className="text-warning">
                El cliente no cargó dirección: coordinala por teléfono.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
