/**
 * Códigos de ARCA para los tipos de comprobante que emite Casa
 * Periotti. Viven en su propio módulo (y no en billing-service) porque
 * los necesitan tanto la emisión como el armado del PDF, y si estuvieran
 * en uno de los dos quedaría un import circular entre ellos.
 */
export const INVOICE_TYPE_TO_CODE: Record<string, number> = { A: 1, B: 6, C: 11 };

/** Bucket privado donde se guardan los PDF de los comprobantes. */
export const INVOICE_PDF_BUCKET = "facturas";

export function invoiceVoucherTypeCode(invoiceTypeLetter: string | null): number {
  // Ante una letra inesperada se asume B: es el comprobante que
  // corresponde a cualquier receptor que no sea Responsable Inscripto,
  // o sea el caso más frecuente y el menos riesgoso.
  return INVOICE_TYPE_TO_CODE[invoiceTypeLetter ?? "B"] ?? INVOICE_TYPE_TO_CODE.B;
}

/** Nombre con el que se descarga o se adjunta el PDF. */
export function invoicePdfFilename(params: {
  invoiceType: string | null;
  salesPoint: number | null;
  voucherNumber: number | null;
}): string {
  const letter = params.invoiceType ?? "B";
  const salesPoint = String(params.salesPoint ?? 0).padStart(5, "0");
  const number = String(params.voucherNumber ?? 0).padStart(8, "0");
  return `Factura_${letter}_${salesPoint}-${number}.pdf`;
}
