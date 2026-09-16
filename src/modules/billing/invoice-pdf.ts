import "server-only";
import { readFile } from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont, type PDFImage } from "pdf-lib";
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
  /** Código del producto (SKU). "-" si no se puede resolver. */
  code: string;
  description: string;
  quantity: number;
  /** Neto en Factura A, con IVA incluido en Factura B (ver el service). */
  unitPrice: number;
  lineAmount: number;
  /** Alícuota del renglón. Solo se imprime en Factura A. */
  vatRate: number | null;
  /** Importe del renglón con IVA. Solo se imprime en Factura A. */
  lineAmountWithVat: number | null;
}

export interface InvoicePdfInvoice {
  invoiceType: string; // "A" | "B" | "C"
  voucherTypeCode: number;
  salesPoint: number;
  voucherNumber: number;
  issueDate: string; // yyyy-mm-dd
  /** Hora de emisión ("8:39:00"), si se conoce. */
  issueTime: string | null;
  cae: string;
  caeDueDate: string; // yyyy-mm-dd
  customerName: string;
  buyerDocumentLabel: string; // "CUIT" | "Nro. Doc."
  buyerDocumentNumber: string | null;
  buyerIvaCondition: string | null;
  /**
   * Leyenda obligatoria según el receptor (hoy: Factura A a monotributista,
   * RG 5003/2021). La decide invoice-decision.ts; acá solo se imprime.
   */
  legend: string | null;
  buyerAddress: string | null;
  buyerCity: string | null;
  paymentMethod: string | null;
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
//
// El layout replica el comprobante que Casa Periotti ya venía emitiendo
// con su sistema anterior: mismos bloques, mismos rótulos y las mismas
// columnas de detalle (que cambian según la letra).
// ---------------------------------------------------------------
const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const CONTENT_RIGHT = MARGIN + CONTENT_WIDTH;
const CENTER_X = PAGE_WIDTH / 2;

const HEADER_TOP = PAGE_HEIGHT - MARGIN - 20;
const HEADER_HEIGHT = 96;
const BUYER_BOX_HEIGHT = 40;
const TABLE_HEADER_HEIGHT = 14;
const ROW_LINE_HEIGHT = 10;

// Alto reservado al pie de la ÚLTIMA hoja: totales, leyenda del régimen
// de transparencia fiscal, QR, ARCA, CAE y código de barras. Los
// renglones del detalle nunca invaden esta zona.
const FOOTER_HEIGHT = 130;
const CONTINUATION_FOOTER_HEIGHT = 36;

const BLACK = rgb(0, 0, 0);
const GREY = rgb(0.4, 0.4, 0.4);
const RED = rgb(0.75, 0.1, 0.1);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  boldItalic: PDFFont;
}

/** Columnas del detalle. Factura A discrimina IVA por renglón; B no. */
interface ItemColumns {
  codeX: number;
  descriptionX: number;
  descriptionWidth: number;
  quantityRight: number;
  unitPriceRight: number;
  lineAmountRight: number;
  vatRateRight: number | null;
  lineWithVatRight: number | null;
}

// Las posiciones están calculadas para que los ENCABEZADOS no se pisen,
// que es lo que manda el ancho: "SubTotal c/IVA" y "Precio Unitario"
// son más anchos que cualquiera de los importes que van debajo.
const COLUMNS_WITH_VAT: ItemColumns = {
  codeX: MARGIN + 4,
  descriptionX: MARGIN + 52,
  descriptionWidth: 205,
  quantityRight: MARGIN + 264,
  unitPriceRight: MARGIN + 360,
  lineAmountRight: MARGIN + 416,
  vatRateRight: MARGIN + 458,
  lineWithVatRight: CONTENT_RIGHT - 4,
};

