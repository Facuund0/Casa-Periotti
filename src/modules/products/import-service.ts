import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "@/shared/utils/slugify";
import { netFromGross } from "./pricing";
import { productSchema } from "./schemas";
import { ProductAdminService } from "./product-admin-service";
import { StockService } from "@/modules/stock/stock-service";

/**
 * Importar productos desde una planilla (CSV guardado desde Excel).
 *
 * Reglas de esta importación:
 *  - Siempre se puede SIMULAR primero: se valida todo y se informa qué
 *    haría, sin escribir nada.
 *  - Se identifica por SKU: si ya existe, se actualiza; si no, se crea.
 *  - Los precios se cargan NETOS, igual que en el formulario del panel:
 *    el precio con IVA lo calcula el servidor (ver pricing.ts).
 *  - El stock, si la planilla lo trae, se mueve por el MISMO camino que
 *    un ajuste del panel (adjust_stock), que deja su movimiento de
 *    inventario: nunca se pisa el número de stock a mano. La columna
 *    dice cuánto hay, no cuánto sumar, y si está vacía no se toca nada.
 *  - Si una fila tiene un error, se informa esa fila y las demás siguen.
 */

export interface ImportRowResult {
  line: number;
  sku: string;
  name: string;
  action: "crear" | "actualizar" | "error";
  message?: string;
  /** Qué pasó con el stock de esta fila, si la planilla lo traía. */
  stockNote?: string;
}

export interface ImportSummary {
  dryRun: boolean;
  created: number;
  updated: number;
  failed: number;
  rows: ImportRowResult[];
}

/** Encabezados aceptados, sin distinguir mayúsculas, tildes ni espacios. */
const COLUMNS: Record<string, string[]> = {
  sku: ["sku", "codigo", "código"],
  name: ["nombre", "producto", "descripcion corta"],
  category: ["categoria", "categoría", "rubro"],
  priceRetailNet: ["precio minorista sin iva", "precio minorista", "minorista"],
  priceWholesaleNet: ["precio mayorista sin iva", "precio mayorista", "mayorista"],
  vatRate: ["iva", "iva %", "alicuota", "alícuota"],
  unit: ["unidad", "unidad de medida"],
  stockMinimum: ["stock minimo", "stock mínimo"],
  wholesaleMinQuantity: ["minimo mayorista", "mínimo mayorista", "cantidad minima mayorista"],
  costNet: ["costo", "costo sin iva", "precio de costo"],
  barcode: ["codigo de barras", "código de barras", "barras", "ean"],
  decimalQuantity: ["decimales", "permite decimales", "se vende con decimales"],
  stock: ["stock", "cantidad", "stock actual", "existencias"],
  brand: ["marca"],
  description: ["descripcion", "descripción", "detalle"],
};

/** Para los errores: el nombre del campo tal como se llama en la planilla. */
function columnLabel(field: string): string {
  return COLUMNS[field]?.[0] ?? field;
}

