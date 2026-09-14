import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import QRCode from "qrcode";
import {
  buildInvoiceBarcodeDigits,
  interleaved2of5Geometry,
  type InvoiceBarcodeInput,
} from "./barcode";
import {
  ISSUER_IVA_CONDITION_LABELS,
  type CompleteBusinessSettings,
} from "./business-settings-service";

export interface InvoicePdfItem {
  description: string;
  quantity: number;
  /** Precio unitario tal como se imprime (ver la nota de importes abajo). */
  unitPrice: number;
  /** Importe del renglón tal como se imprime. */
  lineAmount: number;
}

export interface InvoicePdfInvoice {
  invoiceType: string; // "A" | "B" | "C"
  voucherTypeCode: number;
  salesPoint: number;
  voucherNumber: number;
  issueDate: string; // yyyy-mm-dd
  cae: string;
  caeDueDate: string; // yyyy-mm-dd
  customerName: string;
  buyerDocumentType: string | null; // "CUIT" | "DNI" | "CF"
  buyerDocumentNumber: string | null;
  buyerIvaCondition: string | null;
  subtotal: number;
  vatAmount: number;
  total: number;
  ivaContenido: number | null;
  environment: string; // "production" | "testing"
  qrUrl: string;
}

export interface InvoicePdfData {
  issuer: CompleteBusinessSettings;
  invoice: InvoicePdfInvoice;
  items: InvoicePdfItem[];
}

// ---------------------------------------------------------------
// Geometría de la hoja. Todo en puntos PostScript (72 por pulgada),
// que es la unidad nativa de un PDF.
// ---------------------------------------------------------------
const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CENTER_X = PAGE_WIDTH / 2;

const HEADER_HEIGHT = 120;
const BUYER_BOX_HEIGHT = 54;
const TABLE_HEADER_HEIGHT = 18;
const ROW_LINE_HEIGHT = 11;
const ROW_PADDING = 5;

// Alto que se reserva al pie de la ÚLTIMA hoja para totales, CAE, QR y
// código de barras. Los renglones nunca invaden esta zona.
const FOOTER_HEIGHT = 210;
// En las hojas intermedias solo hace falta dejar lugar al "Hoja X de Y".
const CONTINUATION_FOOTER_HEIGHT = 40;

const COL_DESCRIPTION = MARGIN + 4;
const COL_QUANTITY_RIGHT = MARGIN + 330;
const COL_UNIT_PRICE_RIGHT = MARGIN + 425;
const COL_LINE_AMOUNT_RIGHT = MARGIN + CONTENT_WIDTH - 4;
const DESCRIPTION_WIDTH = 280;

const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.45, 0.45, 0.45);
const LIGHT_GREY = rgb(0.93, 0.93, 0.93);
const RED = rgb(0.75, 0.1, 0.1);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
}

/**
 * Arma el PDF imprimible de una factura autorizada.
 *
 * ARCA no genera el impreso: el web service solo devuelve el CAE. El
 * comprobante en papel lo tiene que armar el emisor, y la normativa
 * exige que muestre los datos del emisor y del receptor, el detalle,
 * los importes, el CAE con su vencimiento, el código QR y el código de
 * barras (RG 1702 y siguientes).
 *
 * Sobre los importes: los renglones llegan ya resueltos por quien
 * construye los datos (ver InvoicePdfService) porque la convención
 * cambia según la letra — en Factura A los precios se muestran netos y
 * el IVA se discrimina aparte; en Factura B se muestran con IVA
 * incluido y el IVA va como "IVA Contenido" del régimen de
 * transparencia fiscal. Este módulo solo dibuja lo que recibe.
 */
