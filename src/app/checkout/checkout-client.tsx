"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/modules/cart/cart-context";
import { Logo } from "@/app/_components/logo";
import { isValidCuit } from "@/shared/utils/cuit";
import { validateCustomerFiscalData } from "@/modules/customers/fiscal-rules";
import { buildTransferReference } from "@/modules/payments/transfer-config";
import { TransferInstructions, type TransferBankData } from "./transfer-instructions";
import { updateFiscalDataAction } from "./actions";

type Step = "review" | "transfer";

interface CheckoutOrder {
  id: string;
  total: number;
  orderNumber: number;
  createdAt: string;
}

export default function CheckoutClient({
  customerCuitDni,
  customerIvaCondition,
  suggestFacturaA,
  anonymousInvoiceThreshold,
  bank,
  bankConfigured,
  transferWindowMinutes,
}: {
  customerCuitDni?: string | null;
  /** Condición de IVA guardada en el perfil del cliente. */
  customerIvaCondition?: string;
  suggestFacturaA?: boolean;
  anonymousInvoiceThreshold?: number;
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

  // "Necesito Factura A" — desactivada por defecto: sin marcar, sale
  // Factura B a Consumidor Final. Al marcarla solo se pide el CUIT:
  // pedir Factura A YA implica declararse Responsable Inscripto, que es
  // la única condición que la habilita.
  //
  // Decisión del negocio: esa condición queda guardada en el perfil
  // PARA SIEMPRE (la facturación lee el perfil, no la compra). No se
  // cambia ese comportamiento, se hace visible: al marcarla se muestra
  // una advertencia, y si el cliente ya es Responsable Inscripto se le
  // avisa que la compra sale como Factura A aunque no marque nada.
  const [wantsFacturaA, setWantsFacturaA] = useState(false);
  const [cuitInput, setCuitInput] = useState(customerCuitDni ?? "");
  const isRegisteredAsRI = customerIvaCondition === "responsable_inscripto";
  // Quien ya es Responsable Inscripto no puede dejar de serlo desde acá
  // (eso lo cambia Casa Periotti), pero sí corregir su CUIT si lo cargó mal.
  const [editingRiCuit, setEditingRiCuit] = useState(false);
  const savesCuitAsRI = wantsFacturaA || (isRegisteredAsRI && editingRiCuit);

  const threshold = anonymousInvoiceThreshold ?? 10_000_000;
  // Umbral de ARCA: por encima de este monto, ni Consumidor Final puede
  // quedar anónimo — hace falta CUIT, CUIL, CDI o DNI (no implica
  // Factura A, solo identificación).
  const needsIdentification = estimatedTotal >= threshold;

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

    // Mismas reglas que el panel y el mostrador (fiscal-rules.ts). Un CUIT
    // con el dígito verificador mal hace que ARCA rechace la factura.
    if (savesCuitAsRI && !isValidCuit(cuitInput)) {
      setError("El CUIT no es válido: revisá los 11 dígitos (el último es un dígito verificador).");
      return;
    }
    if (needsIdentification && !wantsFacturaA && !isRegisteredAsRI) {
      const idError = validateCustomerFiscalData({
        cuitDni: cuitInput,
        ivaCondition: "consumidor_final",
      });
      if (!cuitInput.trim() || idError) {
        setError(
          idError ??
            `Por el monto de esta compra, ARCA exige identificarte — ingresá tu DNI o CUIT más abajo.`
        );
        return;
      }
    }

    setCreatingOrder(true);
    try {
      // Se guardan los datos fiscales en el perfil ANTES de crear el
      // pedido: cuando se facture (después de que un empleado confirme
      // la transferencia), BillingService ya los va a encontrar ahí, y
      // quedan precargados para la próxima compra.
      if ((savesCuitAsRI || needsIdentification) && cuitInput.trim()) {
        const fd = new FormData();
        fd.set("cuitDni", cuitInput.trim());
        fd.set(
          "ivaCondition",
          wantsFacturaA || isRegisteredAsRI ? "responsable_inscripto" : "consumidor_final"
        );
        const fiscalResult = await updateFiscalDataAction(fd);
        if (fiscalResult.error) {
          setError(fiscalResult.error);
          setCreatingOrder(false);
          return;
        }
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

            {/* Discreta a propósito: la mayoría de las compras son
                minoristas a Consumidor Final, sin Factura A. */}
            <div className="mt-4">
              {suggestFacturaA && !wantsFacturaA && !isRegisteredAsRI && (
                <div className="mb-3 rounded-neu bg-info-soft p-3 text-xs text-info">
                  Según el padrón de ARCA, tu CUIT figura como Responsable Inscripto.{" "}
                  <button
                    type="button"
                    onClick={() => setWantsFacturaA(true)}
                    className="font-medium text-brand hover:underline"
                  >
                    ¿Querés que te emitamos Factura A?
                  </button>
                </div>
              )}

              {isRegisteredAsRI ? (
                <div className="rounded-neu bg-info-soft p-3 text-xs text-info">
                  <p className="font-semibold">Tu cuenta está registrada como Responsable Inscripto</p>
                  <p className="mt-1">
                    Esta compra se factura como <span className="font-semibold">Factura A</span>
                    {customerCuitDni ? ` al CUIT ${customerCuitDni}` : ""}.
                  </p>
                  {editingRiCuit ? (
                    <div className="mt-2 space-y-1.5">
                      <input
                        value={cuitInput}
                        onChange={(e) => setCuitInput(e.target.value)}
                        placeholder="CUIT (11 dígitos)"
                        inputMode="numeric"
                        className="neu-input"
                      />
                      {cuitInput.trim() && !isValidCuit(cuitInput) && (
                        <p className="font-medium text-danger">
                          El CUIT no es válido: revisá los 11 dígitos.
                        </p>
                      )}
                      <p>
                        El CUIT corregido se guarda al confirmar el pedido. Para dejar de ser
                        Responsable Inscripto, comunicate con Casa Periotti.
                      </p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditingRiCuit(true)}
                      className="mt-2 font-semibold underline"
                    >
                      Corregir el CUIT
                    </button>
                  )}
                </div>
              ) : (
                <label className="flex items-center gap-2 text-xs text-ink-muted">
                  <input
                    type="checkbox"
                    checked={wantsFacturaA}
                    onChange={(e) => setWantsFacturaA(e.target.checked)}
                  />
                  Necesito Factura A
                </label>
              )}

              {wantsFacturaA && (
                <div className="mt-2 space-y-2">
                  <input
                    value={cuitInput}
                    onChange={(e) => setCuitInput(e.target.value)}
                    placeholder="CUIT"
                    className="neu-input"
                  />
                  <div className="rounded-neu bg-warning-soft p-3 text-xs text-warning" role="note">
                    <p className="font-semibold">Atención: este cambio es permanente</p>
                    <p className="mt-1">
                      Al pedir Factura A con tu CUIT, tu cuenta queda registrada como{" "}
                      <span className="font-semibold">Responsable Inscripto</span> y{" "}
                      <span className="font-semibold">todas tus compras futuras</span> se van a
                      facturar como Factura A, aunque no vuelvas a marcar esta opción. Si te
                      equivocás de CUIT lo podés corregir en tu próxima compra; para dejar de ser
                      Responsable Inscripto, comunicate con Casa Periotti.
                    </p>
                  </div>
                </div>
              )}

              {needsIdentification && !wantsFacturaA && !isRegisteredAsRI && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium text-warning">
                    Por el monto de esta compra, ARCA exige identificarte — ingresá tu DNI o CUIT.
                  </p>
                  <input
                    value={cuitInput}
                    onChange={(e) => setCuitInput(e.target.value)}
                    placeholder="DNI o CUIT"
                    className="neu-input"
                  />
                </div>
              )}
            </div>

            {!bankConfigured && (
              <div className="rounded-neu bg-danger-soft p-3 text-sm font-medium text-danger">
                No podemos tomar pedidos en este momento porque todavía no están cargados los datos
                para transferir. Escribinos y lo resolvemos.
              </div>
            )}

            <button
              onClick={handleCreateOrder}
              disabled={creatingOrder || !bankConfigured}
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
