/**
 * Conversión entre precio neto y precio final con IVA.
 *
 * IMPORTANTE, porque es la parte que se puede malinterpretar:
 * products.price_retail y products.price_wholesale guardan el precio
 * FINAL CON IVA INCLUIDO, y de eso depende todo lo que viene después —
 * create_order() discrimina el neto dividiendo por (1 + IVA/100), y la
 * facturación arma los renglones a partir de eso. Ese formato de
 * guardado NO se cambió.
 *
 * Lo único que cambió es la carga: el empleado ingresa el neto (que es
 * como le llega el precio del proveedor) y el sistema calcula el final.
 * O sea, esta conversión es de interfaz: pasa el neto a final al
 * guardar, y el final a neto al abrir el formulario para editar.
 *
 * Este archivo NO lleva "server-only" a propósito: el desglose en vivo
 * del formulario y el cálculo definitivo del servidor tienen que usar
 * exactamente la misma fórmula, o el empleado vería un número distinto
 * al que se guarda.
 */

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Precio final con IVA, a partir del neto. Es el que se guarda. */
export function grossFromNet(netPrice: number, vatRate: number): number {
  return round2(netPrice * (1 + vatRate / 100));
}

/** Neto a partir del precio final con IVA. Es el que se muestra al editar. */
export function netFromGross(grossPrice: number, vatRate: number): number {
  return round2(grossPrice / (1 + vatRate / 100));
}

/** Monto de IVA contenido en un precio final. */
export function vatAmountFromNet(netPrice: number, vatRate: number): number {
  return round2(grossFromNet(netPrice, vatRate) - netPrice);
}

export interface PriceBreakdown {
  net: number;
  vat: number;
  gross: number;
}

/** El desglose completo que se le muestra al empleado antes de guardar. */
export function priceBreakdown(netPrice: number, vatRate: number): PriceBreakdown {
  const net = round2(netPrice);
  const gross = grossFromNet(net, vatRate);
  return { net, vat: round2(gross - net), gross };
}
