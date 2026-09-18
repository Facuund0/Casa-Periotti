"use client";

import { useState } from "react";
import {
  listPointDevicesAction,
  setPointModeAction,
  type PointDeviceOption,
} from "@/modules/pos/point-actions";
import { savePointSettingsAction } from "@/modules/payments/admin-actions";

/**
 * Configuración de la terminal Point: buscar los equipos de la cuenta,
 * ponerlos en modo integrado y elegir cuál usa el mostrador.
 *
 * Mientras no haya una terminal elegida y activada, el medio de pago no
 * aparece en la venta de mostrador: todo sigue como antes.
 */
export function PointSettings({
  enabled,
  deviceId,
}: {
  enabled: boolean;
  deviceId: string | null;
}) {
  const [devices, setDevices] = useState<PointDeviceOption[] | null>(null);
  const [selected, setSelected] = useState(deviceId ?? "");
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [loading, setLoading] = useState<"buscar" | "modo" | "guardar" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function buscar() {
    setLoading("buscar");
    setError(null);
    setNote(null);
    const res = await listPointDevicesAction();
    setLoading(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    setDevices(res.devices ?? []);
    if (!res.devices?.length) {
      setNote(
        "La cuenta de Mercado Pago no tiene ninguna terminal Point. Revisá que el equipo esté encendido y con la sesión iniciada."
      );
    }
  }

  async function ponerEnModoIntegrado(id: string) {
    setLoading("modo");
    setError(null);
    setNote(null);
    const res = await setPointModeAction(id, "PDV");
    setLoading(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    setNote("La terminal quedó en modo integrado.");
    await buscar();
  }

  async function guardar() {
    setLoading("guardar");
    setError(null);
    setNote(null);
    const res = await savePointSettingsAction({
      enabled: isEnabled,
      deviceId: selected.trim() || null,
    });
    setLoading(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    setNote(
      isEnabled && selected.trim()
        ? "Listo. En la venta de mostrador ya aparece “Tarjeta con la terminal Point”."
        : "Guardado. El cobro con Point queda apagado."
    );
  }

  const elegida = devices?.find((d) => d.id === selected);

  return (
    <div className="neu-card mt-8 max-w-xl p-4">
      <p className="text-sm font-medium text-ink">Cobro con la terminal Point</p>
      <p className="mt-1 text-xs text-ink-muted">
        Con esto, al confirmar una venta de mostrador el monto aparece solo en la terminal: no hay
        que tipearlo. El cliente elige débito, crédito o cuotas en el equipo y la venta se registra
        cuando el cobro se aprueba.
      </p>

      <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-ink-muted">
        <li>Prendé la terminal y asegurate de que esté con la sesión de tu cuenta iniciada.</li>
        <li>Buscá los equipos acá abajo y elegí el del mostrador.</li>
        <li>
          Ponelo en <strong>modo integrado</strong>: es lo que hace que acepte los montos que le
          manda el sistema. En ese modo no se cobra tipeando en el equipo.
        </li>
        <li>Activá el cobro y guardá.</li>
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={buscar}
          disabled={loading !== null}
          className="neu-btn !px-3 !py-2 !text-xs"
        >
          {loading === "buscar" ? "Buscando…" : "Buscar terminales"}
        </button>
        {devices && (
          <span className="text-xs text-ink-subtle">
            {devices.length} {devices.length === 1 ? "terminal encontrada" : "terminales encontradas"}
          </span>
        )}
      </div>

      {devices && devices.length > 0 && (
        <div className="neu-inset mt-3 divide-y divide-[color:var(--hairline)]">
          {devices.map((device) => (
            <label
              key={device.id}
              className="flex cursor-pointer items-center gap-3 p-2 text-xs text-ink"
            >
              <input
                type="radio"
                name="pointDevice"
                value={device.id}
                checked={selected === device.id}
                onChange={() => setSelected(device.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-mono">{device.id}</span>
                <span
                  className={
                    device.operatingMode === "PDV" ? "text-success" : "text-warning"
                  }
                >
                  {device.operatingMode === "PDV"
                    ? "Modo integrado (lista para cobrar desde el sistema)"
                    : "Modo autónomo (hay que ponerla en integrado)"}
                </span>
              </span>
              {device.operatingMode !== "PDV" && (
                <button
                  type="button"
                  onClick={() => ponerEnModoIntegrado(device.id)}
                  disabled={loading !== null}
                  className="neu-btn !px-2 !py-1 !text-[11px]"
                >
                  {loading === "modo" ? "…" : "Poner en integrado"}
                </button>
              )}
            </label>
          ))}
        </div>
      )}

      <label className="mt-4 block text-xs text-ink-muted">
        <span className="mb-1 block">ID de la terminal</span>
        <input
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          placeholder="Ej: PAX_A910__SMARTPOS1234567890"
          className="neu-input !px-2 !py-1.5 !text-xs"
        />
      </label>

      <label className="mt-3 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={(e) => setIsEnabled(e.target.checked)}
        />
        Ofrecer el cobro con la terminal en la venta de mostrador
      </label>

      {isEnabled && elegida && elegida.operatingMode !== "PDV" && (
        <p className="mt-2 text-xs text-warning">
          Esa terminal todavía está en modo autónomo: ponela en integrado o el cobro va a fallar.
        </p>
      )}

      <button
        type="button"
        onClick={guardar}
        disabled={loading !== null}
        className="neu-btn neu-btn-primary mt-3 !px-4 !py-2 !text-xs"
      >
        {loading === "guardar" ? "Guardando…" : "Guardar"}
      </button>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      {note && <p className="mt-2 text-xs text-success">{note}</p>}

      <p className="mt-3 text-[11px] text-ink-subtle">
        Usa la misma cuenta de Mercado Pago que el resto del sistema. Si apagás esto, el medio de
        pago desaparece del mostrador y el cobro con tarjeta vuelve a tipearse en la terminal.
      </p>
    </div>
  );
}
