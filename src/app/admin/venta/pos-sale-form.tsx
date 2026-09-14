"use client";

import { useMemo, useState, useTransition } from "react";
import {
  searchProductsAction,
  searchCustomersAction,
  createPosSaleAction,
  type ProductSearchResult,
  type CustomerSearchResult,
  type PosSaleActionResult,
} from "@/modules/pos/actions";
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  IVA_CONDITIONS,
  IVA_CONDITION_LABELS,
  type PosPaymentMethod,
  type PosIvaCondition,
} from "@/modules/pos/schemas";
import { getPriceForCustomerType } from "@/modules/products/types";
import type { CustomerType } from "@/modules/products/types";

interface CartItem extends ProductSearchResult {
  quantity: number;
}

interface LooseBuyer {
  buyerName: string;
  buyerCuitDni: string;
  buyerIvaCondition: PosIvaCondition;
  buyerEmail: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatMoney(n: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PosSaleForm() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<CustomerSearchResult | null>(null);
  const [looseBuyer, setLooseBuyer] = useState<LooseBuyer | null>(null);
  const [showLooseBuyerForm, setShowLooseBuyerForm] = useState(false);
  const [looseBuyerName, setLooseBuyerName] = useState("");
  const [looseBuyerDoc, setLooseBuyerDoc] = useState("");
  const [looseBuyerIva, setLooseBuyerIva] = useState<PosIvaCondition>("consumidor_final");
  const [looseBuyerEmail, setLooseBuyerEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>("efectivo");

  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<ProductSearchResult[]>([]);
  const [searchingProducts, startProductSearch] = useTransition();

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerSearchResult[]>([]);
  const [searchingCustomers, startCustomerSearch] = useTransition();

  const [result, setResult] = useState<PosSaleActionResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // A quién se le mandó la factura de la última venta. Se captura antes
  // de limpiar el formulario, porque después el cliente elegido ya no
  // está en el estado. null = no había ninguna dirección.
  const [lastInvoiceEmail, setLastInvoiceEmail] = useState<string | null>(null);

  const customerType: CustomerType = customer?.customerType ?? "minorista";

  // Solo para mostrarle el desglose al empleado en vivo — el cálculo
  // que realmente vale (precio, redondeo, stock) es el que hace
  // create_order() en el servidor cuando se confirma la venta.
  const lines = useMemo(
    () =>
      cart.map((item) => {
        const unitPrice = getPriceForCustomerType(item, customerType);
        const lineGross = round2(unitPrice * item.quantity);
        const lineNet = round2(lineGross / (1 + item.vatRate / 100));
        const lineVat = round2(lineGross - lineNet);
        return { ...item, unitPrice, lineGross, lineNet, lineVat };
      }),
    [cart, customerType]
  );

  const totals = useMemo(
    () => ({
      subtotal: round2(lines.reduce((s, l) => s + l.lineNet, 0)),
      vatAmount: round2(lines.reduce((s, l) => s + l.lineVat, 0)),
      total: round2(lines.reduce((s, l) => s + l.lineGross, 0)),
    }),
    [lines]
  );

  function handleProductSearch(e: React.FormEvent) {
    e.preventDefault();
    startProductSearch(async () => {
      setProductResults(await searchProductsAction(productQuery));
    });
  }

  function handleCustomerSearch(e: React.FormEvent) {
    e.preventDefault();
    startCustomerSearch(async () => {
      setCustomerResults(await searchCustomersAction(customerQuery));
    });
  }

  function addToCart(product: ProductSearchResult) {
    setCart((prev) => {
      const existing = prev.find((i) => i.id === product.id);
      // Tope blando por stock visto en la última búsqueda — la
      // autoridad real es create_order() en el servidor.
      const cap = product.stockAvailable > 0 ? product.stockAvailable : Infinity;
      if (existing) {
        return prev.map((i) => (i.id === product.id ? { ...i, quantity: Math.min(i.quantity + 1, cap) } : i));
      }
      return [...prev, { ...product, quantity: Math.min(1, cap) }];
    });
  }

  function updateQuantity(productId: string, quantity: number) {
    setCart((prev) =>
      prev.map((i) => (i.id === productId ? { ...i, quantity: Math.max(1, Math.floor(quantity) || 1) } : i))
    );
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((i) => i.id !== productId));
  }

  function selectCustomer(c: CustomerSearchResult) {
    setCustomer(c);
    setCustomerResults([]);
    setCustomerQuery("");
  }

  function confirmLooseBuyer() {
    if (!looseBuyerName.trim()) return;
    setLooseBuyer({
      buyerName: looseBuyerName.trim(),
      buyerCuitDni: looseBuyerDoc.trim(),
      buyerIvaCondition: looseBuyerIva,
      buyerEmail: looseBuyerEmail.trim(),
    });
    setShowLooseBuyerForm(false);
  }

  function clearLooseBuyer() {
    setLooseBuyer(null);
    setLooseBuyerName("");
    setLooseBuyerDoc("");
    setLooseBuyerIva("consumidor_final");
    setLooseBuyerEmail("");
  }

  async function handleSubmit() {
    setSubmitting(true);
    setResult(null);

    const res = await createPosSaleAction({
      customerId: customer?.id ?? null,
      looseBuyer: looseBuyer
        ? {
            buyerName: looseBuyer.buyerName,
            buyerCuitDni: looseBuyer.buyerCuitDni,
            buyerIvaCondition: looseBuyer.buyerIvaCondition,
            buyerEmail: looseBuyer.buyerEmail,
          }
        : null,
      paymentMethod,
      items: cart.map((i) => ({ productId: i.id, quantity: i.quantity })),
    });

    setResult(res);
    setSubmitting(false);

    if (res.ok) {
      setLastInvoiceEmail(looseBuyer?.buyerEmail?.trim() || customer?.email || null);
      setCart([]);
      setCustomer(null);
      clearLooseBuyer();
      setProductQuery("");
      setProductResults([]);
    }
  }

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
      <div className="space-y-6">
        {/* Cliente */}
        <div className="neu-card p-4">
          <p className="text-sm font-medium mb-3">Cliente</p>

          {customer ? (
            <div className="neu-inset flex items-center justify-between px-3 py-2">
              <div>
                <p className="text-sm">{customer.fullName}</p>
                <p className="text-xs text-ink-muted">
                  {customer.email} ·{" "}
                  {customer.customerType === "mayorista" ? "Mayorista" : "Minorista"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCustomer(null)}
                className="text-xs text-ink-muted hover:underline"
              >
                Quitar
              </button>
            </div>
          ) : looseBuyer ? (
            <div className="neu-inset flex items-center justify-between px-3 py-2">
              <div>
                <p className="text-sm">{looseBuyer.buyerName}</p>
                <p className="text-xs text-ink-muted">
                  {looseBuyer.buyerCuitDni || "sin CUIT/DNI"} ·{" "}
                  {IVA_CONDITION_LABELS[looseBuyer.buyerIvaCondition]} · datos sueltos, sin cuenta
                </p>
                <p className="text-xs text-ink-muted">
                  {looseBuyer.buyerEmail
                    ? `La factura se le manda a ${looseBuyer.buyerEmail}`
                    : "Sin email: se entrega el comprobante impreso"}
                </p>
              </div>
              <button
                type="button"
                onClick={clearLooseBuyer}
                className="text-xs text-ink-muted hover:underline"
              >
                Quitar
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs text-ink-subtle mb-2">
                Sin cliente seleccionado: se factura a Consumidor Final y{" "}
                <span className="text-warning">la factura no se envía por mail</span> (no hay
                dirección a la que mandarla). Si el cliente la quiere por email, buscalo abajo o
                cargá los datos sueltos.
              </p>
              <form onSubmit={handleCustomerSearch} className="flex gap-2">
                <input
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="Buscar cliente por nombre o email"
                  className="neu-input flex-1"
                />
                <button
                  type="submit"
                  disabled={searchingCustomers}
                  className="neu-btn !text-sm"
                >
                  Buscar
                </button>
              </form>
              {customerResults.length > 0 && (
                <div className="neu-inset mt-2">
                  {customerResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="w-full px-3 py-2 text-left text-sm hover:text-brand"
                    >
                      {c.fullName} <span className="text-xs text-ink-subtle">— {c.email}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3 border-t border-[color:var(--hairline)] pt-3">
                <button
                  type="button"
                  onClick={() => setShowLooseBuyerForm((v) => !v)}
                  className="text-xs text-ink-muted underline"
                >
                  {showLooseBuyerForm
                    ? "Cancelar"
                    : "Cargar datos fiscales sueltos (ej: pide Factura A sin tener cuenta)"}
                </button>

                {showLooseBuyerForm && (
                  <div className="mt-2 space-y-2">
                    <input
                      value={looseBuyerName}
                      onChange={(e) => setLooseBuyerName(e.target.value)}
                      placeholder="Nombre o razón social"
                      className="neu-input"
                    />
                    <input
                      value={looseBuyerDoc}
                      onChange={(e) => setLooseBuyerDoc(e.target.value)}
                      placeholder="CUIT o DNI (opcional)"
                      className="neu-input"
                    />
                    <select
                      value={looseBuyerIva}
                      onChange={(e) => setLooseBuyerIva(e.target.value as PosIvaCondition)}
                      className="neu-input"
                    >
                      {IVA_CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {IVA_CONDITION_LABELS[c]}
                        </option>
                      ))}
                    </select>
                    <input
                      type="email"
                      value={looseBuyerEmail}
                      onChange={(e) => setLooseBuyerEmail(e.target.value)}
                      placeholder="Email (opcional, para mandarle la factura)"
                      className="neu-input"
                    />
                    <p className="text-[11px] text-ink-subtle">
                      Solo se emite Factura A a Responsable Inscripto con CUIT válido — en
                      cualquier otro caso se emite Factura B automáticamente. Estos datos van solo
                      a la factura, no crean una cuenta de cliente. Si cargás el email, se le manda
                      la factura en PDF apenas se autorice.
                    </p>
                    <button
                      type="button"
                      onClick={confirmLooseBuyer}
                      disabled={!looseBuyerName.trim()}
                      className="neu-btn neu-btn-primary !px-3 !py-1.5 !text-xs"
                    >
                      Usar estos datos
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Buscador de productos */}
        <div className="neu-card p-4">
          <p className="text-sm font-medium mb-3">Productos</p>
          <form onSubmit={handleProductSearch} className="flex gap-2">
            <input
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              placeholder="Buscar por nombre o SKU"
              className="neu-input flex-1"
            />
            <button
              type="submit"
              disabled={searchingProducts}
              className="neu-btn !text-sm"
            >
              Buscar
            </button>
          </form>

          {productResults.length > 0 && (
            <div className="neu-inset mt-3 divide-y divide-[color:var(--hairline)]">
              {productResults.map((p) => {
                const unitPrice = getPriceForCustomerType(p, customerType);
                const outOfStock = p.stockAvailable <= 0;
                return (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <p>{p.name}</p>
                      <p className="text-xs text-ink-subtle">
                        SKU {p.sku} · $ {formatMoney(unitPrice)} ·{" "}
                        {outOfStock ? "sin stock" : `${p.stockAvailable} disp.`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addToCart(p)}
                      disabled={outOfStock}
                      className="neu-btn neu-btn-primary !px-3 !py-1.5 !text-xs"
                    >
                      Agregar
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Carrito */}
        <div className="neu-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="neu-table-head text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-3">Producto</th>
                <th className="text-center px-4 py-3">Cant.</th>
                <th className="text-right px-4 py-3">Precio</th>
                <th className="text-right px-4 py-3">Subtotal</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="neu-row">
                  <td className="px-4 py-3">
                    {line.name}
                    <p className="text-xs text-ink-subtle">SKU {line.sku}</p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => updateQuantity(line.id, Number(e.target.value))}
                      className="neu-input w-16 !px-2 !py-1 text-center"
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-ink-muted">$ {formatMoney(line.unitPrice)}</td>
                  <td className="px-4 py-3 text-right">$ {formatMoney(line.lineGross)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => removeFromCart(line.id)}
                      className="text-xs text-danger hover:underline"
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-ink-subtle">
                    Todavía no agregaste productos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resumen y confirmación */}
      <div className="neu-card space-y-3 p-4">
        <p className="text-sm font-medium">Resumen</p>

        {result?.error && <p className="text-xs text-danger">{result.error}</p>}
        {result?.ok && (
          <div className="space-y-1">
            <p className="text-xs text-success">
              Venta #{result.orderNumber} confirmada por $ {formatMoney(result.total ?? 0)}.
            </p>
            {lastInvoiceEmail ? (
              <p className="text-xs text-success">
                La factura se le envía por email a {lastInvoiceEmail}.
              </p>
            ) : (
              <p className="text-xs text-warning">
                Esta venta no tenía email, así que{" "}
                <span className="font-medium">la factura no se envió por mail</span>. Podés
                imprimirla o mandarla desde Facturación.
              </p>
            )}
          </div>
        )}

        <div className="text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-ink-muted">Subtotal</span>
            <span>$ {formatMoney(totals.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">IVA</span>
            <span>$ {formatMoney(totals.vatAmount)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-[color:var(--hairline)] pt-1 font-semibold">
            <span>Total</span>
            <span>$ {formatMoney(totals.total)}</span>
          </div>
        </div>

        <div>
          <p className="text-xs text-ink-muted mb-1">Medio de pago</p>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PosPaymentMethod)}
            className="neu-input"
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || cart.length === 0}
          className="neu-btn neu-btn-primary w-full"
        >
          {submitting ? "Confirmando..." : "Confirmar venta"}
        </button>
      </div>
    </div>
  );
}