export async function buildInvoicePdf(data: InvoicePdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();

  doc.setTitle(
    `Factura ${data.invoice.invoiceType} ${formatVoucherNumber(data.invoice)} - ${data.issuer.legalName}`
  );
  doc.setProducer("Casa Periotti");
  doc.setCreationDate(new Date());

  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };

  const qrImage = await doc.embedPng(
    await QRCode.toBuffer(data.invoice.qrUrl, { type: "png", margin: 0, width: 320 })
  );

  // Se pagina primero y se dibuja después: el "Hoja X de Y" del pie
  // necesita saber el total de hojas antes de escribir la primera.
  const pages = paginateItems(data.items, fonts);

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const isLastPage = pageIndex === pages.length - 1;

    let y = drawHeader(page, fonts, data);
    y = drawBuyerBox(page, fonts, data, y);
    y = drawItemsTable(page, fonts, pages[pageIndex], y);

    if (isLastPage) {
      drawTotals(page, fonts, data, y);
      drawAuthorizationFooter(page, fonts, data, qrImage);
    }

    drawPageNumber(page, fonts, pageIndex + 1, pages.length);

    if (data.invoice.environment !== "production") {
      drawTestingWarning(page, fonts);
    }
  }

  return doc.save();
}

// ---------------------------------------------------------------
// Cabecera: emisor a la izquierda, letra al centro, datos del
// comprobante a la derecha.
// ---------------------------------------------------------------
function drawHeader(page: PDFPage, fonts: Fonts, data: InvoicePdfData): number {
  const top = PAGE_HEIGHT - MARGIN - 18;
  const bottom = top - HEADER_HEIGHT;
  const { issuer, invoice } = data;

  page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: CONTENT_WIDTH,
    height: HEADER_HEIGHT,
    borderColor: BLACK,
    borderWidth: 1,
  });

  page.drawLine({
    start: { x: CENTER_X, y: top },
    end: { x: CENTER_X, y: bottom },
    thickness: 1,
    color: BLACK,
  });

  // --- Emisor ---
  let leftY = top - 22;
  const leftX = MARGIN + 10;

  text(page, fonts.bold, issuer.tradeName ?? issuer.legalName, leftX, leftY, 14);
  leftY -= 16;

  if (issuer.tradeName) {
    labeled(page, fonts, "Razón Social:", issuer.legalName, leftX, leftY, 7.5);
    leftY -= 11;
  }

  labeled(page, fonts, "Domicilio Comercial:", formatAddress(issuer), leftX, leftY, 7.5, 230);
  leftY -= 20;

  labeled(
    page,
    fonts,
    "Condición frente al IVA:",
    ISSUER_IVA_CONDITION_LABELS[issuer.ivaCondition],
    leftX,
    leftY,
    7.5
  );
  leftY -= 11;

  if (issuer.contactPhone || issuer.contactEmail) {
    const contact = [issuer.contactPhone, issuer.contactEmail].filter(Boolean).join(" - ");
    labeled(page, fonts, "Contacto:", contact, leftX, leftY, 7.5, 230);
  }

  // --- Letra del comprobante, en recuadro, a caballo del borde ---
  drawLetterBox(page, fonts, invoice, top);

  // --- Datos del comprobante ---
  let rightY = top - 22;
  const rightX = CENTER_X + 14;

  text(page, fonts.bold, "FACTURA", rightX, rightY, 14);
  rightY -= 18;

  labeled(page, fonts, "Punto de Venta:", pad(invoice.salesPoint, 5), rightX, rightY, 8);
  labeled(page, fonts, "Comp. Nro:", pad(invoice.voucherNumber, 8), rightX + 115, rightY, 8);
  rightY -= 12;

  labeled(page, fonts, "Fecha de Emisión:", formatDate(invoice.issueDate), rightX, rightY, 8);
  rightY -= 12;

  labeled(page, fonts, "CUIT:", formatCuit(issuer.cuitDigits), rightX, rightY, 8);
  rightY -= 12;

  labeled(
    page,
    fonts,
    "Ingresos Brutos:",
    issuer.grossIncomeNumber ?? NOT_REQUIRED,
    rightX,
    rightY,
    8
  );
  rightY -= 12;

  labeled(
    page,
    fonts,
    "Inicio de Actividades:",
    issuer.activitiesStartDate ? formatDate(issuer.activitiesStartDate) : NOT_REQUIRED,
    rightX,
    rightY,
    8
  );

  return bottom - 10;
}

