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
    return <p className="text-xs text-neutral-400 text-right">Archivo eliminado</p>;
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
              className="text-xs bg-neutral-900 text-white rounded-md px-3 py-1.5"
            >
              Abrir comprobante
            </a>
          ) : (
            <button
              type="button"
              onClick={handleView}
              disabled={pending}
              className="text-xs border border-neutral-300 rounded-md px-3 py-1.5 hover:bg-neutral-50 disabled:opacity-50"
            >
              {pending ? "Generando link..." : "Ver comprobante"}
            </button>
          )}

          {canDelete && !reviewPending && (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="text-xs text-red-600 border border-red-200 rounded-md px-3 py-1.5 hover:bg-red-50"
            >
              Eliminar
            </button>
          )}
        </div>
      )}

      {signedUrl && !confirmingDelete && (
        <p className="text-[10px] text-neutral-400">El link vence en 5 minutos.</p>
      )}

      {confirmingDelete && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-left max-w-[300px]">
          <p className="text-xs text-neutral-700 mb-2">
            Se borra el archivo del comprobante
            {orderNumber ? ` del pedido #${orderNumber}` : ""}. Queda el registro de que existió y
            de quién lo eliminó, pero el archivo no se puede recuperar.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="text-xs bg-red-600 text-white rounded-md px-3 py-1.5 disabled:opacity-50"
            >
              {pending ? "Eliminando..." : "Sí, eliminar"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={pending}
              className="text-xs text-neutral-500 px-2 hover:underline disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-[10px] text-red-600 max-w-[300px] text-right">{error}</p>}
    </div>
  );
}
