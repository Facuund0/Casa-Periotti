import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { slugify } from "@/shared/utils/slugify";
import { productSchema } from "./schemas";
import { ProductAdminService } from "./product-admin-service";

/**
 * Importar productos desde una planilla (CSV guardado desde Excel).
 *
 * Reglas de esta importación:
 *  - Siempre se puede SIMULAR primero: se valida todo y se informa qué
 *    haría, sin escribir nada.
 *  - Se identifica por SKU: si ya existe, se actualiza; si no, se crea.
 *  - Los precios se cargan NETOS, igual que en el formulario del panel:
 *    el precio con IVA lo calcula el servidor (ver pricing.ts).
 *  - NO toca stock. El stock se mueve solo con movimientos de inventario
 *    (ajuste o entrada por compra), para no perder la trazabilidad.
 *  - Si una fila tiene un error, se informa esa fila y las demás siguen.
 */

export interface ImportRowResult {
  line: number;
  sku: string;
  name: string;
  action: "crear" | "actualizar" | "error";
  message?: string;
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
      "Stock minimo",
      "Minimo mayorista",
      "Costo sin IVA",
      "Codigo de barras",
      "Decimales",
      "Descripcion",
    ].join(";");
    const example = [
      "CEM-50",
      "Cemento Loma Negra 50 kg",
      "Construcción",
      "Loma Negra",
      "9500,00",
      "8200,00",
      "21",
      "bolsa",
      "10",
      "20",
      "7100,00",
      "7791234567890",
      "no",
      "Cemento de uso general",
    ].join(";");
    return `﻿${header}\r\n${example}\r\n`;
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
    for (const required of ["sku", "name", "category", "priceRetailNet"]) {
      if (index[required] === undefined) {
        throw new Error(
          `Falta la columna "${COLUMNS[required][0]}" en el encabezado. Descargá la plantilla y usá esos títulos.`
        );
      }
    }

    // Categorías y productos existentes, para resolver por nombre y por SKU.
    const [{ data: categories }, { data: existing }] = await Promise.all([
      this.adminDb.from("categories").select("id, name, slug"),
      this.adminDb.from("products").select("id, sku"),
    ]);
    const categoryByKey = new Map<string, string>();
    for (const c of categories ?? []) {
      categoryByKey.set(normalizeHeader(c.name), c.id);
      categoryByKey.set(normalizeHeader(c.slug), c.id);
    }
    const productIdBySku = new Map((existing ?? []).map((p) => [p.sku.toLowerCase(), p.id]));

    const service = new ProductAdminService(this.adminDb, this.employee);
    const summary: ImportSummary = { dryRun: options.dryRun, created: 0, updated: 0, failed: 0, rows: [] };
    const seenSkus = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const cells = splitLine(lines[i], delimiter);
      const get = (field: string) => (index[field] === undefined ? "" : (cells[index[field]] ?? "").trim());
      const sku = get("sku");
      const name = get("name");
      const line = i + 1;

      const fail = (message: string) => {
        summary.failed += 1;
        summary.rows.push({ line, sku, name, action: "error", message });
      };

      if (!sku || !name) {
        fail("Falta el SKU o el nombre.");
        continue;
      }
      if (seenSkus.has(sku.toLowerCase())) {
        fail(`El SKU ${sku} aparece más de una vez en el archivo.`);
        continue;
      }
      seenSkus.add(sku.toLowerCase());

      const categoryValue = get("category");
      const categoryId = categoryByKey.get(normalizeHeader(categoryValue));
      if (!categoryId) {
        fail(`No existe la categoría "${categoryValue}". Creala primero en Categorías.`);
        continue;
      }

      const parsed = productSchema.safeParse({
        sku,
        name,
        slug: slugify(name),
        description: get("description"),
        brand: get("brand"),
        categoryId,
        priceRetailNet: normalizeNumber(get("priceRetailNet")),
        priceWholesaleNet: normalizeNumber(get("priceWholesaleNet")) || normalizeNumber(get("priceRetailNet")),
        vatRate: normalizeNumber(get("vatRate")) || "21",
        unit: get("unit") || "unidad",
        stockMinimum: normalizeNumber(get("stockMinimum")) || "0",
        wholesaleMinQuantity: normalizeNumber(get("wholesaleMinQuantity")) || "1",
        costNet: normalizeNumber(get("costNet")),
        barcode: get("barcode"),
        // "si", "x", "1" o "true" habilitan los decimales; vacío = no.
        decimalQuantity: ["si", "sí", "x", "1", "true", "on"].includes(
          get("decimalQuantity").toLowerCase()
        ),
      });
      if (!parsed.success) {
        fail(
          parsed.error.issues
            .map((issue) => `${columnLabel(String(issue.path[0]))}: ${issue.message}`)
            .join(" · ")
        );
        continue;
      }

      const existingId = productIdBySku.get(sku.toLowerCase());
      const action = existingId ? "actualizar" : "crear";

      if (!options.dryRun) {
        try {
          if (existingId) await service.update(existingId, parsed.data);
          else await service.create(parsed.data);
        } catch (err) {
          fail(err instanceof Error ? err.message : "No se pudo guardar");
          continue;
        }
      }

      if (action === "crear") summary.created += 1;
      else summary.updated += 1;
      summary.rows.push({ line, sku, name, action });
    }

    return summary;
  }
}