function drawLetterBox(page: PDFPage, fonts: Fonts, invoice: InvoicePdfInvoice, headerTop: number) {
  const size = 54;
  const x = CENTER_X - size / 2;
  const y = headerTop - size / 2;

  // Relleno blanco: tapa la línea divisoria y el borde de la cabecera,
  // que es cómo se ve en un comprobante impreso real.
  page.drawRectangle({
    x,
    y,
    width: size,
    height: size,
    color: rgb(1, 1, 1),
    borderColor: BLACK,
    borderWidth: 1,
  });

  const letter = invoice.invoiceType || "B";
  const letterWidth = fonts.bold.widthOfTextAtSize(letter, 30);
  page.drawText(letter, {
    x: CENTER_X - letterWidth / 2,
    y: y + 20,
    size: 30,
    font: fonts.bold,
    color: BLACK,
  });

  const code = `CÓD. ${pad(invoice.voucherTypeCode, 3)}`;
  const codeWidth = fonts.regular.widthOfTextAtSize(code, 6.5);
  page.drawText(sanitize(code), {
    x: CENTER_X - codeWidth / 2,
    y: y + 7,
    size: 6.5,
    font: fonts.regular,
    color: BLACK,
  });
}

// ---------------------------------------------------------------
// Receptor
// ---------------------------------------------------------------
function drawBuyerBox(page: PDFPage, fonts: Fonts, data: InvoicePdfData, startY: number): number {
  const { invoice } = data;
  const top = startY;
  const bottom = top - BUYER_BOX_HEIGHT;

  page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: CONTENT_WIDTH,
    height: BUYER_BOX_HEIGHT,
    borderColor: BLACK,
    borderWidth: 1,
  });

  const x = MARGIN + 10;
  let y = top - 14;

  // Consumidor Final sin identificar: la normativa exige la leyenda en
  // lugar de los datos del comprador (que no se tienen).
  const isAnonymous = invoice.buyerDocumentType === "CF" || !invoice.buyerDocumentNumber;

  if (isAnonymous) {
    text(page, fonts.bold, "A CONSUMIDOR FINAL", x, y, 11);
    y -= 14;
    labeled(page, fonts, "Apellido y Nombre / Razón Social:", invoice.customerName, x, y, 8, 300);
    y -= 12;
    labeled(page, fonts, "Domicilio:", NOT_REQUIRED, x, y, 8);
    text(
      page,
      fonts.regular,
      `Condición frente al IVA: ${invoice.buyerIvaCondition ?? "Consumidor Final"}`,
      x + 200,
      y,
      8
    );
    return bottom - 12;
  }

  labeled(
    page,
    fonts,
    `${invoice.buyerDocumentType ?? "CUIT"}:`,
    invoice.buyerDocumentType === "CUIT"
      ? formatCuit(invoice.buyerDocumentNumber ?? "")
      : invoice.buyerDocumentNumber ?? NOT_REQUIRED,
    x,
    y,
    8
  );
  y -= 13;

  labeled(page, fonts, "Apellido y Nombre / Razón Social:", invoice.customerName, x, y, 8, 300);
  y -= 13;

  labeled(
    page,
    fonts,
    "Condición frente al IVA:",
    invoice.buyerIvaCondition ?? NOT_REQUIRED,
    x,
    y,
    8
  );
  text(page, fonts.regular, `Domicilio: ${NOT_REQUIRED}`, x + 230, y, 8);

  return bottom - 12;
}

// ---------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------
interface PreparedRow {
  lines: string[];
  quantity: string;
  unitPrice: string;
  lineAmount: string;
  height: number;
}

