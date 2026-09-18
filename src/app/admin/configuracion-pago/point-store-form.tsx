"use client";

import { useState } from "react";
import {
  createPointStoreAction,
  geocodeAddressAction,
  listPointStoresAction,
} from "@/modules/pos/point-actions";
import type { GeocodeResult, PointPos, PointStore } from "@/modules/pos/point-stores";

/**
 * Sucursal y caja de Mercado Pago: es lo que la terminal Point necesita
 * tener antes de poder asociarse y trabajar en modo integrado.
 *
 * Los datos vienen precargados de Datos fiscales pero son todos
 * editables: el mismo sistema puede usarse en otro negocio, con otro
 * nombre y otra dirección.
 *
 * Las coordenadas las busca el botón a partir de la dirección, para no
 * tener que sacarlas de un mapa a mano. Mercado Pago las pide
 * obligatorias y avisa que si están mal pueden afectar el cálculo de
 * impuestos de las ventas de esa sucursal, así que se muestra qué
 * entendió el buscador para poder confirmarlo.
 */
export function PointStoreForm({
  defaultStoreName,
  defaultStreet,
  defaultCity,
  defaultState,
}: {
  defaultStoreName: string;
  defaultStreet: string;
  defaultCity: string;
  defaultState: string;
}) {
  // "Alem 822" llega en un solo campo desde Datos fiscales: se parte en
  // calle y número, que es como los pide Mercado Pago.
  const parsed = /^(.*?)\s+(\d+[a-zA-Z]?)$/.exec(defaultStreet.trim());

  const [storeName, setStoreName] = useState(defaultStoreName);
  const [streetName, setStreetName] = useState(parsed?.[1] ?? defaultStreet);
  const [streetNumber, setStreetNumber] = useState(parsed?.[2] ?? "");
  const [cityName, setCityName] = useState(defaultCity);
  const [stateName, setStateName] = useState(defaultState);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [posName, setPosName] = useState("Caja 1");

  const [found, setFound] = useState<GeocodeResult[] | null>(null);
  const [chosenLabel, setChosenLabel] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ stores: PointStore[]; pos: PointPos[] } | null>(null);
  const [created, setCreated] = useState<{ store: PointStore; pos: PointPos } | null>(null);
  const [loading, setLoading] = useState<"buscar" | "crear" | "existentes" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Valores que Mercado Pago sí acepta, cuando rechaza los que se cargaron.
  const [options, setOptions] = useState<{ field: "city" | "state"; values: string[] } | null>(
    null
  );

  async function buscarCoordenadas() {
    setLoading("buscar");
    setError(null);
    setFound(null);
    const query = [streetName, streetNumber, cityName, stateName, "Argentina"]
      .filter(Boolean)
      .join(", ");
    const res = await geocodeAddressAction(query);
    setLoading(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    setFound(res.results ?? []);
    // Con un solo resultado no hay nada que elegir.
    if (res.results?.length === 1) elegir(res.results[0]);
  }

  function elegir(result: GeocodeResult) {
    setLatitude(String(result.latitude));
    setLongitude(String(result.longitude));
    setChosenLabel(result.label);
    setFound(null);
  }

  async function verExistentes() {
    setLoading("existentes");
    setError(null);
    const res = await listPointStoresAction();
    setLoading(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    setExisting({ stores: res.stores ?? [], pos: res.pos ?? [] });
  }

  async function crear() {
    setLoading("crear");
    setError(null);
    setOptions(null);
    const res = await createPointStoreAction({
      storeName,
      streetName,
      streetNumber,
      cityName,
      stateName,
      latitude: Number(latitude),
      longitude: Number(longitude),
      posName,
    });
    setLoading(null);
    if (res.error || !res.store || !res.pos) {
      setError(res.error ?? "No se pudo crear la sucursal");
      setOptions(res.options ?? null);
      return;
    }
    setCreated({ store: res.store, pos: res.pos });
  }

  return (
    <div className="neu-card mt-8 max-w-xl p-4">
      <p className="text-sm font-medium text-ink">Sucursal y caja de Mercado Pago</p>
      <p className="mt-1 text-xs text-ink-muted">
        La terminal tiene que estar asociada a una sucursal y a una caja para poder recibir los
        montos del sistema. Esto las crea; la asociación en sí se hace después desde la app de
        Mercado Pago en el celular, escaneando el QR que muestra el equipo.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={verExistentes}
          disabled={loading !== null}
          className="neu-btn !px-3 !py-2 !text-xs"
        >
          {loading === "existentes" ? "Buscando…" : "Ver las que ya existen"}
        </button>
      </div>

      {existing && (
        <div className="neu-inset mt-3 p-3 text-xs">
          {existing.stores.length === 0 ? (
            <p className="text-ink-muted">
              La cuenta todavía no tiene ninguna sucursal. Creá una con el formulario de abajo.
            </p>
          ) : (
            <ul className="space-y-2">
              {existing.stores.map((store) => {
                const cajas = existing.pos.filter((p) => p.storeId === store.id);
                return (
                  <li key={store.id}>
                    <p className="text-ink">
                      <span className="font-medium">{store.name}</span> · sucursal {store.id}
                    </p>
                    {store.addressLine && (
                      <p className="text-ink-subtle">{store.addressLine}</p>
                    )}
                    {cajas.length === 0 ? (
                      <p className="text-warning">Sin cajas: no se le puede asociar una terminal.</p>
                    ) : (
                      <p className="text-ink-muted">
                        Cajas: {cajas.map((c) => `${c.name ?? "sin nombre"} (${c.id})`).join(" · ")}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Nombre del negocio" value={storeName} onChange={setStoreName} />
        <Field label="Nombre de la caja" value={posName} onChange={setPosName} />
        <Field label="Calle" value={streetName} onChange={setStreetName} />
        <Field label="Número" value={streetNumber} onChange={setStreetNumber} />
        <Field label="Ciudad" value={cityName} onChange={setCityName} />
        <Field label="Provincia" value={stateName} onChange={setStateName} />
      </div>

      <div className="mt-3">
        <button
          type="button"
          onClick={buscarCoordenadas}
          disabled={loading !== null}
          className="neu-btn !px-3 !py-2 !text-xs"
        >
          {loading === "buscar" ? "Buscando…" : "Buscar las coordenadas de esa dirección"}
        </button>
      </div>

      {found && found.length > 1 && (
        <div className="neu-inset mt-3 p-3 text-xs">
          <p className="mb-1 text-ink">¿Cuál es? Elegí la que corresponda:</p>
          <ul className="space-y-1">
            {found.map((r) => (
              <li key={`${r.latitude},${r.longitude}`}>
                <button
                  type="button"
                  onClick={() => elegir(r)}
                  className="text-left text-brand hover:underline"
                >
                  {r.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Latitud" value={latitude} onChange={setLatitude} />
        <Field label="Longitud" value={longitude} onChange={setLongitude} />
      </div>

      {chosenLabel && (
        <p className="mt-2 text-xs text-success">
          Coordenadas de: {chosenLabel}. Si no es tu local, corregilas a mano.
        </p>
      )}

      <p className="mt-3 text-[11px] text-ink-subtle">
        Mercado Pago pide la ubicación real: avisa que si está mal puede afectar el cálculo de
        impuestos de las ventas de esa sucursal.
      </p>

      <button
        type="button"
        onClick={crear}
        disabled={loading !== null || !latitude || !longitude}
        className="neu-btn neu-btn-primary mt-3 !px-4 !py-2 !text-xs"
      >
        {loading === "crear" ? "Creando…" : "Crear la sucursal y su caja"}
      </button>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}

      {options && (
        <div className="neu-inset mt-2 p-3 text-xs">
          <p className="text-ink">
            {options.field === "city" ? "Ciudades" : "Provincias"} que acepta Mercado Pago (
            {options.values.length}). Tocá la que corresponda:
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {options.values.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  if (options.field === "city") setCityName(value);
                  else setStateName(value);
                  setOptions(null);
                  setError(null);
                }}
                className="neu-chip !text-[11px]"
              >
                {value}
              </button>
            ))}
          </div>
          <p className="mt-2 text-ink-subtle">
            Si tu localidad no está en la lista, elegí el departamento o la localidad más cercana:
            es solo la referencia administrativa de Mercado Pago. Lo que ubica el local de verdad
            son las coordenadas de arriba.
          </p>
        </div>
      )}

      {created && (
        <div className="neu-inset mt-3 p-3 text-xs">
          <p className="font-medium text-success">Listo: sucursal y caja creadas.</p>
          <p className="mt-1 text-ink">
            Sucursal <span className="font-mono">{created.store.id}</span> ({created.store.name}) ·
            Caja <span className="font-mono">{created.pos.id}</span> ({created.pos.name})
          </p>
          <p className="mt-1 text-ink-subtle">
            Anotá esos números: el listado de Mercado Pago tarda unos minutos en mostrar la
            sucursal nueva, aunque ya esté creada y la terminal la pueda elegir.
          </p>
          <p className="mt-2 font-medium text-ink">Lo que falta, en la terminal:</p>
          <ol className="mt-1 list-decimal space-y-1 pl-4 text-ink-muted">
            <li>
              En el equipo, cerrá la sesión para que vuelva a mostrar el QR de vinculación (o
              prendelo si está apagado).
            </li>
            <li>Elegí &quot;Soy responsable del negocio&quot; o &quot;Soy un colaborador&quot;.</li>
            <li>
              Con la app de Mercado Pago en el celular, escaneá el QR que muestra la terminal.
            </li>
            <li>
              Cuando pregunte, elegí la sucursal <strong>{created.store.name}</strong> y la caja{" "}
              <strong>{created.pos.name}</strong>, y confirmá la dirección.
            </li>
            <li>Poné la contraseña que pida el equipo, hasta ver &quot;Ya podés cobrar&quot;.</li>
            <li>
              Volvé arriba, tocá <strong>Buscar terminales</strong>: tiene que decir que está
              asociada a esa sucursal y caja. Ponela en modo integrado y guardá.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs text-ink-muted">
      <span className="mb-1 block">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="neu-input !px-2 !py-1.5 !text-xs"
      />
    </label>
  );
}
