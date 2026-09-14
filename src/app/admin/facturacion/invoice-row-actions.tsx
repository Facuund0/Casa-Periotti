"use client";

import { useState, useTransition } from "react";
import {
  getInvoicePdfUrlAction,
  resendInvoiceEmailAction,
} from "@/modules/billing/admin-actions";

/**
 * Acciones de una factura autorizada: imprimir/descargar el PDF y
 * reenviarlo por email.
 *
 * El PDF no es un link directo porque el bucket es privado: la URL
 * firmada se pide al servidor en el momento (y si el PDF todavía no
 * existe, se genera ahí). No se usa window.open() porque abrir una
 * ventana después de un await lo bloquea el navegador — por eso queda
 * un link listo para hacer clic.
 */
export function InvoiceRowActions({
  invoiceId,
  canPrint,
}: {
  invoiceId: string;
  canPrint: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (!canPrint) {
    return <span className="text-[10px] text-neutral-400">Sin CAE</span>;
  }

  function handlePdf() {
    setError(null);
    startTransition(async () => {
      const res = await getInvoicePdfUrlAction(invoiceId);
      if (res.error) setError(res.error);
      else setPdfUrl(res.url ?? null);
    });
  }

  function handleResend() {
    setError(null);
    startTransition(async () => {
      const res = await resendInvoiceEmailAction(invoiceId, email);
      if (res.error) {
        setError(res.error);
      } else {
        setSentTo(res.sentTo ?? "el email del cliente");
        setResending(false);
        setEmail("");
      }
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5 justify-end flex-wrap">
        {pdfUrl ? (
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] bg-neutral-900 text-white rounded-md px-2.5 py-1"
          >
            Abrir e imprimir
          </a>
        ) : (
          <button
            type="button"
            onClick={handlePdf}
            disabled={pending}
            className="text-[11px] border border-neutral-300 rounded-md px-2.5 py-1 hover:bg-neutral-50 disabled:opacity-50"
          >
            {pending ? "Generando..." : "Imprimir"}
          </button>
        )}

        {!resending && (
          <button
            type="button"
            onClick={() => setResending(true)}
            className="text-[11px] border border-neutral-300 rounded-md px-2.5 py-1 hover:bg-neutral-50"
          >
            Reenviar
          </button>
        )}
      </div>

      {pdfUrl && <p className="text-[10px] text-neutral-400">El link vence en 5 minutos.</p>}

      {resending && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-2 text-left w-[240px]">
          <p className="text-[10px] text-neutral-600 mb-1.5">
            Se manda con el PDF adjunto. Dejalo vacío para usar el email del cliente.
          </p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="otro@email.com (opcional)"
            className="w-full border border-neutral-300 rounded-md px-2 py-1 text-[11px] mb-1.5"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleResend}
              disabled={pending}
              className="text-[11px] bg-neutral-900 text-white rounded-md px-2.5 py-1 disabled:opacity-50"
            >
              {pending ? "Enviando..." : "Enviar"}
            </button>
            <button
              type="button"
              onClick={() => setResending(false)}
              disabled={pending}
              className="text-[11px] text-neutral-500 px-1 hover:underline disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {sentTo && <p className="text-[10px] text-green-700">Enviada a {sentTo}.</p>}
      {error && <p className="text-[10px] text-red-600 max-w-[240px]">{error}</p>}
    </div>
  );
}