const COLUMNS_PLAIN: ItemColumns = {
  codeX: MARGIN + 4,
  descriptionX: MARGIN + 52,
  descriptionWidth: 300,
  quantityRight: MARGIN + 380,
  unitPriceRight: MARGIN + 452,
  lineAmountRight: CONTENT_RIGHT - 4,
  vatRateRight: null,
  lineWithVatRight: null,
};

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
 * cambia según la letra — en Factura A los precios se muestran netos,
 * el IVA se discrimina por renglón y aparte; en Factura B se muestran
 * con IVA incluido y el IVA va como "IVA Contenido" del régimen de
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
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  const qrImage = await doc.embedPng(
    await QRCode.toBuffer(data.invoice.qrUrl, { type: "png", margin: 0, width: 320 })
  );

  const logo = await embedLogo(doc);

  const columns = data.invoice.invoiceType === "A" ? COLUMNS_WITH_VAT : COLUMNS_PLAIN;

  // Se pagina primero y se dibuja después: el "Hoja X de Y" del pie
  // necesita saber el total de hojas antes de escribir la primera.
  const pages = paginateItems(data.items, fonts, columns);

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const isLastPage = pageIndex === pages.length - 1;

    drawHeader(page, fonts, data, logo);
    drawBuyerBox(page, fonts, data);
    drawItemsTable(page, fonts, pages[pageIndex], columns, data.invoice.invoiceType);

    if (isLastPage) {
      drawTotalsAndFooter(page, fonts, data, qrImage);
    }

    if (pages.length > 1) {
      drawPageNumber(page, fonts, pageIndex + 1, pages.length);
    }
    if (data.invoice.environment !== "production") {
      drawTestingWarning(page, fonts);
    }
  }

  return doc.save();
}

/**
 * Logo del emisor para la cabecera del comprobante.
 *
 * Se busca en `public/` por orden de preferencia. Un PDF solo puede
 * embeber PNG o JPG (no SVG), así que para la factura hace falta uno
 * de esos dos formatos.
 *
 * Si no hay archivo devuelve null y la cabecera cae en el nombre de
 * fantasía en texto: que falte el logo no puede impedir emitir un
 * comprobante.
 */
async function embedLogo(doc: PDFDocument): Promise<PDFImage | null> {
  const candidates = ["logo.png", "logo@2x.png", "logo.jpg", "logo.jpeg"];

  for (const file of candidates) {
    try {
      const bytes = await readFile(path.join(process.cwd(), "public", file));
      return file.endsWith(".png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    } catch {
      // No está o no se puede leer: se prueba el siguiente.
    }
  }

  return null;
}

// ---------------------------------------------------------------
// Cabecera: emisor a la izquierda, letra al centro, datos del
// comprobante a la derecha.
// ---------------------------------------------------------------
function drawHeader(
  page: PDFPage,
  fonts: Fonts,
  data: InvoicePdfData,
  logo: PDFImage | null
) {
  const bottom = HEADER_TOP - HEADER_HEIGHT;
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
    start: { x: CENTER_X, y: HEADER_TOP },
    end: { x: CENTER_X, y: bottom },
    thickness: 1,
    color: BLACK,
  });

  // --- Emisor ---
  // Arriba a la izquierda va el logo si el archivo está disponible; si
  // no, el nombre de fantasía ocupa ese lugar (ver embedLogo).
  const leftX = MARGIN + 10;

  if (logo) {
    const maxWidth = 150;
    const maxHeight = 34;
    const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height, 1);
    page.drawImage(logo, {
      x: leftX + 4,
      y: HEADER_TOP - 14 - logo.height * scale,
      width: logo.width * scale,
      height: logo.height * scale,
    });
  } else {
    text(
      page,
      fonts.bold,
      (issuer.tradeName ?? issuer.legalName).toUpperCase(),
      leftX + 6,
      HEADER_TOP - 24,
      13
    );
  }

  let leftY = HEADER_TOP - 46;
  const issuerLines: [string, string][] = [
    ["Razón Social:", issuer.legalName],
    ["Domicilio:", issuer.addressStreet],
    ["Localidad:", issuer.addressCity.toUpperCase()],
    ["Email:", issuer.contactEmail ?? NOT_REQUIRED],
    ["Teléfono:", issuer.contactPhone ?? NOT_REQUIRED],
  ];
  for (const [label, value] of issuerLines) {
    labeled(page, fonts, label, value, leftX, leftY, 7.5);
    leftY -= 10;
  }

  // --- Letra del comprobante, en recuadro, a caballo del borde ---
  drawLetterBox(page, fonts, invoice);

  // --- Datos del comprobante ---
  const rightX = CENTER_X + 12;
  const rightHalfCenter = (CENTER_X + CONTENT_RIGHT) / 2;

  centeredText(page, fonts.regular, "Factura de Venta", rightHalfCenter, HEADER_TOP - 22, 15);
  centeredText(
    page,
    fonts.bold,
    formatVoucherNumber(invoice),
    rightHalfCenter,
    HEADER_TOP - 38,
    11
  );

  let rightY = HEADER_TOP - 56;
  const invoiceLines: [string, string][] = [
    [
      "Fecha y Hora Emisión:",
      `${formatDate(invoice.issueDate)}${invoice.issueTime ? `  ${invoice.issueTime}` : ""}`,
    ],
    ["CUIT:", formatCuit(issuer.cuitDigits)],
    ["Ingresos Brutos:", issuer.grossIncomeNumber ?? NOT_REQUIRED],
    [
      "Fecha de Inicio de Actividades:",
      issuer.activitiesStartDate ? formatDate(issuer.activitiesStartDate) : NOT_REQUIRED,
    ],
    ["Condición Frente al IVA:", ISSUER_IVA_CONDITION_LABELS[issuer.ivaCondition]],
  ];
  for (const [label, value] of invoiceLines) {
    labeled(page, fonts, label, value, rightX, rightY, 7.5);
    rightY -= 10;
  }
}

