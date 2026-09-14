"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useCart } from "@/modules/cart/cart-context";
import { Logo } from "@/app/_components/logo";
import { buildTransferReference } from "@/modules/payments/transfer-config";
import { TransferInstructions, type TransferBankData } from "./transfer-instructions";
import { updateFiscalDataAction } from "./actions";

type Step = "review" | "transfer";
type IvaCondition = "consumidor_final" | "responsable_inscripto" | "monotributista" | "exento";

interface CheckoutOrder {
  id: string;
  total: number;
  orderNumber: number;
  createdAt: string;
}

const IVA_CONDITION_LABELS: Record<IvaCondition, string> = {
  consumidor_final: "Consumidor Final",
  responsable_inscripto: "Responsable Inscripto",
  monotributista: "Monotributista",
  exento: "Exento",
};

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
  customerIvaCondition?: IvaCondition;
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

  // "Necesito Factura A" — desactivada por defecto siempre: sin marcar,
  // sale Factura B a Consumidor Final. Al marcarla, pide CUIT y
  // condición de IVA (precargados si el cliente ya los tiene guardados).
  const [wantsFacturaA, setWantsFacturaA] = useState(false);
  const [cuitInput, setCuitInput] = useState(customerCuitDni ?? "");
  const [ivaConditionInput, setIvaConditionInput] = useState<IvaCondition>(
    customerIvaCondition && customerIvaCondition !== "consumidor_final"
      ? customerIvaCondition
      : "responsable_inscripto"
  );

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

    if (wantsFacturaA && cuitInput.replace(/\D/g, "").length !== 11) {
      setError("Para pedir Factura A necesitamos un CUIT válido (11 dígitos).");
      return;
    }
    if (needsIdentification && !wantsFacturaA && cuitInput.trim().length < 7) {
      setError(
        `Por el monto de esta compra, ARCA exige identificarte — ingresá tu DNI o CUIT más abajo.`
      );
      return;
    }

    setCreatingOrder(true);
    try {
      // Se guardan los datos fiscales en el perfil ANTES de crear el
      // pedido: cuando se facture (después de que un empleado confirme
      // la transferencia), BillingService ya los va a encontrar ahí, y
      // quedan precargados para la próxima compra.
      if ((wantsFacturaA || needsIdentification) && cuitInput.trim()) {
        const fd = new FormData();
        fd.set("cuitDni", cuitInput.trim());
        fd.set("ivaCondition", wantsFacturaA ? ivaConditionInput : "consumidor_final");
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
              {suggestFacturaA && !wantsFacturaA && (
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

              <label className="flex items-center gap-2 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  checked={wantsFacturaA}
                  onChange={(e) => setWantsFacturaA(e.target.checked)}
                />
                Necesito Factura A
              </label>

              {wantsFacturaA && (
                <div className="mt-2 space-y-2">
                  <input
                    value={cuitInput}
                    onChange={(e) => setCuitInput(e.target.value)}
                    placeholder="CUIT"
                    className="neu-input"
                  />
                  <select
                    value={ivaConditionInput}
                    onChange={(e) => setIvaConditionInput(e.target.value as IvaCondition)}
                    className="neu-input"
                  >
                    {(Object.keys(IVA_CONDITION_LABELS) as IvaCondition[]).map((c) => (
                      <option key={c} value={c}>
                        {IVA_CONDITION_LABELS[c]}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-ink-subtle">
                    Solo emitimos Factura A si sos Responsable Inscripto con CUIT válido — lo
                    verificamos contra ARCA antes de facturar. En cualquier otro caso, sale
                    Factura B igual.
                  </p>
                </div>
              )}

              {needsIdentification && !wantsFacturaA && (
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