function paginateItems(items: InvoicePdfItem[], fonts: Fonts): PreparedRow[][] {
  const rows = items.map<PreparedRow>((item) => {
    const lines = wrapText(item.description, fonts.regular, 8, DESCRIPTION_WIDTH, 2);
    return {
      lines,
      quantity: formatQuantity(item.quantity),
      unitPrice: formatMoney(item.unitPrice),
      lineAmount: formatMoney(item.lineAmount),
      height: lines.length * ROW_LINE_HEIGHT + ROW_PADDING,
    };
  });

  // Alto disponible para renglones, según si la hoja lleva el pie con
  // totales y CAE o solo el número de hoja.
  const topOfTable =
    PAGE_HEIGHT - MARGIN - 18 - HEADER_HEIGHT - 10 - BUYER_BOX_HEIGHT - 12 - TABLE_HEADER_HEIGHT;
  const lastPageSpace = topOfTable - MARGIN - FOOTER_HEIGHT;
  const middlePageSpace = topOfTable - MARGIN - CONTINUATION_FOOTER_HEIGHT;

  if (rows.length === 0) return [[]];

  // Primero se prueba si todo entra en una sola hoja (el caso normal).
  const totalHeight = rows.reduce((sum, r) => sum + r.height, 0);
  if (totalHeight <= lastPageSpace) return [rows];

  const pages: PreparedRow[][] = [];
  let current: PreparedRow[] = [];
  let used = 0;

  for (const row of rows) {
    if (used + row.height > middlePageSpace && current.length > 0) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(row);
    used += row.height;
  }
  pages.push(current);

  // La última hoja tiene menos lugar (lleva totales y CAE): si lo que
  // quedó no entra, se pasa a una hoja más. Puede repetirse si la
  // última fila es muy alta, por eso es un while y no un if.
  while (true) {
    const last = pages[pages.length - 1];
    const lastHeight = last.reduce((sum, r) => sum + r.height, 0);
    if (lastHeight <= lastPageSpace || last.length === 0) break;
    pages.push([last.pop()!]);
  }

  return pages;
}

function drawItemsTable(
  page: PDFPage,
  fonts: Fonts,
  rows: PreparedRow[],
  startY: number
): number {
  const headerBottom = startY - TABLE_HEADER_HEIGHT;

  page.drawRectangle({
    x: MARGIN,
    y: headerBottom,
    width: CONTENT_WIDTH,
    height: TABLE_HEADER_HEIGHT,
    color: LIGHT_GREY,
    borderColor: BLACK,
    borderWidth: 0.5,
  });

  const headerTextY = headerBottom + 6;
  text(page, fonts.bold, "Descripción", COL_DESCRIPTION, headerTextY, 8);
  rightText(page, fonts.bold, "Cantidad", COL_QUANTITY_RIGHT, headerTextY, 8);
  rightText(page, fonts.bold, "P. Unitario", COL_UNIT_PRICE_RIGHT, headerTextY, 8);
  rightText(page, fonts.bold, "Subtotal", COL_LINE_AMOUNT_RIGHT, headerTextY, 8);

  let y = headerBottom;

  for (const row of rows) {
    const rowTop = y;
    y -= row.height;

    let lineY = rowTop - ROW_LINE_HEIGHT + 2;
    for (const line of row.lines) {
      text(page, fonts.regular, line, COL_DESCRIPTION, lineY, 8);
      lineY -= ROW_LINE_HEIGHT;
    }

    const amountsY = rowTop - ROW_LINE_HEIGHT + 2;
    rightText(page, fonts.regular, row.quantity, COL_QUANTITY_RIGHT, amountsY, 8);
    rightText(page, fonts.regular, row.unitPrice, COL_UNIT_PRICE_RIGHT, amountsY, 8);
    rightText(page, fonts.regular, row.lineAmount, COL_LINE_AMOUNT_RIGHT, amountsY, 8);

    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: MARGIN + CONTENT_WIDTH, y },
      thickness: 0.25,
      color: rgb(0.8, 0.8, 0.8),
    });
  }

  return y - 6;
}