function drawLetterBox(page: PDFPage, fonts: Fonts, invoice: InvoicePdfInvoice) {
  const size = 52;
  const x = CENTER_X - size / 2;
  const y = HEADER_TOP - size / 2;

  // Relleno blanco: tapa la línea divisoria y el borde de la cabecera,
  // que es cómo se ve en el comprobante impreso.
  page.drawRectangle({
    x,
    y,
    width: size,
    height: size,
    color: rgb(1, 1, 1),
    borderColor: BLACK,
    borderWidth: 1,
  });

  centeredText(page, fonts.bold, invoice.invoiceType || "B", CENTER_X, y + 19, 30);
  centeredText(page, fonts.bold, `COD.${pad(invoice.voucherTypeCode, 3)}`, CENTER_X, y + 6, 6.5);
}

// ---------------------------------------------------------------
// Receptor: dos columnas de tres renglones, pegado a la cabecera.
// ---------------------------------------------------------------
function drawBuyerBox(page: PDFPage, fonts: Fonts, data: InvoicePdfData) {
  const { invoice } = data;
  const top = HEADER_TOP - HEADER_HEIGHT;
  const bottom = top - BUYER_BOX_HEIGHT;

  page.drawRectangle({
    x: MARGIN,
    y: bottom,
    width: CONTENT_WIDTH,
    height: BUYER_BOX_HEIGHT,
    borderColor: BLACK,
    borderWidth: 1,
  });

  // Consumidor Final sin identificar: la leyenda va en el lugar del
  // nombre, que es el campo que no se tiene.
  const isAnonymous = !invoice.buyerDocumentNumber || invoice.buyerDocumentLabel === "CF";
  const buyerName = isAnonymous ? "A CONSUMIDOR FINAL" : invoice.customerName;

  const leftX = MARGIN + 10;
  const rightX = CENTER_X + 12;
  let y = top - 12;

  const leftLines: [string, string][] = [
    ["A nombre de / Razón Social:", buyerName],
    ["Condición Frente al IVA:", invoice.buyerIvaCondition ?? "Consumidor Final"],
    ["Forma de Pago:", invoice.paymentMethod ?? NOT_REQUIRED],
  ];
  const rightLines: [string, string][] = [
    [
      `${isAnonymous ? "Nro. Doc." : invoice.buyerDocumentLabel}:`,
      isAnonymous
        ? NOT_REQUIRED
        : invoice.buyerDocumentLabel === "CUIT"
        ? formatCuit(invoice.buyerDocumentNumber ?? "")
        : invoice.buyerDocumentNumber ?? NOT_REQUIRED,
    ],
    ["Domicilio:", invoice.buyerAddress ?? NOT_REQUIRED],
    ["Localidad:", invoice.buyerCity?.toUpperCase() ?? NOT_REQUIRED],
  ];

  for (let i = 0; i < 3; i++) {
    labeled(page, fonts, leftLines[i][0], leftLines[i][1], leftX, y, 7.5, 240);
    labeled(page, fonts, rightLines[i][0], rightLines[i][1], rightX, y, 7.5, 240);
    y -= 11;
  }
}

