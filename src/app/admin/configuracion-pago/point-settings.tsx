"use client";

import { useState } from "react";
import {
  checkPointCredentialAction,
  diagnosePointAction,
  listPointDevicesAction,
  resolveStalePointChargesAction,
  setPointModeAction,
  type PointDeviceOption,
} from "@/modules/pos/point-actions";
import type { PointProbe } from "@/modules/pos/point-client";
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
  const [account, setAccount] = useState<{
    nickname: string | null;
    email: string | null;
    isTest: boolean;
  } | null>(null);
  const [probes, setProbes] = useState<PointProbe[] | null>(null);
  const [selected, setSelected] = useState(deviceId ?? "");
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [loading, setLoading] = useState<
    "buscar" | "modo" | "guardar" | "credencial" | "diagnostico" | "colgados" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function verCredencial() {
    setLoading("credencial");
    setError(null);
    setNote(null);
    const res = await checkPointCredentialAction();
    setLoading(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    setAccount(res.account ?? null);
  }

  async function diagnosticar() {
    setLoading("diagnostico");
    setError(null);
    setNote(null);
    const res = await diagnosePointAction();
    setLoading(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    setProbes(res.probes ?? null);
  }

  async function resolverColgados() {
    setLoading("colgados");
    setError(null);
    setNote(null);
    const res = await resolveStalePointChargesAction();
    setLoading(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    const r = res.result;
    setNote(
      !r || r.checked === 0
        ? "No había ningún cobro abierto."
        : `${r.checked} cobro(s) revisado(s): ${r.settled} estaban cobrados y se confirmaron, ${r.released} se cerraron y devolvieron el stock${r.failed ? `, ${r.failed} no se pudieron resolver` : ""}.`
    );
  }

  async function buscar() {
    setLoading("buscar");
    setError(null);
    setNote(null);
    // De paso se deja a la vista de qué cuenta es la credencial: si la
    // búsqueda falla por permisos, esa es casi siempre la razón.
    const cred = await checkPointCredentialAction();
    if (cred.account) setAccount(cred.account);

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

      <p className="neu-inset mt-3 p-2 text-xs text-ink-muted">
        <span className="font-medium text-ink">Si el monto no aparece en la terminal:</span> casi
        siempre es que el equipo está en <strong>modo autónomo</strong>. En ese modo Mercado Pago
        acepta el cobro pero no se lo manda al equipo. Revisá abajo que diga &quot;modo
        integrado&quot;, y si lo acabás de cambiar, reiniciá la terminal.
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
        <button
          type="button"
          onClick={verCredencial}
          disabled={loading !== null}
          className="neu-btn !px-3 !py-2 !text-xs"
        >
          {loading === "credencial" ? "Verificando…" : "Ver qué cuenta está conectada"}
        </button>
        <button
          type="button"
          onClick={diagnosticar}
          disabled={loading !== null}
          className="neu-btn !px-3 !py-2 !text-xs"
        >
          {loading === "diagnostico" ? "Probando…" : "Diagnóstico de permisos"}
        </button>
        <button
          type="button"
          onClick={resolverColgados}
          disabled={loading !== null}
          className="neu-btn !px-3 !py-2 !text-xs"
        >
          {loading === "colgados" ? "Resolviendo…" : "Cerrar cobros que quedaron abiertos"}
        </button>
        {devices && (
          <span className="text-xs text-ink-subtle">
            {devices.length} {devices.length === 1 ? "terminal encontrada" : "terminales encontradas"}
          </span>
        )}
      </div>

      {account && (
        <div className="neu-inset mt-3 p-3 text-xs">
          <p className="text-ink">
            La credencial cargada es de la cuenta{" "}
            <span className="font-medium">{account.nickname ?? account.email ?? "sin nombre"}</span>
            {account.email && account.nickname ? ` (${account.email})` : ""}.
          </p>
          {account.isTest ? (
            <p className="mt-1 font-medium text-warning">
              Es una cuenta de PRUEBA de Mercado Pago. Las cuentas de prueba no tienen terminales
              reales: hay que cargar el Access Token de producción de la cuenta dueña del equipo.
            </p>
          ) : (
            <p className="mt-1 text-ink-muted">
              Es una cuenta real. Tiene que ser la misma donde está registrada la terminal: si no,
              Mercado Pago responde 403 aunque la credencial sea válida.
            </p>
          )}
        </div>
      )}

      {error?.includes("403") && (
        <div className="neu-inset mt-3 p-3 text-xs">
          <p className="font-medium text-ink">Qué significa ese 403</p>
          <p className="mt-1 text-ink-muted">
            La credencial es válida —si no, el error sería 401— pero Mercado Pago no le da permiso
            sobre las terminales. Las causas, de más a menos común:
          </p>
          <ol className="mt-1 list-decimal space-y-1 pl-4 text-ink-muted">
            <li>
              La aplicación se creó en <strong>otra cuenta</strong> de Mercado Pago que la dueña del
              equipo. Hay que crearla entrando a Developers con la cuenta donde está la terminal y
              usar el Access Token de esa aplicación.
            </li>
            <li>
              Se copió el Access Token de <strong>prueba</strong> en vez del de producción (están en
              pestañas distintas, dentro de la misma aplicación).
            </li>
            <li>
              La cuenta todavía no tiene habilitado el uso de la API de Point. Eso se pide al
              soporte de Mercado Pago desde esa cuenta.
            </li>
          </ol>
        </div>
      )}

      {probes && (
        <div className="neu-inset mt-3 p-3 text-xs">
          <p className="font-medium text-ink">Qué contesta Mercado Pago en cada puerta</p>
          <ul className="mt-2 space-y-2">
            {probes.map((probe) => (
              <li key={probe.url}>
                <p
                  className={
                    probe.ok
                      ? "text-success"
                      : probe.informational
                        ? "text-ink-subtle"
                        : "text-danger"
                  }
                >
                  {probe.ok ? "OK" : probe.informational ? "No se usa" : "BLOQUEADO"} ·{" "}
                  {probe.status} — {probe.name}
                </p>
                <p className="break-all font-mono text-[10px] text-ink-subtle">{probe.url}</p>
                {/* El cuerpo del error solo si es una puerta que importa:
                    de la que no se usa, no aporta nada. */}
                {!probe.ok && !probe.informational && (
                  <p className="break-all font-mono text-[10px] text-ink-muted">{probe.body}</p>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-ink-muted">
            Lo que tiene que dar OK es <strong>Terminales Point</strong>: es la que usa el sistema
            para cobrar. La última es una API vieja de Mercado Pago que quedó sin uso, y que dé 403
            ahí es normal.
          </p>
          <p className="mt-1 text-ink-muted">
            Si <strong>Terminales Point</strong> diera 403, la credencial está bien pero falta que
            Mercado Pago habilite la API de Point en esa cuenta: este listado es lo que hay que
            mandarle al soporte.
          </p>
        </div>
      )}

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
