"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Escanear un código de barras con la cámara del celular, sin lector.
 *
 * Dos caminos, según lo que tenga el teléfono:
 *
 *  - Android con Chrome trae un lector de códigos en el propio navegador
 *    (BarcodeDetector). Es el más rápido y no descarga nada.
 *  - iPhone (y cualquier navegador sin ese lector) usa ZXing, que se
 *    descarga recién cuando se abre la cámara, así nadie carga esa
 *    librería por entrar al panel.
 *
 * La cámara necesita HTTPS: en el sitio publicado funciona, y en una
 * computadora de desarrollo solo en localhost.
 */

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

/** Los formatos de los envases que se venden en el mostrador. */
const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];

function nativeDetector(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

export function BarcodeScannerButton({
  onDetected,
  label = "Escanear con la cámara",
  className = "neu-btn !px-3 !py-2 !text-xs",
}: {
  /** Se llama con el código leído. El componente cierra la cámara antes. */
  onDetected: (code: string) => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("Pidiendo permiso para usar la cámara…");
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const zxingRef = useRef<{ stop: () => void } | null>(null);
  const doneRef = useRef(false);

  /** Apaga la cámara y cualquier bucle de lectura. Se puede llamar de más. */
  const stopEverything = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    zxingRef.current?.stop();
    zxingRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const finish = useCallback(
    (code: string) => {
      if (doneRef.current) return;
      doneRef.current = true;
      stopEverything();
      setOpen(false);
      // Vibración corta como confirmación: en el mostrador el teléfono
      // suele estar en la mano y no se mira la pantalla.
      navigator.vibrate?.(60);
      onDetected(code.trim());
    },
    [onDetected, stopEverything]
  );

  /** Prepara el estado y abre la cámara. */
  function openScanner() {
    doneRef.current = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      // Sin HTTPS o en un navegador viejo no hay cámara posible: se abre
      // igual, pero solo para explicar por qué y qué hacer.
      setStatus("");
      setError(
        "Este navegador no puede usar la cámara. Probá con Chrome o Safari actualizado, o escribí el código a mano."
      );
      setOpen(true);
      return;
    }
    setError(null);
    setStatus("Pidiendo permiso para usar la cámara…");
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    // El mensaje de "no hay cámara" ya lo puso openScanner().
    if (!navigator.mediaDevices?.getUserMedia) return;

    let cancelled = false;

    async function start() {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // La de atrás, que es la que enfoca el envase.
          video: { facingMode: { ideal: "environment" } },
        });
      } catch {
        setError(
          "No se pudo abrir la cámara. Revisá que el navegador tenga permiso para usarla (candado en la barra de direcciones) y que no la esté usando otra app."
        );
        return;
      }
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Safari puede rechazar el play automático: el usuario ya tocó el
        // botón, así que con el atributo playsInline alcanza.
      }
      if (cancelled) return;
      setStatus("Apuntá al código de barras del envase");

      const Detector = nativeDetector();
      if (Detector) {
        const detector = new Detector({ formats: FORMATS });
        timerRef.current = setInterval(async () => {
          if (doneRef.current || !videoRef.current) return;
          try {
            const found = await detector.detect(videoRef.current);
            const code = found.find((b) => b.rawValue?.trim())?.rawValue;
            if (code) finish(code);
          } catch {
            // Un cuadro que no se pudo analizar no es un error: sigue.
          }
        }, 150);
        return;
      }

      // iPhone y compañía: se descarga el lector recién ahora.
      setStatus("Preparando el lector…");
      try {
        const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
          import("@zxing/browser"),
          import("@zxing/library"),
        ]);
        if (cancelled || doneRef.current) return;
        // Decirle qué formatos buscar lo hace más rápido y evita lecturas
        // equivocadas: son los mismos que la lista FORMATS de arriba.
        const hints = new Map([
          [
            DecodeHintType.POSSIBLE_FORMATS,
            [
              BarcodeFormat.EAN_13,
              BarcodeFormat.EAN_8,
              BarcodeFormat.UPC_A,
              BarcodeFormat.UPC_E,
              BarcodeFormat.CODE_128,
              BarcodeFormat.CODE_39,
              BarcodeFormat.ITF,
            ],
          ],
        ]);
        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 150,
        });
        const controls = await reader.decodeFromVideoElement(video, (result) => {
          const code = result?.getText();
          if (code) finish(code);
        });
        zxingRef.current = controls;
        if (cancelled || doneRef.current) controls.stop();
        else setStatus("Apuntá al código de barras del envase");
      } catch {
        setError(
          "No se pudo iniciar el lector en este navegador. Escribí el código a mano o usá un lector USB."
        );
      }
    }

    start();

    return () => {
      cancelled = true;
      stopEverything();
    };
  }, [open, finish, stopEverything]);

  return (
    <>
      <button type="button" onClick={openScanner} className={className}>
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Escanear código de barras"
        >
          <div className="w-full max-w-sm">
            <div className="relative overflow-hidden rounded-neu bg-black">
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                className="h-64 w-full object-cover"
              />
              {/* Guía: el código tiene que quedar dentro de la franja. */}
              <div className="pointer-events-none absolute inset-x-6 top-1/2 h-20 -translate-y-1/2 rounded border-2 border-white/80" />
            </div>

            <p className="mt-3 text-center text-sm text-white">{error ?? status}</p>
            <p className="mt-1 text-center text-xs text-white/70">
              Si no lo lee, acercá o alejá un poco el envase y buscá que no haya reflejos.
            </p>

            <button
              type="button"
              onClick={() => {
                stopEverything();
                setOpen(false);
              }}
              className="neu-btn mt-4 w-full"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