// ---------------------------------------------------------------
// Detalle
// ---------------------------------------------------------------
interface PreparedRow {
  code: string;
  lines: string[];
  quantity: string;
  unitPrice: string;
  lineAmount: string;
  vatRate: string | null;
  lineWithVat: string | null;
  height: number;
}

function tableTop(): number {
  return HEADER_TOP - HEADER_HEIGHT - BUYER_BOX_HEIGHT - 8;
}

function paginateItems(
  items: InvoicePdfItem[],
  fonts: Fonts,
  columns: ItemColumns
): PreparedRow[][] {
  const rows = items.map<PreparedRow>((item) => {
    const lines = wrapText(item.description, fonts.regular, 7.5, columns.descriptionWidth, 2);
    return {
      code: item.code,
      lines,
      quantity: formatQuantity(item.quantity),
      unitPrice: formatMoney(item.unitPrice),
      lineAmount: formatMoney(item.lineAmount),
      vatRate: item.vatRate != null ? `${formatRate(item.vatRate)} %` : null,
      lineWithVat: item.lineAmountWithVat != null ? formatAmount(item.lineAmountWithVat) : null,
      height: lines.length * ROW_LINE_HEIGHT + 2,
    };
  });

  const top = tableTop() - TABLE_HEADER_HEIGHT;
  const lastPageSpace = top - MARGIN - FOOTER_HEIGHT;
  const middlePageSpace = top - MARGIN - CONTINUATION_FOOTER_HEIGHT;

  if (rows.length === 0) return [[]];

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
  columns: ItemColumns,
  invoiceType: string
) {
  const top = tableTop();
  const headerBottom = top - TABLE_HEADER_HEIGHT;
  const size = invoiceType === "A" ? 7 : 7.5;
  const headerY = headerBottom + 4;

  text(page, fonts.bold, "Código", columns.codeX, headerY, size);
  text(page, fonts.bold, "Producto / Servicio", columns.descriptionX, headerY, size);
  rightText(page, fonts.bold, "Cantidad", columns.quantityRight, headerY, size);
  rightText(page, fonts.bold, "Precio Unitario", columns.unitPriceRight, headerY, size);
  rightText(page, fonts.bold, "SubTotal", columns.lineAmountRight, headerY, size);
  if (columns.vatRateRight != null) {
    rightText(page, fonts.bold, "Alic. IVA", columns.vatRateRight, headerY, size);
  }
  if (columns.lineWithVatRight != null) {
    rightText(page, fonts.bold, "SubTotal c/IVA", columns.lineWithVatRight, headerY, size);
  }

  page.drawLine({
    start: { x: MARGIN, y: headerBottom },
    end: { x: CONTENT_RIGHT, y: headerBottom },
    thickness: 0.75,
    color: BLACK,
  });

  let y = headerBottom - 2;

  for (const row of rows) {
    const firstLineY = y - ROW_LINE_HEIGHT + 2;

    text(page, fonts.regular, row.code, columns.codeX, firstLineY, 7.5);

    let lineY = firstLineY;
    for (const line of row.lines) {
      text(page, fonts.regular, line, columns.descriptionX, lineY, 7.5);
      lineY -= ROW_LINE_HEIGHT;
    }

    rightText(page, fonts.regular, row.quantity, columns.quantityRight, firstLineY, 7.5);
    rightText(page, fonts.regular, row.unitPrice, columns.unitPriceRight, firstLineY, 7.5);
    rightText(page, fonts.regular, row.lineAmount, columns.lineAmountRight, firstLineY, 7.5);
    if (row.vatRate && columns.vatRateRight != null) {
      rightText(page, fonts.regular, row.vatRate, columns.vatRateRight, firstLineY, 7.5);
    }
    if (row.lineWithVat && columns.lineWithVatRight != null) {
      rightText(page, fonts.regular, row.lineWithVat, columns.lineWithVatRight, firstLineY, 7.5);
    }

    y -= row.height;
  }
}

