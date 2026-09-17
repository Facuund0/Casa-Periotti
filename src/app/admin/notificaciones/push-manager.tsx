"use client";

import { useEffect, useState } from "react";
import {
  subscribeToPushAction,
  unsubscribeFromPushAction,
  type PushActionResult,
} from "@/modules/notifications/actions";
import { formatDateTimeAR } from "@/shared/utils/argentina-time";

export interface PushDevice {
  endpoint: string;
  userAgent: string | null;
  createdAt: string;
  lastSuccessAt: string | null;
}

type State = "cargando" | "no-soportado" | "bloqueado" | "activo" | "inactivo";

/**
 * Activa o desactiva las notificaciones en ESTE dispositivo, y lista los
 * demás dispositivos del empleado para poder darlos de baja.
 *
 * El estado se decide en el navegador (permiso + suscripción del service
 * worker), así que se calcula después del montaje, no en el servidor.
 */
export function PushManager({
  publicKey,
  devices,
  configured,
}: {
  publicKey: string;
  devices: PushDevice[];
  configured: boolean;
}) {
  const [state, setState] = useState<State>("cargando");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [result, setResult] = useState<PushActionResult | null>(null);
  const [working, setWorking] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [standalone, setStandalone] = useState(true);

  useEffect(() => {
    const ua = navigator.userAgent;
    const iosDevice = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    setIsIos(iosDevice);
    setStandalone(installed);

    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("no-soportado");
      return;
    }
    if (Notification.permission === "denied") {
      setState("bloqueado");
      return;
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => {
        setEndpoint(subscription?.endpoint ?? null);
        setState(subscription ? "activo" : "inactivo");
      })
      .catch(() => setState("no-soportado"));
  }, []);

  async function activate() {
    setWorking(true);
    setResult(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "bloqueado" : "inactivo");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      const res = await subscribeToPushAction(subscription.toJSON(), navigator.userAgent);
      setResult(res);
      if (res.ok) {
        setEndpoint(subscription.endpoint);
        setState("activo");
      }
    } catch (err) {
      console.error(err);
      setResult({ error: "El navegador no pudo activar las notificaciones. Probá de nuevo." });
    } finally {
      setWorking(false);
    }
  }

  async function deactivate() {
    setWorking(true);
    setResult(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      const current = subscription?.endpoint ?? endpoint;
      await subscription?.unsubscribe();
      if (current) setResult(await unsubscribeFromPushAction(current));
      setEndpoint(null);
      setState("inactivo");
    } finally {
      setWorking(false);
    }
  }

  async function removeDevice(deviceEndpoint: string) {
    setWorking(true);
    setResult(await unsubscribeFromPushAction(deviceEndpoint));
    if (deviceEndpoint === endpoint) {
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      const subscription = await registration?.pushManager.getSubscription();
      await subscription?.unsubscribe();
      setEndpoint(null);
      setState("inactivo");
    }
    setWorking(false);
  }

  if (!configured) {
    return (
      <div className="rounded-neu bg-warning-soft p-4 text-sm text-warning">
        <p className="font-semibold">Faltan las claves para enviar notificaciones</p>
        <p className="mt-1">
          Un super_admin tiene que cargar en Vercel las variables{" "}
          <code>NEXT_PUBLIC_VAPID_PUBLIC_KEY</code>, <code>VAPID_PRIVATE_KEY</code> y{" "}
          <code>VAPID_SUBJECT</code>. Hasta entonces no se pueden activar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {result?.error && (
        <div className="rounded-neu bg-danger-soft p-3 text-sm font-medium text-danger" role="alert">
          {result.error}
        </div>
      )}

      {/* iOS solo entrega avisos si el sitio está agregado a la pantalla de inicio. */}
      {isIos && !standalone && (
        <div className="rounded-neu bg-info-soft p-4 text-sm text-info">
          <p className="font-semibold">En iPhone hay un paso más</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>Abrí este panel en Safari.</li>
            <li>
              Tocá el botón <strong>Compartir</strong> (el cuadrado con la flecha hacia arriba).
            </li>
            <li>
              Elegí <strong>Agregar a inicio</strong>.
            </li>
            <li>Abrí Casa Periotti desde el icono nuevo y activá las notificaciones ahí.</li>
          </ol>
          <p className="mt-2">Sin este paso, Apple no entrega notificaciones web.</p>
        </div>
      )}

      <div className="neu-card p-4">
        {state === "cargando" && <p className="text-sm text-ink-muted">Revisando este dispositivo…</p>}

        {state === "no-soportado" && (
          <p className="text-sm text-ink-muted">
            Este navegador no soporta notificaciones push. Probá con Chrome en Android o computadora,
            o con Safari en iPhone agregando el sitio a la pantalla de inicio.
          </p>
        )}

        {state === "bloqueado" && (
          <div className="text-sm text-ink-muted">
            <p className="font-semibold text-danger">Las notificaciones están bloqueadas</p>
            <p className="mt-1">
              Las bloqueaste para este sitio. Habilitalas desde el candado de la barra de direcciones
              (Notificaciones → Permitir) y volvé a esta pantalla.
            </p>
          </div>
        )}

        {state === "activo" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-success">
                <span className="neu-badge bg-success-soft text-success">Activadas</span>
                en este dispositivo
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                Vas a recibir los avisos que correspondan a tu rol, aunque tengas el panel cerrado.
              </p>
            </div>
            <button onClick={deactivate} disabled={working} className="neu-btn !text-xs">
              {working ? "Desactivando…" : "Desactivar acá"}
            </button>
          </div>
        )}

        {state === "inactivo" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">Desactivadas en este dispositivo</p>
              <p className="mt-1 text-xs text-ink-muted">
                Al activarlas, el navegador te va a pedir permiso una sola vez.
              </p>
            </div>
            <button onClick={activate} disabled={working} className="neu-btn neu-btn-primary !text-xs">
              {working ? "Activando…" : "Activar notificaciones"}
            </button>
          </div>
        )}
      </div>

      {devices.length > 0 && (
        <div className="neu-card">
          <p className="border-b border-[color:var(--hairline)] p-4 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
            Tus dispositivos con notificaciones
          </p>
          {devices.map((device) => (
            <div
              key={device.endpoint}
              className="neu-row flex flex-wrap items-center justify-between gap-3 p-4 text-xs"
            >
              <div className="min-w-0">
                <p className="text-sm text-ink">
                  {describeDevice(device.userAgent)}
                  {device.endpoint === endpoint && (
                    <span className="neu-badge ml-2 bg-info-soft text-info">Este</span>
                  )}
                </p>
                <p className="mt-0.5 text-ink-muted">
                  Activado: {formatDateTimeAR(device.createdAt)}
                  {device.lastSuccessAt ? ` · Último aviso: ${formatDateTimeAR(device.lastSuccessAt)}` : ""}
                </p>
              </div>
              <button
                onClick={() => removeDevice(device.endpoint)}
                disabled={working}
                className="text-danger hover:underline"
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Nombre corto del dispositivo, para reconocerlo en la lista. */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Dispositivo";
  const ua = userAgent.toLowerCase();
  const system = /iphone|ipad/.test(ua)
    ? "iPhone o iPad"
    : ua.includes("android")
      ? "Android"
      : ua.includes("windows")
        ? "Windows"
        : ua.includes("mac")
          ? "Mac"
          : "Dispositivo";
  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("chrome")
      ? "Chrome"
      : ua.includes("firefox")
        ? "Firefox"
        : ua.includes("safari")
          ? "Safari"
          : "navegador";
  return `${system} · ${browser}`;
}

/** La clave VAPID viaja en base64url y el navegador la pide como bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64Safe);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}
