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
      <div className="pb-4">
        <p className="text-sm text-ink-muted">Pedido #{orderNumber}</p>
        <p className="text-2xl font-bold text-ink">$ {total.toLocaleString("es-AR")}</p>
      </div>

      <div
        className={`rounded-neu p-3 text-sm ${
          expired ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning"
        }`}
      >
        {expired ? (
          <>
            Se venció el tiempo para pagar este pedido. Si ya transferiste, subí el comprobante
            igual: lo vamos a revisar a mano antes de cancelar nada.
          </>
        ) : (
          <>
            Tenés <span className="font-bold tabular-nums text-ink">{formatRemaining(remainingMs)}</span> para
            transferir y subir el comprobante. Después de ese plazo el stock reservado se libera.
          </>
        )}
      </div>

      <div className="neu-inset p-1.5 text-sm">
        <DataRow label="Monto exacto" value={`$ ${total.toLocaleString("es-AR")}`} emphasis />
        <DataRow label="Referencia" value={reference} emphasis />
        {bank.alias && <DataRow label="Alias" value={bank.alias} />}
        {bank.cbu && <DataRow label="CBU" value={bank.cbu} />}
        {bank.accountHolder && <DataRow label="Titular" value={bank.accountHolder} />}
        {bank.bankName && <DataRow label="Banco" value={bank.bankName} />}
      </div>

      <p className="text-xs text-ink-muted">
        Poné <span className="font-medium">{reference}</span> en el concepto o referencia de la
        transferencia — nos ayuda a encontrar tu pago más rápido. Si tu banco no te deja poner un
        concepto, no hay problema: lo identificamos por el monto y la hora.
      </p>

      <div className="mt-4">
        <p className="mb-1 text-sm font-medium text-ink">Subí el comprobante</p>
        <p className="mb-3 text-xs text-ink-muted">{describeReceiptLimits()}</p>

        <input
          ref={inputRef}
          type="file"
          accept={RECEIPT_ACCEPT_ATTRIBUTE}
          onChange={handleFileChange}
          disabled={uploading}
          className="w-full text-sm text-ink-muted file:mr-3 file:cursor-pointer file:rounded-neu file:border-0 file:bg-brand file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink-on-brand disabled:opacity-50"
        />

        {error && (
          <div className="mt-3 rounded-neu bg-danger-soft p-3 text-sm font-medium text-danger">
            {error}
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={!file || uploading}
          className="neu-btn neu-btn-primary mt-4 w-full !py-3"
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
      <span className="text-ink-muted">{label}</span>
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