// ---------------------------------------------------------------
// Totales
// ---------------------------------------------------------------
function drawTotals(page: PDFPage, fonts: Fonts, data: InvoicePdfData, startY: number) {
  const { invoice } = data;
  const boxWidth = 230;
  const x = MARGIN + CONTENT_WIDTH - boxWidth;
  const labelRight = x + 120;
  const valueRight = MARGIN + CONTENT_WIDTH - 6;

  // En Factura A el IVA se discrimina; en B el total ya lo tiene
  // incluido y lo que se informa es el IVA contenido (ver más abajo).
  const discriminatesVat = invoice.invoiceType === "A";
  let y = startY - 14;

  if (discriminatesVat) {
    totalLine(page, fonts, "Subtotal:", formatMoney(invoice.subtotal), labelRight, valueRight, y, 9);
    y -= 14;
    // La alícuota no se guarda en invoices, pero se puede derivar de los
    // importes: es lo que una Factura A tiene que mostrar discriminado
    // ("IVA 21%"), no un "IVA" suelto.
    totalLine(
      page,
      fonts,
      `IVA ${formatVatRate(invoice.subtotal, invoice.vatAmount)}:`,
      formatMoney(invoice.vatAmount),
      labelRight,
      valueRight,
      y,
      9
    );
    y -= 16;
  } else {
    totalLine(page, fonts, "Subtotal:", formatMoney(invoice.total), labelRight, valueRight, y, 9);
    y -= 16;
  }

  page.drawLine({
    start: { x, y: y + 10 },
    end: { x: MARGIN + CONTENT_WIDTH, y: y + 10 },
    thickness: 0.75,
    color: BLACK,
  });

  totalLine(
    page,
    fonts,
    "Importe Total:",
    formatMoney(invoice.total),
    labelRight,
    valueRight,
    y - 2,
    11,
    true
  );

  // Régimen de Transparencia Fiscal al Consumidor (Ley 27.743): en los
  // comprobantes que no discriminan IVA hay que informar igual cuánto
  // del total es IVA.
  if (!discriminatesVat) {
    const ivaContenido = invoice.ivaContenido ?? invoice.vatAmount;
    let legendY = y - 24;
    text(
      page,
      fonts.bold,
      "Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)",
      MARGIN,
      legendY,
      7.5
    );
    legendY -= 10;
    text(page, fonts.regular, `IVA Contenido: ${formatMoney(ivaContenido)}`, MARGIN, legendY, 7.5);
  }
}

function totalLine(
  page: PDFPage,
  fonts: Fonts,
  label: string,
  value: string,
  labelRight: number,
  valueRight: number,
  y: number,
  size: number,
  emphasize = false
) {
  const font = emphasize ? fonts.bold : fonts.regular;
  rightText(page, font, label, labelRight, y, size);
  rightText(page, font, value, valueRight, y, size);
}

