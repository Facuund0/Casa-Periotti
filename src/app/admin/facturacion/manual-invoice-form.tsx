"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createManualInvoiceAction, type BillingActionResult } from "@/modules/billing/actions";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatMoney(n: number): string {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ManualInvoiceForm() {
  const [result, setResult] = useState<BillingActionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [netAmountInput, setNetAmountInput] = useState("");
  const [vatRateInput, setVatRateInput] = useState("21");

  // Solo para mostrarle el desglose al empleado mientras escribe — el
  // cálculo que realmente vale es el que hace el servidor en
  // createManualInvoiceAction, nunca este.
  const breakdown = useMemo(() => {
    const netAmount = Number(netAmountInput);
    const vatRate = Number(vatRateInput);
    if (!Number.isFinite(netAmount) || netAmount <= 0 || !Number.isFinite(vatRate) || vatRate < 0) {
      return null;
    }
    const roundedNet = round2(netAmount);
    const vatAmount = round2(roundedNet * (vatRate / 100));
    const totalAmount = round2(roundedNet + vatAmount);
    return { netAmount: roundedNet, vatAmount, totalAmount };
  }, [netAmountInput, vatRateInput]);

  return (
    <form
      action={async (formData) => {
        setLoading(true);
        setResult(null);
        const res = await createManualInvoiceAction(formData);
        setResult(res);
        setLoading(false);
      }}
      className="space-y-3 max-w-md"
    >
      <p className="text-sm font-medium">Facturar manualmente</p>

      <div className="space-y-1 rounded-neu bg-warning-soft p-3 text-xs text-warning">
        <p className="font-medium">⚠️ Esto NO descuenta stock</p>
        <p>
          Usá esta opción solo para conceptos que no son productos del catálogo (fletes,
          servicios, anticipos). Facturar acá un producto desincroniza el inventario: la web
          puede seguir vendiendo algo que ya no queda. Para vender productos, usá{" "}
          <Link href="/admin/venta" className="underline font-medium">
            Venta de mostrador
          </Link>
          , que descuenta stock y factura en el mismo paso.
        </p>
      </div>

      {result?.error && <p className="text-xs text-danger">{result.error}</p>}
      {result?.ok && <p className="text-xs text-success">Factura autorizada correctamente.</p>}

      <input
        name="buyerName"
        placeholder="Nombre del cliente (opcional — Consumidor Final si se deja vacío)"
        className="neu-input"
      />
      <input
        name="buyerCuitDni"
        placeholder="CUIT o DNI (opcional — Consumidor Final si se deja vacío)"
        className="neu-input"
      />
      <select
        name="buyerIvaCondition"
        defaultValue="consumidor_final"
        className="neu-input"
      >
        <option value="consumidor_final">Consumidor Final</option>
        <option value="responsable_inscripto">Responsable Inscripto</option>
        <option value="monotributista">Monotributista</option>
        <option value="exento">Exento</option>
      </select>
      <p className="text-[11px] text-ink-subtle -mt-1">
        Solo se emite Factura A a Responsable Inscripto con CUIT válido — en cualquier otro caso
        se emite Factura B automáticamente.
      </p>
      <div className="flex gap-2">
        <input
          name="netAmount"
          type="number"
          step="0.01"
          placeholder="Subtotal (sin IVA)"
          required
          value={netAmountInput}
          onChange={(e) => setNetAmountInput(e.target.value)}
          className="neu-input flex-1"
        />
        <input
          name="vatRate"
          type="number"
          step="0.01"
          placeholder="IVA %"
          value={vatRateInput}
          onChange={(e) => setVatRateInput(e.target.value)}
          className="neu-input w-24"
        />
      </div>

      {breakdown && (
        <div className="neu-inset space-y-1 p-3 text-xs">
          <div className="flex justify-between">
            <span className="text-ink-muted">Subtotal</span>
            <span>$ {formatMoney(breakdown.netAmount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-muted">IVA ({vatRateInput || 0}%)</span>
            <span>$ {formatMoney(breakdown.vatAmount)}</span>
          </div>
          <div className="mt-1 flex justify-between border-t border-[color:var(--hairline)] pt-1 font-semibold">
            <span>Total</span>
            <span>$ {formatMoney(breakdown.totalAmount)}</span>
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="neu-btn neu-btn-primary w-full"
      >
        {loading ? "Facturando..." : "Emitir factura"}
      </button>
    </form>
  );
}
