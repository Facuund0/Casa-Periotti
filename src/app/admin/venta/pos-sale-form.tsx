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
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>("efectivo");

  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<ProductSearchResult[]>([]);
  const [searchingProducts, startProductSearch] = useTransition();

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerSearchResult[]>([]);
  const [searchingCustomers, startCustomerSearch] = useTransition();

  const [result, setResult] = useState<PosSaleActionResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
    });
    setShowLooseBuyerForm(false);
  }

  function clearLooseBuyer() {
    setLooseBuyer(null);
    setLooseBuyerName("");
    setLooseBuyerDoc("");
    setLooseBuyerIva("consumidor_final");
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
          }
        : null,
      paymentMethod,
      items: cart.map((i) => ({ productId: i.id, quantity: i.quantity })),
    });

    setResult(res);
    setSubmitting(false);

    if (res.ok) {
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
        <div className="bg-white rounded-lg border border-neutral-200 p-4">
          <p className="text-sm font-medium mb-3">Cliente</p>

          {customer ? (
            <div className="flex items-center justify-between bg-neutral-50 rounded-md px-3 py-2">
              <div>
                <p className="text-sm">{customer.fullName}</p>
                <p className="text-xs text-neutral-500">
                  {customer.email} ·{" "}
                  {customer.customerType === "mayorista" ? "Mayorista" : "Minorista"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCustomer(null)}
                className="text-xs text-neutral-500 hover:underline"
              >
                Quitar
              </button>
            </div>
          ) : looseBuyer ? (
            <div className="flex items-center justify-between bg-neutral-50 rounded-md px-3 py-2">
              <div>
                <p className="text-sm">{looseBuyer.buyerName}</p>
                <p className="text-xs text-neutral-500">
                  {looseBuyer.buyerCuitDni || "sin CUIT/DNI"} ·{" "}
                  {IVA_CONDITION_LABELS[looseBuyer.buyerIvaCondition]} · datos sueltos, sin cuenta
                </p>
              </div>
              <button
                type="button"
                onClick={clearLooseBuyer}
                className="text-xs text-neutral-500 hover:underline"
              >
                Quitar
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs text-neutral-400 mb-2">
                Sin cliente seleccionado: se factura a Consumidor Final.
              </p>
              <form onSubmit={handleCustomerSearch} className="flex gap-2">
                <input
                  value={customerQuery}
                  onChange={(e) => setCustomerQuery(e.target.value)}
                  placeholder="Buscar cliente por nombre o email"
                  className="flex-1 border border-neutral-300 rounded-md px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  disabled={searchingCustomers}
                  className="text-sm border border-neutral-300 rounded-md px-3 py-2 disabled:opacity-50"
                >
                  Buscar
                </button>
              </form>
              {customerResults.length > 0 && (
                <div className="mt-2 border border-neutral-100 rounded-md divide-y divide-neutral-100">
                  {customerResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => selectCustomer(c)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-50"
                    >
                      {c.fullName} <span className="text-xs text-neutral-400">— {c.email}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="mt-3 border-t border-neutral-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowLooseBuyerForm((v) => !v)}
                  className="text-xs text-neutral-500 underline"
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
                      className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
                    />
                    <input
                      value={looseBuyerDoc}
                      onChange={(e) => setLooseBuyerDoc(e.target.value)}
                      placeholder="CUIT o DNI (opcional)"
                      className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
                    />
                    <select
                      value={looseBuyerIva}
                      onChange={(e) => setLooseBuyerIva(e.target.value as PosIvaCondition)}
                      className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
                    >
                      {IVA_CONDITIONS.map((c) => (
                        <option key={c} value={c}>
                          {IVA_CONDITION_LABELS[c]}
                        </option>
                      ))}
                    </select>
                    <p className="text-[11px] text-neutral-400">
                      Solo se emite Factura A a Responsable Inscripto con CUIT válido — en
                      cualquier otro caso se emite Factura B automáticamente. Estos datos van solo
                      a la factura, no crean una cuenta de cliente.
                    </p>
                    <button
                      type="button"
                      onClick={confirmLooseBuyer}
                      disabled={!looseBuyerName.trim()}
                      className="text-xs bg-neutral-900 text-white rounded-md px-3 py-1.5 disabled:opacity-40"
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
        <div className="bg-white rounded-lg border border-neutral-200 p-4">
          <p className="text-sm font-medium mb-3">Productos</p>
          <form onSubmit={handleProductSearch} className="flex gap-2">
            <input
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              placeholder="Buscar por nombre o SKU"
              className="flex-1 border border-neutral-300 rounded-md px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={searchingProducts}
              className="text-sm border border-neutral-300 rounded-md px-3 py-2 disabled:opacity-50"
            >
              Buscar
            </button>
          </form>

          {productResults.length > 0 && (
            <div className="mt-3 border border-neutral-100 rounded-md divide-y divide-neutral-100">
              {productResults.map((p) => {
                const unitPrice = getPriceForCustomerType(p, customerType);
                const outOfStock = p.stockAvailable <= 0;
                return (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <p>{p.name}</p>
                      <p className="text-xs text-neutral-400">
                        SKU {p.sku} · $ {formatMoney(unitPrice)} ·{" "}
                        {outOfStock ? "sin stock" : `${p.stockAvailable} disp.`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => addToCart(p)}
                      disabled={outOfStock}
                      className="text-xs bg-neutral-900 text-white rounded-md px-3 py-1.5 disabled:opacity-40"
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
        <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-500 text-xs uppercase">
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
                <tr key={line.id} className="border-t border-neutral-100">
                  <td className="px-4 py-3">
                    {line.name}
                    <p className="text-xs text-neutral-400">SKU {line.sku}</p>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      onChange={(e) => updateQuantity(line.id, Number(e.target.value))}
                      className="w-16 border border-neutral-300 rounded-md px-2 py-1 text-center text-sm"
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-neutral-500">$ {formatMoney(line.unitPrice)}</td>
                  <td className="px-4 py-3 text-right">$ {formatMoney(line.lineGross)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => removeFromCart(line.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Quitar
                    </button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-neutral-400">
                    Todavía no agregaste productos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Resumen y confirmación */}
      <div className="bg-white rounded-lg border border-neutral-200 p-4 space-y-3">
        <p className="text-sm font-medium">Resumen</p>

        {result?.error && <p className="text-xs text-red-600">{result.error}</p>}
        {result?.ok && (
          <p className="text-xs text-green-700">
            Venta #{result.orderNumber} confirmada por $ {formatMoney(result.total ?? 0)}.
          </p>
        )}

        <div className="text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-neutral-500">Subtotal</span>
            <span>$ {formatMoney(totals.subtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-500">IVA</span>
            <span>$ {formatMoney(totals.vatAmount)}</span>
          </div>
          <div className="flex justify-between font-semibold border-t border-neutral-200 pt-1 mt-1">
            <span>Total</span>
            <span>$ {formatMoney(totals.total)}</span>
          </div>
        </div>

        <div>
          <p className="text-xs text-neutral-500 mb-1">Medio de pago</p>
          <select
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value as PosPaymentMethod)}
            className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm"
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
          className="w-full bg-neutral-900 text-white rounded-md py-2.5 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
        >
          {submitting ? "Confirmando..." : "Confirmar venta"}
        </button>
      </div>
    </div>
  );
}
