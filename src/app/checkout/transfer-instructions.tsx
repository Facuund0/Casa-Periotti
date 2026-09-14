"use client";

import { useEffect, useRef, useState } from "react";
import {
  RECEIPT_ACCEPT_ATTRIBUTE,
  describeReceiptLimits,
  validateReceiptFile,
} from "@/modules/payments/transfer-config";
import { uploadTransferReceiptAction } from "./actions";

export interface TransferBankData {
  alias: string | null;
  cbu: string | null;
  accountHolder: string | null;
  bankName: string | null;
}

/**
 * Pantalla de pago por transferencia: datos bancarios, monto exacto,
 * código de referencia y el reloj con el tiempo restante.
 *
 * El reloj es INFORMATIVO: quien cancela de verdad el pedido y libera el
 * stock es el servidor (ver /api/cron/release-stale-reservations). Los
 * dos usan el mismo plazo — deadlineIso lo calcula el servidor con
 * transferDeadline(), así que no hay forma de que digan cosas distintas.
 */
export function TransferInstructions({
  orderId,
  orderNumber,
  total,
  reference,
  deadlineIso,
  bank,
  onUploaded,
}: {
  orderId: string;
  orderNumber: number;
  total: number;
  reference: string;
  deadlineIso: string;
  bank: TransferBankData;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [remainingMs, setRemainingMs] = useState(() => msUntil(deadlineIso));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const tick = setInterval(() => setRemainingMs(msUntil(deadlineIso)), 1000);
    return () => clearInterval(tick);
  }, [deadlineIso]);

  const expired = remainingMs <= 0;

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const picked = e.target.files?.[0] ?? null;
    if (!picked) {
      setFile(null);
      return;
    }

    // Misma validación que corre después en el servidor
    // (validateReceiptFile, en transfer-config.ts) — acá es solo para
    // avisarle al cliente al instante, sin subir un archivo que va a
    // ser rechazado igual.
    const fileError = validateReceiptFile({ type: picked.type, size: picked.size });
    if (fileError) {
      setError(fileError);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFile(picked);
  }

  async function handleSubmit() {
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("orderId", orderId);
      formData.set("receipt", file);
      const result = await uploadTransferReceiptAction(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      onUploaded();
    } catch {
      setError("No pudimos subir el comprobante. Probá de nuevo.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="border-b border-neutral-100 pb-4">
        <p className="text-sm text-neutral-500">Pedido #{orderNumber}</p>
        <p className="text-2xl font-bold">$ {total.toLocaleString("es-AR")}</p>
      </div>

      <div
        className={`rounded-md border p-3 text-sm ${
          expired
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-amber-200 bg-amber-50 text-amber-800"
        }`}
      >
        {expired ? (
          <>
            Se venció el tiempo para pagar este pedido. Si ya transferiste, subí el comprobante
            igual: lo vamos a revisar a mano antes de cancelar nada.
          </>
        ) : (
          <>
            Tenés <span className="font-bold tabular-nums">{formatRemaining(remainingMs)}</span> para
            transferir y subir el comprobante. Después de ese plazo el stock reservado se libera.
          </>
        )}
      </div>

      <div className="rounded-md border border-neutral-200 divide-y divide-neutral-100 text-sm">
        <DataRow label="Monto exacto" value={`$ ${total.toLocaleString("es-AR")}`} emphasis />
        <DataRow label="Referencia" value={reference} emphasis />
        {bank.alias && <DataRow label="Alias" value={bank.alias} />}
        {bank.cbu && <DataRow label="CBU" value={bank.cbu} />}
        {bank.accountHolder && <DataRow label="Titular" value={bank.accountHolder} />}
        {bank.bankName && <DataRow label="Banco" value={bank.bankName} />}
      </div>

      <p className="text-xs text-neutral-500">
        Poné <span className="font-medium">{reference}</span> en el concepto o referencia de la
        transferencia — nos ayuda a encontrar tu pago más rápido. Si tu banco no te deja poner un
        concepto, no hay problema: lo identificamos por el monto y la hora.
      </p>

      <div className="border-t border-neutral-100 pt-4">
        <p className="text-sm font-medium mb-1">Subí el comprobante</p>
        <p className="text-xs text-neutral-500 mb-3">{describeReceiptLimits()}</p>

        <input
          ref={inputRef}
          type="file"
          accept={RECEIPT_ACCEPT_ATTRIBUTE}
          onChange={handleFileChange}
          disabled={uploading}
          className="w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-2 file:text-sm file:text-white disabled:opacity-50"
        />

        {error && (
          <div className="mt-3 rounded-md bg-red-50 border border-red-200 text-red-700 text-sm p-3">
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!file || uploading}
          className="mt-4 w-full bg-neutral-900 text-white rounded-md py-3 text-sm font-medium hover:bg-neutral-800 disabled:opacity-50"
        >
          {uploading ? "Subiendo comprobante..." : "Ya transferí, enviar comprobante"}
        </button>
      </div>
    </div>
  );
}

function DataRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <span className="text-neutral-500">{label}</span>
      <span className={emphasis ? "font-bold tabular-nums" : "font-medium text-right break-all"}>
        {value}
      </span>
    </div>
  );
}

function msUntil(deadlineIso: string): number {
  return new Date(deadlineIso).getTime() - Date.now();
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