// ---------------------------------------------------------------
// Pie de autorización: CAE, QR y código de barras
// ---------------------------------------------------------------
function drawAuthorizationFooter(
  page: PDFPage,
  fonts: Fonts,
  data: InvoicePdfData,
  qrImage: Awaited<ReturnType<PDFDocument["embedPng"]>>
) {
  const { invoice, issuer } = data;
  const baseY = MARGIN + 12;

  // QR obligatorio, abajo a la izquierda.
  const qrSize = 78;
  page.drawImage(qrImage, { x: MARGIN, y: baseY + 26, width: qrSize, height: qrSize });

  const caeX = MARGIN + qrSize + 14;
  let caeY = baseY + 26 + qrSize - 10;

  labeled(page, fonts, "CAE N°:", invoice.cae, caeX, caeY, 9);
  caeY -= 13;
  labeled(page, fonts, "Fecha de Vto. de CAE:", formatDate(invoice.caeDueDate), caeX, caeY, 9);
  caeY -= 13;
  text(
    page,
    fonts.regular,
    "Comprobante autorizado por ARCA. Verificable con el código QR.",
    caeX,
    caeY,
    7,
    GREY
  );

  // Código de barras obligatorio en todo comprobante impreso.
  // Si algo de los datos no permitiera armarlo (un CAE con una
  // cantidad inesperada de dígitos, por ejemplo), se imprime el aviso
  // en lugar de romper el PDF entero: el resto del comprobante sigue
  // siendo válido y el problema queda visible para corregirlo.
  try {
    const barcodeInput: InvoiceBarcodeInput = {
      cuitDigits: issuer.cuitDigits,
      voucherTypeCode: invoice.voucherTypeCode,
      salesPoint: invoice.salesPoint,
      cae: invoice.cae,
      caeDueDate: invoice.caeDueDate,
    };
    const digits = buildInvoiceBarcodeDigits(barcodeInput);
    drawBarcode(page, fonts, digits, caeX, baseY);
  } catch (err) {
    console.error("[invoice-pdf] No se pudo generar el código de barras:", err);
    text(
      page,
      fonts.regular,
      "No se pudo generar el código de barras de este comprobante.",
      caeX,
      baseY + 6,
      7,
      RED
    );
  }
}

function drawBarcode(page: PDFPage, fonts: Fonts, digits: string, x: number, y: number) {
  const maxWidth = MARGIN + CONTENT_WIDTH - x;
  const height = 26;
  const { bars, totalWidth } = interleaved2of5Geometry(digits);
  const moduleWidth = maxWidth / totalWidth;
  const barsY = y + 11;

  for (const bar of bars) {
    page.drawRectangle({
      x: x + bar.offset * moduleWidth,
      y: barsY,
      width: bar.width * moduleWidth,
      height,
      color: BLACK,
    });
  }

  // Los dígitos impresos debajo permiten cargarlo a mano si el lector
  // no llega a leer el código.
  text(page, fonts.regular, digits, x, y + 2, 7);
}

// ---------------------------------------------------------------
// Avisos y numeración de hojas
// ---------------------------------------------------------------
function drawPageNumber(page: PDFPage, fonts: Fonts, pageNumber: number, pageCount: number) {
  const label = `Hoja ${pageNumber} de ${pageCount}`;
  rightText(page, fonts.regular, label, MARGIN + CONTENT_WIDTH, PAGE_HEIGHT - MARGIN - 8, 7.5, GREY);
}

function drawTestingWarning(page: PDFPage, fonts: Fonts) {
  const label = "AMBIENTE DE HOMOLOGACIÓN - COMPROBANTE SIN VALIDEZ FISCAL";
  const width = fonts.bold.widthOfTextAtSize(sanitize(label), 9);
  page.drawText(sanitize(label), {
    x: CENTER_X - width / 2,
    y: PAGE_HEIGHT - MARGIN - 8,
    size: 9,
    font: fonts.bold,
    color: RED,
  });
}

// ---------------------------------------------------------------
// Helpers de dibujo y formato
// ---------------------------------------------------------------
const NOT_REQUIRED = "NR";

function text(
  page: PDFPage,
  font: PDFFont,
  value: string,
  x: number,
  y: number,
  size: number,
  color = BLACK
) {
  page.drawText(sanitize(value), { x, y, size, font, color });
}

function rightText(
  page: PDFPage,
  font: PDFFont,
  value: string,
  xRight: number,
  y: number,
  size: number,
  color = BLACK
) {
  const clean = sanitize(value);
  const width = font.widthOfTextAtSize(clean, size);
  page.drawText(clean, { x: xRight - width, y, size, font, color });
}