// ---------------------------------------------------------------
// Totales, leyendas y pie de autorización
// ---------------------------------------------------------------
function drawTotalsAndFooter(
  page: PDFPage,
  fonts: Fonts,
  data: InvoicePdfData,
  qrImage: Awaited<ReturnType<PDFDocument["embedPng"]>>
) {
  const { invoice, issuer } = data;
  const discriminatesVat = invoice.invoiceType === "A";

  // Recuadro del bloque inferior: totales a la derecha y, en los
  // comprobantes que no discriminan IVA, la leyenda del régimen de
  // transparencia fiscal a la izquierda.
  const boxTop = MARGIN + 118;
  const boxBottom = MARGIN + 56;

  page.drawRectangle({
    x: MARGIN,
    y: boxBottom,
    width: CONTENT_WIDTH,
    height: boxTop - boxBottom,
    borderColor: BLACK,
    borderWidth: 0.75,
  });

  let y = boxTop - 12;

  if (discriminatesVat) {
    rightLabeled(page, fonts, "Importe Neto Gravado:", formatMoney(invoice.subtotal), y, 8.5);
    y -= 11;
    rightLabeled(
      page,
      fonts,
      `IVA ${formatVatRate(invoice.subtotal, invoice.vatAmount)}:`,
      formatMoney(invoice.vatAmount),
      y,
      8.5
    );
    y -= 11;
  } else {
    rightLabeled(page, fonts, "Subtotal:", formatMoney(invoice.total), y, 8.5);
    y -= 11;
  }

  // Siempre en cero en Casa Periotti, pero el comprobante los informa
  // igual: es lo que figuraba en el impreso del sistema anterior.
  rightLabeled(page, fonts, "Impuestos Internos:", formatMoney(0), y, 8.5);
  y -= 13;

  rightLabeled(page, fonts, "Importe Total:", formatMoney(invoice.total), y, 10, true);

  // Régimen de Transparencia Fiscal al Consumidor (Ley 27.743): en los
  // comprobantes que no discriminan IVA hay que informar igual cuánto
  // del total es IVA.
  if (!discriminatesVat) {
    const legendCenter = MARGIN + 150;
    const ivaContenido = invoice.ivaContenido ?? invoice.vatAmount;
    let legendY = boxTop - 12;

    centeredText(
      page,
      fonts.bold,
      "Régimen de Transparencia Fiscal al Consumidor (Ley 27.743)",
      legendCenter,
      legendY,
      7.5
    );
    legendY -= 4;
    page.drawLine({
      start: { x: MARGIN + 20, y: legendY },
      end: { x: MARGIN + 280, y: legendY },
      thickness: 0.5,
      color: BLACK,
    });
    legendY -= 12;
    centeredText(
      page,
      fonts.bold,
      `IVA Contenido: ${formatMoney(ivaContenido)}`,
      legendCenter,
      legendY,
      7.5
    );
    legendY -= 11;
    centeredText(
      page,
      fonts.bold,
      `Otros Impuestos Nacionales: ${formatMoney(0)}`,
      legendCenter,
      legendY,
      7.5
    );
  }

  // Factura A a monotributista: leyenda obligatoria de la RG 5003/2021,
  // completa (nunca recortada), a la izquierda de los totales.
  if (discriminatesVat && invoice.legend) {
    const lines = wrapText(invoice.legend, fonts.bold, 6.5, 270, 6);
    let legendY = boxTop - 14;
    for (const line of lines) {
      text(page, fonts.bold, line, MARGIN + 8, legendY, 6.5);
      legendY -= 8.5;
    }
  }

  // --- Pie de autorización ---
  // La banda de abajo (0 a ~90) se reparte así: QR a la izquierda, el
  // bloque de ARCA al lado, el CAE arriba a la derecha y el código de
  // barras sobre el CAE — separados para que la leyenda larga de ARCA
  // no se cruce con las barras.
  const qrSize = 66;
  page.drawImage(qrImage, { x: MARGIN, y: 14, width: qrSize, height: qrSize });

  const arcaX = MARGIN + qrSize + 8;
  text(page, fonts.bold, "ARCA", arcaX, 58, 15, GREY);
  text(page, fonts.regular, "AGENCIA DE RECAUDACIÓN", arcaX + 46, 64, 6, GREY);
  text(page, fonts.regular, "Y CONTROL ADUANERO", arcaX + 46, 57, 6, GREY);
  text(page, fonts.boldItalic, "Comprobante Autorizado", arcaX, 42, 8.5);
  text(
    page,
    fonts.italic,
    "Esta Administración Federal no se responsabiliza por los datos ingresados en el detalle de la operación",
    arcaX,
    22,
    5.5
  );

  rightLabeled(page, fonts, "CAE N°:", invoice.cae, 46, 8.5, true);
  rightLabeled(page, fonts, "Fecha de Vto. de CAE:", formatDate(invoice.caeDueDate), 33, 8.5, true);

  // Código de barras obligatorio en todo comprobante impreso (RG 1702).
  // Si los datos no permitieran armarlo, se imprime el aviso en lugar
  // de romper el PDF: el resto del comprobante sigue siendo válido y el
  // problema queda visible para corregirlo.
  try {
    const barcodeInput: InvoiceBarcodeInput = {
      cuitDigits: issuer.cuitDigits,
      voucherTypeCode: invoice.voucherTypeCode,
      salesPoint: invoice.salesPoint,
      cae: invoice.cae,
      caeDueDate: invoice.caeDueDate,
    };
    drawBarcode(page, fonts, buildInvoiceBarcodeDigits(barcodeInput));
  } catch (err) {
    console.error("[invoice-pdf] No se pudo generar el código de barras:", err);
    rightText(page, fonts.regular, "No se pudo generar el código de barras.", CONTENT_RIGHT - 6, 62, 6, RED);
  }
}

