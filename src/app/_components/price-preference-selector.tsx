"use client";

import { PRICE_PREFERENCE_LABELS, type PricePreference } from "@/modules/products/wholesale-pricing";

/**
 * Elección mayorista/minorista para un mayorista aprobado, igual en el
 * checkout y en el mostrador. Es solo una preferencia: el precio lo decide
 * create_order con el tipo de cliente y el mínimo de cada producto.
 */
export function PricePreferenceSelector({
  id,
  value,
  onChange,
  hint,
}: {
  id: string;
  value: PricePreference;
  onChange: (value: PricePreference) => void;
  hint?: string;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-ink">Tipo de precio</legend>
      <div className="flex gap-2">
        {(["mayorista", "minorista"] as const).map((option) => (
          <label
            key={option}
            htmlFor={`${id}-${option}`}
            className={`neu-chip flex-1 !justify-center !rounded-neu !py-2.5 ${
              value === option ? "neu-chip-active font-semibold" : ""
            }`}
          >
            <input
              id={`${id}-${option}`}
              type="radio"
              name={id}
              value={option}
              checked={value === option}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            {PRICE_PREFERENCE_LABELS[option]}
          </label>
        ))}
      </div>
      {hint && <p className="mt-1.5 text-xs text-ink-subtle">{hint}</p>}
    </fieldset>
  );
}
