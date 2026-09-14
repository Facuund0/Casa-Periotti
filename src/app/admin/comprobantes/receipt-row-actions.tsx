"use client";

import { useState, useTransition } from "react";
import { getReceiptSignedUrlAction, purgeReceiptAction } from "@/modules/payments/admin-actions";

/**
 * Acciones de una fila de /admin/comprobantes: ver el archivo y
 * eliminarlo.
 *
 * "Ver comprobante" no es un link directo: el bucket es privado, así que
 * la URL firmada se pide al servidor en el momento y se muestra como un
 * link de vida corta. No se usa window.open() porque abrir una ventana
 * después de un await lo bloquea el navegador.
 *
 * "Eliminar" pide confirmación explícita y aclara qué se borra y qué
 * queda: el archivo se va del bucket, el registro del comprobante no.
 */
export function ReceiptRowActions({
  receiptId,
  orderNumber,
  canDelete,
  purged,
  reviewPending,
}: {
  receiptId: string;
  orderNumber: number | null;
  canDelete: boolean;
  purged: boolean;
  reviewPending: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);

  function handleView() {
    setError(null);
    startTransition(async () => {
      const res = await getReceiptSignedUrlAction(receiptId);
      if (res.error) setError(res.error);
      else setSignedUrl(res.url ?? null);
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const res = await purgeReceiptAction(receiptId);
      if (res.error) {
        setError(res.error);
      } else {
        setDeleted(true);
        setConfirmingDelete(false);
        setSignedUrl(null);
      }
    });
  }

  if (purged || deleted) {
    return <p className="text-xs text-ink-subtle text-right">Archivo eliminado</p>;
  }

  return (
    <div className="text-right space-y-1.5">
      {!confirmingDelete && (
        <div className="flex gap-2 justify-end">
          {signedUrl ? (
            <a
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              className="neu-btn neu-btn-primary !px-3 !py-1.5 !text-xs"
            >
              Abrir comprobante
            </a>
          ) : (
            <button
              type="button"
              onClick={handleView}
              disabled={pending}
              className="neu-btn !px-3 !py-1.5 !text-xs"
            >
              {pending ? "Generando link..." : "Ver comprobante"}
            </button>
          )}

          {canDelete && !reviewPending && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="neu-btn neu-btn-danger !px-3 !py-1.5 !text-xs"
            >
              Eliminar
            </button>
          )}
        </div>
      )}

      {signedUrl && !confirmingDelete && (
        <p className="text-[10px] text-ink-subtle">El link vence en 5 minutos.</p>
      )}

      {confirmingDelete && (
        <div className="neu-inset max-w-[300px] p-3 text-left">
          <p className="text-xs text-ink mb-2">
            Se borra el archivo del comprobante
            {orderNumber ? ` del pedido #${orderNumber}` : ""}. Queda el registro de que existió y
            de quién lo eliminó, pero el archivo no se puede recuperar.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="neu-btn neu-btn-danger !px-3 !py-1.5 !text-xs"
            >
              {pending ? "Eliminando..." : "Sí, eliminar"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={pending}
              className="text-xs text-ink-muted px-2 hover:underline disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[10px] text-danger max-w-[300px] text-right">{error}</p>}
    </div>
  );
}