/** Código de barras arriba a la derecha, sobre el bloque del CAE. */
function drawBarcode(page: PDFPage, fonts: Fonts, digits: string) {
  const width = 230;
  const height = 18;
  const x = CONTENT_RIGHT - width - 6;
  const { bars, totalWidth } = interleaved2of5Geometry(digits);
  const moduleWidth = width / totalWidth;

  for (const bar of bars) {
    page.drawRectangle({
      x: x + bar.offset * moduleWidth,
      y: 66,
      width: bar.width * moduleWidth,
      height,
      color: BLACK,
    });
  }

  // Los dígitos impresos debajo permiten cargarlo a mano si el lector
  // no llega a leer el código.
  text(page, fonts.regular, digits, x, 59, 6);
}

// ---------------------------------------------------------------
// Avisos y numeración de hojas
// ---------------------------------------------------------------
function drawPageNumber(page: PDFPage, fonts: Fonts, pageNumber: number, pageCount: number) {
  rightText(
    page,
    fonts.regular,
    `Hoja ${pageNumber} de ${pageCount}`,
    CONTENT_RIGHT,
    PAGE_HEIGHT - MARGIN - 10,
    7,
    GREY
  );
}

function drawTestingWarning(page: PDFPage, fonts: Fonts) {
  centeredText(
    page,
    fonts.bold,
    "AMBIENTE DE HOMOLOGACIÓN - COMPROBANTE SIN VALIDEZ FISCAL",
    CENTER_X,
    PAGE_HEIGHT - MARGIN - 10,
    9,
    RED
  );
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
  page.drawText(clean, { x: xRight - font.widthOfTextAtSize(clean, size), y, size, font, color });
}

