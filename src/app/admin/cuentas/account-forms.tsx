"use client";

import { useState, useTransition } from "react";
import {
  registerAccountAdjustmentAction,
  registerAccountPaymentAction,
  updateCustomerCreditAction,
  type AccountActionResult,
} from "@/modules/accounts/actions";

/**
 * Formularios de la cuenta corriente: registrar un pago, ajustar el saldo
 * y habilitar el fiado con su límite. Ninguno toca ventas ni stock.
 */

export function RegisterPaymentForm({
  customerId,
  balance,
}: {
  customerId: string;
  balance: number;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AccountActionResult | null>(null);
  const [amount, setAmount] = useState("");

  function submit(formData: FormData) {
    setResult(null);
    startTransition(async () => {
      const res = await registerAccountPaymentAction(formData);
      setResult(res);
      if (res.ok) setAmount("");
    });
  }

  return (
    <form action={submit} className="neu-inset space-y-2 p-3">
      <input type="hidden" name="customerId" value={customerId} />
      <p className="text-xs font-medium text-ink">Registrar un pago</p>
      <div className="flex flex-wrap gap-2">
        <label className="text-xs text-ink-muted">
          <span className="mb-1 block">Importe</span>
          <input
            name="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            className="neu-input !w-32 !px-2 !py-1.5 !text-xs"
          />
        </label>
        <label className="text-xs text-ink-muted">
          <span className="mb-1 block">Cómo pagó</span>
          <select name="method" defaultValue="efectivo" className="neu-input !px-2 !py-1.5 !text-xs">
            <option value="efectivo">Efectivo</option>
            <option value="transferencia">Transferencia</option>
            <option value="tarjeta">Tarjeta</option>
            <option value="otro">Otro</option>
          </select>
        </label>
        <label className="min-w-[140px] flex-1 text-xs text-ink-muted">
          <span className="mb-1 block">Nota (opcional)</span>
          <input
            name="note"
            placeholder="Ej: entregó a cuenta"
            className="neu-input !px-2 !py-1.5 !text-xs"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="neu-btn neu-btn-primary !px-3 !py-1.5 !text-xs"
        >
          {pending ? "Guardando…" : "Registrar pago"}
        </button>
        {balance > 0 && (
          <button
            type="button"
            onClick={() => setAmount(balance.toFixed(2).replace(".", ","))}
            className="text-xs text-brand hover:underline"
          >
            Pagó todo
          </button>
        )}
      </div>
      {result?.error && <p className="text-xs text-danger">{result.error}</p>}
      {result?.ok && <p className="text-xs text-success">{result.note}</p>}
    </form>
  );
}

export function CreditSettingsForm({
  customerId,
  enabled,
  limit,
}: {
  customerId: string;
  enabled: boolean;
  limit: number | null;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AccountActionResult | null>(null);

  function submit(formData: FormData) {
    setResult(null);
    startTransition(async () => setResult(await updateCustomerCreditAction(formData)));
  }

  return (
    <form action={submit} className="neu-inset space-y-2 p-3">
      <input type="hidden" name="customerId" value={customerId} />
      <p className="text-xs font-medium text-ink">Permiso de cuenta corriente</p>
      <label className="flex items-center gap-2 text-xs text-ink">
        <input type="checkbox" name="enabled" defaultChecked={enabled} />
        Se le puede vender fiado
      </label>
      <label className="block text-xs text-ink-muted">
        <span className="mb-1 block">Límite sugerido (vacío = sin límite)</span>
        <input
          name="limit"
          defaultValue={limit === null ? "" : String(limit)}
          inputMode="decimal"
          placeholder="0,00"
          className="neu-input !w-40 !px-2 !py-1.5 !text-xs"
        />
      </label>
      <p className="text-[11px] text-ink-subtle">
        El límite avisa al vender, no corta la venta.
      </p>
      <button type="submit" disabled={pending} className="neu-btn !px-3 !py-1.5 !text-xs">
        {pending ? "Guardando…" : "Guardar"}
      </button>
      {result?.error && <p className="text-xs text-danger">{result.error}</p>}
      {result?.ok && <p className="text-xs text-success">{result.note}</p>}
    </form>
  );
}

export function AdjustmentForm({ customerId }: { customerId: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<AccountActionResult | null>(null);
  const [open, setOpen] = useState(false);

  function submit(formData: FormData) {
    setResult(null);
    startTransition(async () => setResult(await registerAccountAdjustmentAction(formData)));
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-ink-muted hover:underline"
      >
        Ajustar el saldo a mano
      </button>
    );
  }

  return (
    <form action={submit} className="neu-inset space-y-2 p-3">
      <input type="hidden" name="customerId" value={customerId} />
      <p className="text-xs font-medium text-ink">Ajuste manual</p>
      <p className="text-[11px] text-ink-subtle">
        Positivo suma deuda, negativo la baja. Queda registrado con tu nombre.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          name="amount"
          inputMode="decimal"
          placeholder="-1000,00"
          className="neu-input !w-32 !px-2 !py-1.5 !text-xs"
        />
        <input
          name="note"
          placeholder="Motivo del ajuste"
          className="neu-input min-w-[160px] flex-1 !px-2 !py-1.5 !text-xs"
        />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="neu-btn !px-3 !py-1.5 !text-xs">
          {pending ? "Guardando…" : "Registrar ajuste"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-2 text-xs text-ink-muted hover:underline"
        >
          Cancelar
        </button>
      </div>
      {result?.error && <p className="text-xs text-danger">{result.error}</p>}
      {result?.ok && <p className="text-xs text-success">{result.note}</p>}
    </form>
  );
}