function normalizeHeader(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Detecta el separador mirando el encabezado: Excel en español usa ";". */
function detectDelimiter(headerLine: string): string {
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  const tabs = (headerLine.match(/\t/g) ?? []).length;
  if (tabs > semicolons && tabs > commas) return "\t";
  return commas > semicolons ? "," : ";";
}

/** Parte una línea respetando los campos entre comillas. */
function splitLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

/** "1.234,56" y "1234.56" llegan los dos: se devuelve con punto decimal. */
/** Las cantidades de stock se manejan con 3 decimales (migración 0028). */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function normalizeNumber(value: string): string {
  const clean = value.replace(/\s/g, "");
  if (!clean) return "";
  if (clean.includes(",") && clean.includes(".")) return clean.replace(/\./g, "").replace(",", ".");
  return clean.replace(",", ".");
}

export class ProductImportService {
  constructor(
    private readonly adminDb: SupabaseClient,
    private readonly employee: { id: string; role: string }
  ) {}

  /** Plantilla con los encabezados y una fila de ejemplo. */
  static template(): string {
    const header = [
      "SKU",
      "Nombre",
      "Categoria",
      "Marca",
      "Precio minorista sin IVA",
      "Precio mayorista sin IVA",
      "IVA",
      "Unidad",
      "Stock",
      "Stock minimo",
      "Minimo mayorista",
      "Costo sin IVA",
      "Codigo de barras",
      "Decimales",
      "Descripcion",
    ].join(";");
    const aviso =
      "# Las filas que empiezan con # son ejemplos y NO se importan. Borralas o dejalas, da igual.";
    // Un producto por unidad y otro que se vende medido, que son los dos
    // casos que aparecen en el mostrador.
    const ejemplos = [
      [
        "#CEM-50",
        "Cemento Loma Negra 50 kg",
        "Construcción",
        "Loma Negra",
        "9500,00",
        "8200,00",
        "21",
        "bolsa",
        "120",
        "10",
        "20",
        "7100,00",
        "7791234567890",
        "no",
        "Cemento de uso general",
      ].join(";"),
      [
        "#ARENA-M3",
        "Arena fina",
        "Construcción",
        "",
        "18000,00",
        "16000,00",
        "21",
        "m3",
        "18,5",
        "5",
        "3",
        "12000,00",
        "",
        "si",
        "Se vende por metro cúbico, admite 2,5",
      ].join(";"),
    ];
    return [`\ufeff${header}`, aviso, ...ejemplos, ""].join("\r\n");
  }

  async import(csv: string, options: { dryRun: boolean }): Promise<ImportSummary> {
    const lines = csv
      .replace(/^﻿/, "")
      .split(/\r?\n/)
      .filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      throw new Error("El archivo no tiene filas: se esperaba el encabezado y al menos un producto.");
    }

    const delimiter = detectDelimiter(lines[0]);
    const headers = splitLine(lines[0], delimiter).map(normalizeHeader);

    // Índice de cada campo según el encabezado.
    const index: Record<string, number> = {};
    for (const [field, names] of Object.entries(COLUMNS)) {
      const found = headers.findIndex((h) => names.includes(h));
      if (found >= 0) index[field] = found;
    }
    // Lo único imprescindible es el SKU: es con lo que se reconoce cada
    // producto. Las demás columnas pueden no estar, y entonces esos datos
    // quedan como están (si el producto es nuevo se avisa fila por fila).
    if (index.sku === undefined) {
      throw new Error(
        `Falta la columna "${COLUMNS.sku[0].toUpperCase()}" en el encabezado. Descargá la plantilla y usá esos títulos.`
      );
    }

    // Categorías y productos existentes. De los productos se traen TODOS
    // los campos que la planilla puede tocar: una celda vacía en un
    // producto que ya existe no borra ni pone en cero lo que estaba
    // cargado, deja lo que hay.
    const [{ data: categories }, { data: existing }] = await Promise.all([
      this.adminDb.from("categories").select("id, name, slug"),
      this.adminDb
        .from("products")
        .select(
          "id, sku, name, slug, description, brand, category_id, price_retail, price_wholesale, vat_rate, unit, stock_minimum, wholesale_min_quantity, cost_net, barcode, decimal_quantity, stock_quantity, stock_reserved"
        ),
    ]);
    const categoryByKey = new Map<string, string>();
    for (const c of categories ?? []) {
      categoryByKey.set(normalizeHeader(c.name), c.id);
      categoryByKey.set(normalizeHeader(c.slug), c.id);
    }
    const existingBySku = new Map((existing ?? []).map((p) => [p.sku.toLowerCase(), p]));

    const service = new ProductAdminService(this.adminDb, this.employee);
    const summary: ImportSummary = { dryRun: options.dryRun, created: 0, updated: 0, failed: 0, rows: [] };
    const seenSkus = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      // Las filas que empiezan con # son comentarios: así la plantilla
      // puede traer ejemplos sin que se carguen como productos si alguien
      // se olvida de borrarlos.
      if (lines[i].trimStart().startsWith("#")) continue;

      const cells = splitLine(lines[i], delimiter);
      const get = (field: string) => (index[field] === undefined ? "" : (cells[index[field]] ?? "").trim());
      const sku = get("sku");
      const line = i + 1;

      const fail = (message: string) => {
        summary.failed += 1;
        summary.rows.push({ line, sku, name: get("name"), action: "error", message });
      };

      if (!sku) {
        fail("Falta el SKU: es con lo que se reconoce cada producto.");
        continue;
      }
      if (seenSkus.has(sku.toLowerCase())) {
        fail(`El SKU ${sku} aparece más de una vez en el archivo.`);
        continue;
      }
      seenSkus.add(sku.toLowerCase());

      // Lo que el producto ya tiene cargado. Cada celda vacía de la
      // planilla se completa con esto, así una planilla que solo trae
      // códigos de barras no toca precios ni nombres.
      const current = existingBySku.get(sku.toLowerCase());
      const currentVat = current ? Number(current.vat_rate) : 21;

      const name = get("name") || (current?.name as string) || "";
      if (!name) {
        fail("Falta el nombre: el producto no existe todavía y hay que cargarlo.");
        continue;
      }

      const categoryValue = get("category");
      const categoryId = categoryValue
        ? categoryByKey.get(normalizeHeader(categoryValue))
        : (current?.category_id as string | undefined);
      if (!categoryId) {
        fail(
          categoryValue
            ? `No existe la categoría "${categoryValue}". Creala primero en Categorías.`
            : "Falta la categoría: el producto no existe todavía y hay que decir en qué categoría va."
        );
        continue;
      }

      // "dejalo como está": la celda vacía usa el valor que ya tiene el
      // producto. Los precios se guardan CON IVA y la planilla los carga
      // netos, así que el actual se convierte a neto (ver pricing.ts).
      const keep = (field: string, fallback: string): string =>
        normalizeNumber(get(field)) || fallback;

      const retailNet = keep(
        "priceRetailNet",
        current ? String(netFromGross(Number(current.price_retail), currentVat)) : ""
      );
      if (!retailNet) {
        fail("Falta el precio minorista: el producto no existe todavía y hay que cargarlo.");
        continue;
      }

      const parsed = productSchema.safeParse({
        sku,
        name,
        // El slug de un producto que ya existe no se cambia: es su
        // dirección en la web y cambiarla rompería los links.
        slug: (current?.slug as string) || slugify(name),
        description: get("description") || current?.description || "",
        brand: get("brand") || current?.brand || "",
        categoryId,
        priceRetailNet: retailNet,
        priceWholesaleNet: keep(
          "priceWholesaleNet",
          current ? String(netFromGross(Number(current.price_wholesale), currentVat)) : retailNet
        ),
        vatRate: keep("vatRate", String(currentVat)),
        unit: get("unit") || current?.unit || "unidad",
        stockMinimum: keep("stockMinimum", current ? String(current.stock_minimum) : "0"),
        wholesaleMinQuantity: keep(
          "wholesaleMinQuantity",
          current ? String(current.wholesale_min_quantity ?? 1) : "1"
        ),
        costNet: keep("costNet", current?.cost_net != null ? String(current.cost_net) : ""),
        barcode: get("barcode") || current?.barcode || "",
        // "si", "x", "1" o "true" habilitan los decimales. Vacío deja lo
        // que el producto ya tenía (en uno nuevo, sin decimales).
        decimalQuantity: get("decimalQuantity")
          ? ["si", "sí", "x", "1", "true", "on"].includes(get("decimalQuantity").toLowerCase())
          : Boolean(current?.decimal_quantity),
      });
      if (!parsed.success) {
        fail(
          parsed.error.issues
            .map((issue) => `${columnLabel(String(issue.path[0]))}: ${issue.message}`)
            .join(" · ")
        );
        continue;
      }

      const existingId = current?.id as string | undefined;
      const action = existingId ? "actualizar" : "crear";

      // La columna Stock dice CUÁNTO HAY, no cuánto sumar: se calcula la
      // diferencia contra lo que figura y se mueve esa diferencia, que es
      // lo que queda registrado en el inventario.
      const stockCell = normalizeNumber(get("stock"));
      const target = stockCell ? Number(stockCell) : null;
      if (target !== null && (!Number.isFinite(target) || target < 0)) {
        fail("El stock no puede ser negativo.");
        continue;
      }
      const currentStock = current ? Number(current.stock_quantity) : 0;
      const reserved = current ? Number(current.stock_reserved) : 0;
      const delta = target === null ? 0 : round3(target - currentStock);

      // Bajar el stock por debajo de lo reservado dejaría pedidos sin
      // mercadería: se avisa acá, con el número, en vez de que falle la
      // base con un mensaje técnico.
      if (target !== null && target < reserved) {
        fail(
          `No se puede dejar el stock en ${target}: hay ${reserved} reservadas en pedidos esperando pago.`
        );
        continue;
      }
      if (target !== null && !parsed.data.decimalQuantity && delta !== Math.round(delta)) {
        fail("Ese producto se vende por unidades enteras: el stock no puede tener decimales.");
        continue;
      }

      const stockNote =
        target === null
          ? undefined
          : delta === 0
            ? `stock sin cambios (${currentStock})`
            : `stock ${currentStock} → ${target}`;

      let productId = existingId;
      if (!options.dryRun) {
        try {
          if (existingId) await service.update(existingId, parsed.data);
          else productId = await service.create(parsed.data);
        } catch (err) {
          fail(err instanceof Error ? err.message : "No se pudo guardar");
          continue;
        }
      }

      // El movimiento de stock va después de guardar el producto, y por
      // el mismo servicio que usa el panel: queda su fila en el
      // inventario, con el motivo y el empleado.
      let stockWarning: string | undefined;
      if (!options.dryRun && productId && delta !== 0) {
        try {
          await new StockService(this.adminDb).manualAdjustment({
            productId,
            quantityDelta: delta,
            movementType: existingId ? "ajuste" : "entrada_compra",
            reason: existingId
              ? "Ajuste por importación de planilla"
              : "Carga inicial de stock por importación de planilla",
            employeeId: this.employee.id,
          });
        } catch (err) {
          // El producto sí quedó guardado: se informa que lo único que
          // faltó fue el stock, para poder corregirlo a mano.
          stockWarning = `el producto se guardó, pero el stock no se pudo mover: ${
            err instanceof Error ? err.message : "error desconocido"
          }`;
        }
      }

      if (action === "crear") summary.created += 1;
      else summary.updated += 1;
      summary.rows.push({
        line,
        sku,
        name,
        action,
        stockNote: stockWarning ?? stockNote,
        message: stockWarning,
      });
    }

    return summary;
  }
}