function centeredText(
  page: PDFPage,
  font: PDFFont,
  value: string,
  xCenter: number,
  y: number,
  size: number,
  color = BLACK
) {
  const clean = sanitize(value);
  page.drawText(clean, {
    x: xCenter - font.widthOfTextAtSize(clean, size) / 2,
    y,
    size,
    font,
    color,
  });
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
  const labelWidth = fonts.bold.widthOfTextAtSize(cleanLabel, size) + 3;

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

  const lines = wrapText(value, fonts.regular, size, wrapWidth - labelWidth, 1);
  page.drawText(sanitize(lines[0] ?? ""), {
    x: x + labelWidth,
    y,
    size,
    font: fonts.regular,
    color: BLACK,
  });
}

/**
 * Renglón de totales: etiqueta y valor pegados al margen derecho, con la
 * etiqueta en negrita — igual que en el comprobante impreso.
 */
function rightLabeled(
  page: PDFPage,
  fonts: Fonts,
  label: string,
  value: string,
  y: number,
  size: number,
  emphasizeValue = false
) {
  const valueFont = emphasizeValue ? fonts.bold : fonts.regular;
  const cleanValue = sanitize(value);
  const valueWidth = valueFont.widthOfTextAtSize(cleanValue, size);
  const xRight = CONTENT_RIGHT - 6;

  page.drawText(cleanValue, { x: xRight - valueWidth, y, size, font: valueFont, color: BLACK });

  const cleanLabel = sanitize(label);
  page.drawText(cleanLabel, {
    x: xRight - valueWidth - 4 - fonts.bold.widthOfTextAtSize(cleanLabel, size),
    y,
    size,
    font: fonts.bold,
    color: BLACK,
  });
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
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return [clean];

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
  if (lines.length === 0) lines.push(clean);

  // Si quedó texto sin ubicar, se recorta la última línea.
  if (lines.join(" ").length < clean.length) {
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
    .replace(/ /g, " ")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, "0");
}

function formatVoucherNumber(invoice: InvoicePdfInvoice): string {
  return `${pad(invoice.salesPoint, 5)} - ${pad(invoice.voucherNumber, 8)}`;
}

/** Importe con separador de miles y dos decimales, sin signo. */
function formatAmount(amount: number): string {
  return Number(amount).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMoney(amount: number): string {
  return `$ ${formatAmount(amount)}`;
}

function formatRate(rate: number): string {
  return Number(rate).toLocaleString("es-AR", { maximumFractionDigits: 1 });
}

/**
 * Alícuota derivada de los importes totales. Se redondea a las
 * alícuotas reales de ARCA cuando el cálculo cae cerca de una, para que
 * un centavo de redondeo no imprima "IVA 20,99%".
 */
function formatVatRate(netAmount: number, vatAmount: number): string {
  if (!netAmount) return "";
  const rate = (vatAmount / netAmount) * 100;
  const known = [0, 2.5, 5, 10.5, 21, 27].find((candidate) => Math.abs(rate - candidate) < 0.15);
  return `${formatRate(known ?? Math.round(rate * 10) / 10)}%`;
}

function formatQuantity(quantity: number): string {
  return Number(quantity).toLocaleString("es-AR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
