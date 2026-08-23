import "server-only";

export interface ArcaQrInput {
  cuit: number;
  salesPoint: number;
  voucherTypeCode: number;
  voucherNumber: number;
  totalAmount: number;
  issueDate: string; // yyyy-mm-dd
  docType: number;
  docNumber: number;
  cae: string;
}

/**
 * Arma la URL del código QR que ARCA exige desde 2026 en todo
 * comprobante electrónico. El formato es el que publica ARCA: un JSON
 * con los datos del comprobante, codificado en base64, dentro de la
 * URL de verificación pública.
 */
export function buildArcaQrUrl(input: ArcaQrInput): string {
  const payload = {
    ver: 1,
    fecha: input.issueDate,
    cuit: input.cuit,
    ptoVta: input.salesPoint,
    tipoCmp: input.voucherTypeCode,
    nroCmp: input.voucherNumber,
    importe: input.totalAmount,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: input.docType,
    nroDocRec: input.docNumber,
    tipoCodAut: "E",
    codAut: Number(input.cae),
  };

  const base64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  return `https://www.afip.gob.ar/fe/qr/?p=${base64}`;
}
