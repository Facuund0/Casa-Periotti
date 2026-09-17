"use client";

import { useEffect, useState } from "react";
import {
  sendTestPushAction,
  subscribeToPushAction,
  unsubscribeFromPushAction,
  type PushActionResult,
} from "@/modules/notifications/actions";
import { formatDateTimeAR } from "@/shared/utils/argentina-time";

export interface PushDevice {
  endpoint: string;
  userAgent: string | null;
  origin: string | null;
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
  productionHost,
  audience = "empleado",
}: {
  publicKey: string;
  devices: PushDevice[];
  configured: boolean;
  /** Dominio del sitio real: desde un preview los avisos salen con los datos de ese preview. */
  productionHost: string;
  /** Cambia los textos: el empleado recibe avisos del panel; el cliente, de sus pedidos. */
  audience?: "empleado" | "cliente";
}) {
  const [state, setState] = useState<State>("cargando");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [result, setResult] = useState<PushActionResult | null>(null);
  const [working, setWorking] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [standalone, setStandalone] = useState(true);
  const [wrongHost, setWrongHost] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    const iosDevice = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    setIsIos(iosDevice);
    setStandalone(installed);
    // Una suscripción hecha en un preview queda atada a ESE deploy: los
    // avisos salen con su icono y sus links, no con los del sitio real.
    const host = window.location.host;
    const isLocal = host.startsWith("localhost") || host.startsWith("127.0.0.1");
    setWrongHost(!isLocal && productionHost && host !== productionHost ? host : null);

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
  }, [productionHost]);

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
      const res = await subscribeToPushAction(
        subscription.toJSON(),
        navigator.userAgent,
        window.location.origin
      );
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
          {audience === "empleado"
            ? "Un super_admin tiene que cargar en Vercel las variables NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT. Hasta entonces no se pueden activar."
            : "Todavía no están disponibles. Escribinos si querés que te avisemos por otro medio."}
        </p>
      </div>
    );
  }

  async function test() {
    setWorking(true);
    setResult(null);
    setNotice(null);
    const res = await sendTestPushAction();
    if (res.error) setResult(res);
    else setNotice("Aviso de prueba enviado. Tendría que aparecer en un segundo.");
    setWorking(false);
  }

  return (
    <div className="space-y-4">
      {/* Un preview de Vercel tiene su propio icono y sus propios links. */}
      {wrongHost && (
        <div className="rounded-neu bg-warning-soft p-4 text-sm text-warning" role="alert">
          <p className="font-semibold">Estás en una dirección de prueba</p>
          <p className="mt-1">
            Esta copia ({wrongHost}) es un preview: los avisos que active acá van a salir con el
            icono y los links de esta copia, no del sitio real. Activalas en{" "}
            <a href={`https://${productionHost}/admin/notificaciones`} className="font-semibold underline">
              {productionHost}
            </a>
            .
          </p>
        </div>
      )}

      {notice && (
        <div className="rounded-neu bg-success-soft p-3 text-sm font-medium text-success" role="status">
          {notice}
        </div>
      )}

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
            <li>Abrí {audience === "empleado" ? "este panel" : "esta página"} en Safari.</li>
            <li>
              Tocá el botón <strong>Compartir</strong> (el cuadrado con la flecha hacia arriba).
            </li>
            <li>
              Elegí <strong>Agregar a inicio</strong>.
            </li>
            <li>Abrí Casa Periotti desde el icono nuevo y activá las notificaciones ahí.</li>
          </ol>
          <p className="mt-2">
            Sin este paso, Apple no entrega notificaciones web. Si ya lo hiciste y no llegan,
            revisá Ajustes → Notificaciones → Casa Periotti → <strong>Permitir notificaciones</strong>.
          </p>
        </div>
      )}

      {/* Android: si el navegador no está instalado como app, o el sistema
          lo "optimiza", deja de despertarlo y los avisos no llegan con la
          app cerrada. */}
      {!isIos && !standalone && state === "activo" && (
        <div className="rounded-neu bg-info-soft p-4 text-sm text-info">
          <p className="font-semibold">¿No te llegan con el navegador cerrado?</p>
          <p className="mt-1">En el celular, dos cosas lo resuelven:</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              <strong>Instalá {audience === "empleado" ? "el panel" : "el sitio"} como app:</strong>{" "}
              menú de Chrome (⋮) →{" "}
              <strong>Agregar a pantalla principal</strong> o <strong>Instalar app</strong>, y usalo
              desde ese icono.
            </li>
            <li>
              <strong>Sacale la restricción de batería:</strong> Ajustes → Aplicaciones → Chrome (o
              Casa Periotti) → Batería → <strong>Sin restricciones</strong>. Con el ahorro de batería
              activado, Android no despierta la app y los avisos llegan tarde o no llegan.
            </li>
            <li>
              <strong>Permitile los avisos a este sitio en Chrome:</strong> tocá el candado (o el ⋮)
              al lado de la dirección → <strong>Permisos</strong> o{" "}
              <strong>Configuración del sitio</strong> → <strong>Notificaciones</strong> →{" "}
              <strong>Permitir</strong>. Chrome a veces las silencia solo, sin avisar, cuando no
              reconoce el sitio o considera que manda muchos avisos.
            </li>
            <li>
              <strong>Y que Android deje pasar los avisos de la app:</strong> Ajustes →
              Aplicaciones → Chrome (o Casa Periotti, si la instalaste) →{" "}
              <strong>Notificaciones</strong> → activadas. Fijate también que esté activada la
              categoría del sitio: Android las agrupa por sitio y puede tener apagada solo esa.
            </li>
          </ol>
          <p className="mt-2">
            Tampoco cierres el navegador desde la lista de apps recientes: algunos celulares dejan de
            recibir avisos hasta volver a abrirlo.
          </p>
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
              Están bloqueadas para este sitio. A veces las bloqueás sin querer al descartar el
              cartel del navegador, y a veces las bloquea Chrome solo cuando no reconoce el sitio.
            </p>
            <p className="mt-1">
              Habilitalas desde el candado (o el ⋮) al lado de la dirección →{" "}
              <strong>Permisos</strong> o <strong>Configuración del sitio</strong> →{" "}
              <strong>Notificaciones</strong> → <strong>Permitir</strong>, y volvé a esta pantalla.
              En el celular, revisá además que la app tenga permitidas las notificaciones en los
              ajustes de Android o de iOS.
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
                {audience === "empleado"
                  ? "Vas a recibir los avisos que correspondan a tu rol, aunque tengas el panel cerrado."
                  : "Te vamos a avisar cuando confirmemos el pago de un pedido tuyo, o si no pudimos verificarlo."}
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={test} disabled={working} className="neu-btn neu-btn-primary !text-xs">
                {working ? "Enviando…" : "Probar aviso"}
              </button>
              <button onClick={deactivate} disabled={working} className="neu-btn !text-xs">
                {working ? "Desactivando…" : "Desactivar acá"}
              </button>
            </div>
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
                {/* Avisos que salen de una copia de prueba: conviene quitarlos. */}
                {device.origin && !device.origin.endsWith(productionHost) && (
                  <p className="mt-0.5 font-medium text-warning">
                    Activado desde una copia de prueba ({device.origin.replace(/^https?:\/\//, "")}):
                    sus avisos salen con el icono y los links de esa copia. Conviene quitarlo.
                  </p>
                )}
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
