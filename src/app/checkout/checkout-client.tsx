"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/modules/cart/cart-context";
import { Logo } from "@/app/_components/logo";
import { FiscalInvoiceSelector, type FiscalSelection } from "@/app/_components/fiscal-invoice-selector";
import { buildTransferReference } from "@/modules/payments/transfer-config";
import { TransferInstructions, type TransferBankData } from "./transfer-instructions";
import { previewFiscalInvoiceAction, saveInvoicePreferenceAction } from "./actions";

type Step = "review" | "transfer";

interface CheckoutOrder {
  id: string;
  total: number;
  orderNumber: number;
  createdAt: string;
}

export default function CheckoutClient({
  customerCuitDni,
  customerDni,
  invoiceWithFiscalData,
  anonymousInvoiceThreshold,
  pendingOrderNumbers,
  bank,
  bankConfigured,
  transferWindowMinutes,
}: {
  /** CUIT guardado en el perfil: se precarga, pero se revalida en el padrón. */
  customerCuitDni?: string | null;
  customerDni?: string | null;
  /** Si la última compra fue con datos fiscales, arranca con esa opción. */
  invoiceWithFiscalData?: boolean;
  /** Umbral de identificación de ARCA (business_settings). */
  anonymousInvoiceThreshold: number;
  /** Pedidos que todavía no tienen factura: esperan confirmación de pago, o están pagados con la factura pendiente. */
  pendingOrderNumbers: number[];
  bank: TransferBankData;
  // Si el negocio todavía no cargó alias/CBU en /admin/configuracion-pago,
  // no hay forma de que nadie transfiera: se avisa y no se deja confirmar
  // el pedido (crearlo reservaría stock que nadie va a poder pagar).
  bankConfigured: boolean;
  transferWindowMinutes: number;
}) {
  const { items, clear, estimatedTotal } = useCart();
  const router = useRouter();

  const [fulfillmentMethod, setFulfillmentMethod] = useState<"pickup" | "delivery">("pickup");
  const [shippingStreet, setShippingStreet] = useState("");
  const [shippingCity, setShippingCity] = useState("Sunchales");
  const [step, setStep] = useState<Step>("review");
  const [order, setOrder] = useState<CheckoutOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);

  // Comprobante de esta compra (ver FiscalInvoiceSelector). La letra la
  // decide el padrón de ARCA, no el cliente.
  const [fiscalSelection, setFiscalSelection] = useState<FiscalSelection | null>(null);

  if (items.length === 0 && step === "review") {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-ink-muted">
          Tu carrito está vacío.{" "}
          <Link href="/" className="text-brand hover:underline">
            Volver al catálogo
          </Link>
        </p>
      </main>
    );
  }

  async function handleCreateOrder() {
    setError(null);

    if (!fiscalSelection || !fiscalSelection.ready) {
      setError(fiscalSelection?.problem ?? "Revisá los datos de facturación.");
      return;
    }

    setCreatingOrder(true);
    try {
      // Se guarda la elección de esta compra en el perfil ANTES de crear
      // el pedido: cuando se facture (después de que un empleado confirme
      // la transferencia), BillingService la lee de ahí. El servidor
      // vuelve a validar todo.
      const fiscalResult = await saveInvoicePreferenceAction(
        fiscalSelection.kind === "fiscal_data"
          ? { kind: "fiscal_data", cuit: fiscalSelection.cuit }
          : { kind: "final_consumer", dni: fiscalSelection.dni ?? undefined }
      );
      if (fiscalResult.error) {
        setError(fiscalResult.error);
        setCreatingOrder(false);
        return;
      }

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
          fulfillmentMethod,
          shippingStreet: fulfillmentMethod === "delivery" ? shippingStreet : undefined,
          shippingCity: fulfillmentMethod === "delivery" ? shippingCity : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo crear el pedido");
        return;
      }
      setOrder(data.order);
      setStep("transfer");
    } catch {
      setError("No pudimos conectar con el servidor. Probá de nuevo.");
    } finally {
      setCreatingOrder(false);
    }
  }

  /**
   * El comprobante ya quedó subido y el pedido pasó a "esperando
   * confirmación de pago". Se vacía el carrito y se manda a la página
   * del pedido, que es donde el cliente va a ver cuándo se confirma.
   */
  function handleReceiptUploaded() {
    if (!order) return;
    clear();
    router.push(`/pedido/${order.id}`);
  }

  return (
    <main className="min-h-screen">
      <header className="sticky top-0 z-20 bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="rounded-neu-sm" aria-label="Casa Periotti — inicio">
            <Logo size="md" />
          </Link>
          <Link href="/carrito" className="neu-chip">
            Volver al carrito
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 pb-16 pt-4">
        <h1 className="mb-5 text-xl font-bold text-ink">Checkout</h1>

        {error && (
          <div className="mb-4 rounded-neu bg-danger-soft p-3 text-sm font-medium text-danger">
            {error}
          </div>
        )}

        {step === "review" && (
          <div className="neu-card space-y-6 p-5 sm:p-6">
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Entrega</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setFulfillmentMethod("pickup")}
                  className={`neu-chip flex-1 !justify-center !rounded-neu !py-2.5 ${
                    fulfillmentMethod === "pickup" ? "neu-chip-active font-semibold" : ""
                  }`}
                >
                  Retiro en local
                </button>
                <button
                  onClick={() => setFulfillmentMethod("delivery")}
                  className={`neu-chip flex-1 !justify-center !rounded-neu !py-2.5 ${
                    fulfillmentMethod === "delivery" ? "neu-chip-active font-semibold" : ""
                  }`}
                >
                  Envío a domicilio
                </button>
              </div>
            </div>

            {fulfillmentMethod === "delivery" && (
              <div className="space-y-2">
                <input
                  placeholder="Calle y número"
                  value={shippingStreet}
                  onChange={(e) => setShippingStreet(e.target.value)}
                  className="neu-input"
                />
                <input
                  placeholder="Ciudad"
                  value={shippingCity}
                  onChange={(e) => setShippingCity(e.target.value)}
                  className="neu-input"
                />
              </div>
            )}

            <div>
              <p className="mb-2 text-sm font-medium text-ink">Forma de pago</p>
              <div className="neu-inset px-3 py-2.5">
                <p className="text-sm font-medium text-ink">Transferencia bancaria</p>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Al confirmar te mostramos los datos para transferir. Tenés{" "}
                  {transferWindowMinutes} minutos para hacerlo y subir el comprobante.
                </p>
              </div>
            </div>

            <div className="mt-3 flex justify-between">
              <span className="text-sm text-ink-muted">Estimado (se recalcula al confirmar)</span>
              <span className="font-bold">$ {estimatedTotal.toLocaleString("es-AR")}</span>
            </div>

            {/* Discreta a propósito: la mayoría de las compras son a
                Consumidor Final. */}
            <div className="mt-4">
              <FiscalInvoiceSelector
                initialCuit={customerCuitDni}
                initialDni={customerDni}
                initialFiscal={invoiceWithFiscalData}
                total={estimatedTotal}
                threshold={anonymousInvoiceThreshold}
                previewAction={previewFiscalInvoiceAction}
                onChange={setFiscalSelection}
              />
            </div>

            {/* La elección fiscal vive en el perfil, no en el pedido: los
                pedidos que todavía esperan confirmación de pago se van a
                facturar con lo que se guarde ahora. Limitación conocida,
                ver docs/deuda-tecnica-eleccion-fiscal-web.md. */}
            {pendingOrderNumbers.length > 0 &&
              (fiscalSelection?.kind === "fiscal_data" || invoiceWithFiscalData) && (
                <div className="rounded-neu bg-warning-soft p-4 text-sm text-warning" role="alert">
                  <p className="font-semibold">
                    {fiscalSelection?.kind === "fiscal_data"
                      ? "Estos datos fiscales se van a usar también para facturar tus compras que todavía están esperando confirmación de pago o tienen la factura pendiente."
                      : "Tus compras que todavía están esperando confirmación de pago o tienen la factura pendiente se van a facturar como Consumidor Final, igual que esta."}
                  </p>
                  <p className="mt-1">
                    {pendingOrderNumbers.length === 1 ? "Pedido" : "Pedidos"}{" "}
                    {pendingOrderNumbers.map((n) => `#${n}`).join(", ")}. Si necesitás que alguno se
                    facture distinto, esperá a que tenga su factura antes de hacer esta compra, o
                    comunicate con Casa Periotti.
                  </p>
                </div>
              )}

            {!bankConfigured && (
              <div className="rounded-neu bg-danger-soft p-3 text-sm font-medium text-danger">
                No podemos tomar pedidos en este momento porque todavía no están cargados los datos
                para transferir. Escribinos y lo resolvemos.
              </div>
            )}

            <button
              onClick={handleCreateOrder}
              disabled={creatingOrder || !bankConfigured || !fiscalSelection?.ready}
              className="neu-btn neu-btn-primary w-full !py-3"
            >
              {creatingOrder ? "Creando pedido..." : "Confirmar pedido"}
            </button>
          </div>
        )}

        {step === "transfer" && order && (
          <TransferInstructions
            orderId={order.id}
            orderNumber={order.orderNumber}
            total={order.total}
            reference={buildTransferReference(order.orderNumber)}
            // El vencimiento se calcula con la MISMA ventana que usa el
            // cron del servidor (transferWindowMinutes llega desde
            // getTransferWindowMinutes() en el Server Component), sobre
            // el created_at real del pedido.
            deadlineIso={new Date(
              new Date(order.createdAt).getTime() + transferWindowMinutes * 60 * 1000
            ).toISOString()}
            bank={bank}
            onUploaded={handleReceiptUploaded}
          />
        )}
      </div>
    </main>
  );
}