/** Etiqueta en negrita + valor, con corte de línea si el valor es largo. */
function labeled(
  page: PDFPage,
  fonts: Fonts,
  label: string,
  value: string,
  x: number,
  y: number,
  size: number,
  wrapWidth?: number
) {
  const cleanLabel = sanitize(label);
  page.drawText(cleanLabel, { x, y, size, font: fonts.bold, color: BLACK });
  const labelWidth = fonts.bold.widthOfTextAtSize(cleanLabel, size) + 4;

  if (!wrapWidth) {
    page.drawText(sanitize(value), {
      x: x + labelWidth,
      y,
      size,
      font: fonts.regular,
      color: BLACK,
    });
    return;
  }

  const lines = wrapText(value, fonts.regular, size, wrapWidth - labelWidth, 2);
  let lineY = y;
  for (const line of lines) {
    page.drawText(sanitize(line), {
      x: x + labelWidth,
      y: lineY,
      size,
      font: fonts.regular,
      color: BLACK,
    });
    lineY -= size + 2;
  }
}

/**
 * Corta el texto en líneas que entren en `maxWidth`, hasta `maxLines`.
 * Lo que sobra se recorta con puntos suspensivos: es preferible un
 * nombre de producto acortado a un renglón que se pise con el de al
 * lado.
 */
function wrapText(
  value: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  maxLines: number
): string[] {
  const clean = sanitize(value).trim() || NOT_REQUIRED;
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }

  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === 0) return [clean];

  // Si quedó texto sin ubicar, se recorta la última línea.
  const rendered = lines.join(" ");
  if (rendered.length < clean.length) {
    let last = lines[lines.length - 1];
    while (last.length > 1 && font.widthOfTextAtSize(`${last}...`, size) > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = `${last}...`;
  }

  return lines;
}

/**
 * Las fuentes estándar de un PDF usan WinAnsi, que cubre Latin-1 pero
 * no, por ejemplo, las comillas tipográficas o el guion largo. pdf-lib
 * tira una excepción ante un carácter que no puede codificar, así que
 * se normaliza todo ANTES de dibujar: un nombre de producto con un
 * carácter raro no puede impedir que se emita el comprobante.
 */
function sanitize(value: string): string {
  return (value ?? "")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

function formatVoucherNumber(invoice: InvoicePdfInvoice): string {
  return `${pad(invoice.salesPoint, 5)}-${pad(invoice.voucherNumber, 8)}`;
}

function formatMoney(amount: number): string {
  return `$ ${Number(amount).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Alícuota derivada de los importes. Se redondea a las alícuotas reales
 * de ARCA (21, 10.5, 27, 5, 2.5, 0) cuando el cálculo cae cerca de una,
 * para que un centavo de redondeo no imprima "IVA 20,99%".
 */
function formatVatRate(netAmount: number, vatAmount: number): string {
  if (!netAmount) return "";
  const rate = (vatAmount / netAmount) * 100;
  const known = [0, 2.5, 5, 10.5, 21, 27].find((candidate) => Math.abs(rate - candidate) < 0.15);
  const value = known ?? Math.round(rate * 10) / 10;
  return `${value.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%`;
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity)
    ? String(quantity)
    : quantity.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** yyyy-mm-dd -> dd/mm/yyyy, sin pasar por Date (evita corrimientos de zona). */
function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? "");
  if (!match) return isoDate ?? NOT_REQUIRED;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

function formatCuit(digits: string): string {
  const clean = (digits ?? "").replace(/\D/g, "");
  if (clean.length !== 11) return clean || NOT_REQUIRED;
  return `${clean.slice(0, 2)}-${clean.slice(2, 10)}-${clean.slice(10)}`;
}

function formatAddress(issuer: CompleteBusinessSettings): string {
  return [
    issuer.addressStreet,
    issuer.addressCity,
    issuer.addressProvince,
    issuer.addressPostalCode ? `CP ${issuer.addressPostalCode}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}
