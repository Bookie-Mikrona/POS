import { z } from "zod";

const decimal4 = z.number().finite().nonnegative().max(999999.9999)
  .refine(value => Math.round(value * 10000) / 10000 === value);

export const INVENTORY_OCR_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const inventoryUploadRequestSchema = z.object({
  name: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(INVENTORY_OCR_MAX_UPLOAD_BYTES),
  contentType: z.enum(["application/pdf", "image/jpeg", "image/png"]),
}).strict();

export const inventoryPriceSchema = z.number().finite().positive().max(999999.9999)
  .refine(value => Math.round(value * 10000) / 10000 === value);

export const inventoryEditLineSchema = z.object({
  artikelId: z.number().int().positive(),
  steviloNajdeno: z.number().finite().nonnegative().max(999999.9999)
    .refine(value => Math.round(value * 10000) / 10000 === value),
  cenaKos: inventoryPriceSchema.optional(),
}).strict();

export function resolveInventoryUnitPrice(input: {
  drobniInventar: boolean;
  explicitPrice?: number;
  previousPrice?: number;
  inventoryPrice?: number;
  lastPurchasePrice?: number;
}): number {
  if (input.drobniInventar) return 0;
  if (input.explicitPrice !== undefined) return input.explicitPrice;
  if (input.previousPrice !== undefined) return input.previousPrice;
  if (input.inventoryPrice !== undefined && input.inventoryPrice !== 0) return input.inventoryPrice;
  return input.lastPurchasePrice ?? 0;
}

export const inventoryOcrSchema = z.object({
  datum: z.string().nullable(),
  rows: z.array(z.object({
    naziv: z.string(),
    idNatisnjen: z.number().int().positive().nullable(),
    enota: z.string().nullable(),
    steviloNajdeno: decimal4.nullable(),
    cenaKos: z.number().finite().positive().max(999999.9999)
      .refine(value => Math.round(value * 10000) / 10000 === value).nullable(),
  }).strict()),
}).strict();

export interface InventoryArticle {
  id: number;
  ime: string;
  imeZaNabavo: string | null;
  enotaMere: string | null;
  drobniInventar: boolean;
}

export interface InventoryOcrResult {
  rows: Array<{ artikelId: number; steviloNajdeno: number | null; cenaKos: number | null }>;
  unmatched: string[];
  datum: string | null;
}

const key = (s: string | null | undefined): string =>
  (s ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("sl");

export function matchInventoryOcr(
  extracted: z.infer<typeof inventoryOcrSchema>,
  articles: InventoryArticle[],
  scope: "material" | "drobni",
): InventoryOcrResult {
  const eligible = articles.filter(a => (scope === "drobni") === a.drobniInventar);
  const matchedLines = extracted.rows.map(line => {
    let candidates: InventoryArticle[];
    if (line.idNatisnjen !== null) {
      candidates = eligible.filter(article => article.id === line.idNatisnjen);
    } else {
      const label = key(line.naziv);
      candidates = eligible.filter(article =>
        key(article.ime) === label || key(article.imeZaNabavo) === label,
      );
    }
    // Do not accept a match when the sheet does not identify the unit: a
    // quantity expressed in a different unit would poison inventory movements.
    if (line.enota === null) candidates = [];
    else candidates = candidates.filter(article => key(article.enotaMere) === key(line.enota));
    return { line, article: candidates.length === 1 ? candidates[0] : undefined };
  });
  const matchCounts = new Map<number, number>();
  for (const match of matchedLines) {
    if (match.article) matchCounts.set(match.article.id, (matchCounts.get(match.article.id) ?? 0) + 1);
  }

  const rows: InventoryOcrResult["rows"] = [];
  const unmatched: string[] = [];
  for (const { line, article } of matchedLines) {
    if (!article || matchCounts.get(article.id) !== 1) {
      unmatched.push(line.naziv);
      continue;
    }
    rows.push({
      artikelId: article.id,
      steviloNajdeno: line.steviloNajdeno,
      cenaKos: scope === "material" ? line.cenaKos : null,
    });
  }

  return {
    rows,
    unmatched,
    datum: extracted.datum && /^\d{4}-\d{2}-\d{2}$/.test(extracted.datum)
      && !Number.isNaN(Date.parse(`${extracted.datum}T00:00:00Z`))
      && new Date(`${extracted.datum}T00:00:00Z`).toISOString().slice(0, 10) === extracted.datum
      ? extracted.datum : null,
  };
}