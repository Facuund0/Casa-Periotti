"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface SearchSuggestion {
  /** Único dentro de la lista. */
  key: string;
  /** Texto principal de la opción. */
  label: string;
  /** Dato secundario (email, CUIT, total...). */
  detail?: string | null;
  /** Lo que queda escrito en el campo al elegirla. */
  value: string;
  /** Si viene, elegir la opción abre esta página (por ejemplo, la ficha del producto). */
  href?: string;
  /** Datos extra para quien usa la opción (por ejemplo, completar otro campo). */
  meta?: Record<string, string | null>;
}

/**
 * Campo de búsqueda con sugerencias mientras se escribe, a partir de los
 * datos registrados. Se usa en los buscadores del panel.
 *
 * - Consulta al servidor recién cuando se deja de tipear un momento, y
 *   descarta respuestas viejas si llegan tarde.
 * - Teclado: flechas para moverse, Enter para elegir, Escape para cerrar.
 *   Enter sin una opción marcada hace lo de siempre (buscar).
 * - Al elegir: completa el campo y, con submitOnSelect, envía el
 *   formulario, o avisa con onSelect.
 */
export function SmartSearch({
  id,
  name,
  defaultValue = "",
  placeholder,
  suggest,
  onSelect,
  onQueryChange,
  submitOnSelect = false,
  minChars = 2,
  className = "neu-input",
  type = "search",
  inputMode,
}: {
  id: string;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  suggest: (query: string) => Promise<SearchSuggestion[]>;
  onSelect?: (suggestion: SearchSuggestion) => void;
  onQueryChange?: (query: string) => void;
  submitOnSelect?: boolean;
  minChars?: number;
  className?: string;
  type?: "search" | "text";
  inputMode?: "text" | "numeric";
}) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const skipNextFetch = useRef(false);
  const [query, setQuery] = useState(defaultValue);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (skipNextFetch.current) {
      skipNextFetch.current = false;
      return;
    }
    const term = query.trim();
    if (term.length < minChars) {
      requestId.current++;
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const current = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(() => {
      suggest(term)
        .then((result) => {
          if (current !== requestId.current) return;
          setSuggestions(result);
          setActive(-1);
          setOpen(true);
        })
        .catch(() => {
          if (current === requestId.current) setSuggestions([]);
        })
        .finally(() => {
          if (current === requestId.current) setLoading(false);
        });
    }, 220);
    return () => clearTimeout(timer);
  }, [query, minChars, suggest]);

  function choose(suggestion: SearchSuggestion) {
    skipNextFetch.current = true;
    setQuery(suggestion.value);
    onQueryChange?.(suggestion.value);
    setOpen(false);
    setSuggestions([]);
    onSelect?.(suggestion);
    if (suggestion.href) {
      router.push(suggestion.href);
      return;
    }
    if (submitOnSelect) {
      // Se espera a que el campo tenga el valor elegido antes de enviar.
      setTimeout(() => inputRef.current?.form?.requestSubmit(), 0);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp" && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter" && open && active >= 0 && suggestions[active]) {
      e.preventDefault();
      choose(suggestions[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showList = open && query.trim().length >= minChars && (suggestions.length > 0 || !loading);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          setQuery(e.target.value);
          onQueryChange?.(e.target.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length && setOpen(true)}
        onBlur={() => setOpen(false)}
        className={className}
      />
      {loading && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-ink-subtle">
          Buscando…
        </span>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="neu-card absolute left-0 right-0 z-30 mt-1 max-h-72 overflow-y-auto p-1"
        >
          {suggestions.length === 0 ? (
            <li className="px-3 py-2 text-xs text-ink-subtle">Sin coincidencias registradas.</li>
          ) : (
            suggestions.map((s, i) => (
              <li
                key={s.key}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                // mousedown y no click: el click llegaría después del blur, con la lista ya cerrada.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}
                onMouseEnter={() => setActive(i)}
                className={`cursor-pointer rounded-neu-sm px-3 py-2 text-sm ${
                  i === active ? "bg-surface-sunken text-ink" : "text-ink"
                }`}
              >
                <Highlight text={s.label} term={query.trim()} />
                {s.detail && <span className="block text-xs text-ink-muted">{s.detail}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** Resalta la parte del texto que coincide con lo tipeado (sin distinguir mayúsculas ni tildes). */
function Highlight({ text, term }: { text: string; term: string }) {
  // Letra por letra, as\u00ed el texto normalizado tiene el mismo largo que el
  // original y la posici\u00f3n de la coincidencia sirve para cortar el original.
  const normalize = (s: string) =>
    [...s]
      .map((ch) => ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").charAt(0) || ch)
      .join("")
      .toLowerCase();
  const index = term ? normalize(text).indexOf(normalize(term)) : -1;
  if (index < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, index)}
      <mark className="rounded-sm bg-brand/15 px-0.5 text-inherit">{text.slice(index, index + term.length)}</mark>
      {text.slice(index + term.length)}
    </span>
  );
}
