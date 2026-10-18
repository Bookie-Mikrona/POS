import type { Request, Response } from "express";
import multer from "multer";
import ExcelJS from "exceljs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { artikliTable, db, kategorijeTable, normativiTable } from "@workspace/db";
import { normalizePreparedFoodUnit, isPreparedFoodBulkUnit, preparedFoodUnitRoleError } from "../../lib/prepared-food-units";
import { lockPosBusinessDay } from "../../lib/pos-z-helpers";

export const artikliExcelUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
}).single("excel");

type ExcelRow = {
  sheet: string;
  row: number;
  id?: number;
  ime: string;
  cena?: number;
  ddv?: number;
  vrsta?: string;
  kategorija?: string;
  opis?: string;
  barva?: string;
  aktiven?: boolean;
  kdsIzkljucen?: boolean;
  nabavniArtikel?: boolean;
  prodajniArtikel?: boolean;
  imeZaNabavo?: string;
  enotaMere?: string;
  toGo?: boolean;
  skupina?: string;
  vrstaEmbalaze?: string;
  depozitnaVrednost?: number;
  drobniInventar?: boolean;
  povratnaEmbalaza?: boolean;
  drobniInventarPredlogaKljuc?: string;
  gtin?: string;
  nabavnaDdvStopnja?: number;
  taxCategory?: string;
};
type ExcelNorm = { row: number; artikelId?: number; sestavinaId?: number; artikelIme: string; sestavinaIme: string; kolicina: number };
type ImportError = { vrstica: number; napaka: string; list?: string };
type ArticleBaseline =
  | { version: 1; fields: Record<string, unknown> }
  | { version: 0; ime: string; cena: string; ddv: string };

const FULL_BASELINE_FIELDS = [
  "ime", "opis", "cena", "davek", "vrstaArtikla", "kategorijaId", "barva", "aktiven",
  "nabavniArtikel", "prodajniArtikel", "jeSkupinskiNabavniArtikel", "povratnaEmbalaza",
  "drobniInventar", "drobniInventarPredlogaKljuc", "vrstaEmbalaze", "depozitnaVrednost",
  "imeZaNabavo", "enotaMere", "toGo", "skupina", "gtin", "nabavnaDdvStopnja", "taxCategory",
  "mealType",
] as const;
const NUMERIC_BASELINE_FIELDS = new Set(["cena", "davek", "depozitnaVrednost", "nabavnaDdvStopnja"]);

function baselineMatches(article: Record<string, any>, baseline: ArticleBaseline): boolean {
  if (baseline.version === 0) {
    return article.ime === baseline.ime
      && Number(article.cena) === Number(baseline.cena)
      && Number(article.davek) === Number(baseline.ddv);
  }
  // Older snapshots lack this field and must remain valid.
  if ("kdsIzkljucen" in baseline.fields
    && baseline.fields.kdsIzkljucen !== article.kdsIzkljucen) return false;
  return FULL_BASELINE_FIELDS.every(field => {
    const expected = baseline.fields[field];
    const actual = article[field];
    if (NUMERIC_BASELINE_FIELDS.has(field)) {
      if (expected == null || actual == null) return expected == null && actual == null;
      return Number(expected) === Number(actual);
    }
    return (expected ?? null) === (actual ?? null);
  });
}

const text = (value: ExcelJS.CellValue): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) return String(value.text ?? "").trim();
  if (typeof value === "object" && "result" in value) return String(value.result ?? "").trim();
  if (typeof value === "object" && ("formula" in value || "sharedFormula" in value)) {
    const result = "result" in value ? value.result : undefined;
    return result == null ? "" : String(result).trim();
  }
  return String(value).trim();
};
const bool = (v: string): boolean | undefined => {
  if (!v) return undefined;
  if (["DA", "TRUE", "1", "YES"].includes(v.toUpperCase())) return true;
  if (["NE", "FALSE", "0", "NO"].includes(v.toUpperCase())) return false;
  return undefined;
};
const number = (v: string): number | undefined => {
  if (!v) return undefined;
  const parsed = Number(v.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
};
const hasScale = (value: number, scale: number): boolean =>
  Math.abs(value * scale - Math.round(value * scale)) < 1e-8;
const allowedSheets = new Map([
  ["Artikli", "article"],
  ["Povratna embalaža", "returnable"],
  ["Drobni inventar", "inventory"],
]);
const permittedRoles = ["admin", "admin_enote", "superadmin"];
const validTaxRates = [0, 5, 9.5, 22];
const packagingKinds = ["steklenica", "zaboj", "keg", "balon", "drugo"];
const taxCategories = ["food", "hot_beverage", "cold_beverage", "alcoholic", "food_drink", "vat_super_reduced_5", "other"];

function headersFor(sheet: ExcelJS.Worksheet): Map<string, number> {
  const map = new Map<string, number>();
  sheet.getRow(1).eachCell((cell, index) => map.set(text(cell.value).toLowerCase(), index));
  return map;
}

export async function uvoziArtikliExcel(req: Request, res: Response): Promise<void> {
  const unitId = Number((req as any).enotaId);
  const dryRun = String(req.query.dryRun ?? "false").toLowerCase() === "true";
  if (!Number.isInteger(unitId) || unitId <= 0) {
    res.status(400).json({ napaka: "Manjka veljavna poslovna enota." });
    return;
  }
  if (!dryRun && !permittedRoles.includes((req as any).vloga)) {
    res.status(403).json({ napaka: "Uvoz Excel zahteva vlogo admin, admin_enote ali superadmin." });
    return;
  }
  if (!req.file?.buffer) {
    res.status(400).json({ napaka: "Naložite Excel datoteko v polju excel." });
    return;
  }

  const errors: ImportError[] = [];
  const articles: ExcelRow[] = [];
  const norms: ExcelNorm[] = [];
  const baselines = new Map<number, ArticleBaseline>();
  let supportedSheetCount = 0;
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer as any);
    for (const sheet of workbook.worksheets) {
      const sheetType = allowedSheets.get(sheet.name);
      if (sheetType) {
        supportedSheetCount++;
        const header = headersFor(sheet);
        if (!header.has("ime")) {
          errors.push({ vrstica: 1, list: sheet.name, napaka: "Manjka obvezni stolpec ime." });
          continue;
        }
        sheet.eachRow((row, rowNo) => {
          if (rowNo === 1) return;
          const val = (key: string) => {
            const col = header.get(key.toLowerCase());
            return col ? text(row.getCell(col).value) : "";
          };
          const ime = val("ime");
          const idText = val("id");
          if (!ime) {
            const ignoredDefaults = new Set([
              "vrstaartikla:storitev",
              "aktiven:da",
              "prodajniartikel:da",
              "togo:ne",
            ]);
            const meaningfulCells = [...header.keys()]
              .map(key => `${key}:${val(key)}`.toLowerCase())
              .filter(value => value.slice(value.indexOf(":") + 1).trim() !== "" && !ignoredDefaults.has(value));
            if (idText || meaningfulCells.length > 0) {
              errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Vrstica vsebuje podatke, vendar manjka obvezno ime artikla." });
            }
            return;
          }
          const id = idText ? Number(idText) : undefined;
          if (idText && (!Number.isSafeInteger(id) || (id as number) <= 0)) {
            errors.push({ vrstica: rowNo, list: sheet.name, napaka: "ID mora biti pozitivno celo število." });
            return;
          }
          const rawType = val("vrstaArtikla");
          const priceText = val("cena");
          const taxText = val("ddv");
          const price = number(priceText);
          const tax = number(taxText);
          if (!id && price === undefined) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Nov artikel mora imeti vneseno ceno." });
          if (!id && tax === undefined) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Nov artikel mora imeti vnesen prodajni DDV." });
          if (priceText && (price === undefined || price < 0 || price > 99_999_999.99 || !hasScale(price, 100))) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Cena mora biti nenegativno število z največ dvema decimalkama." });
          if (taxText && (tax === undefined || !validTaxRates.includes(tax))) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "DDV mora biti ena od vrednosti 0, 5, 9,5 ali 22." });
          if (rawType && !["blago", "material", "storitev"].includes(rawType.toLowerCase())) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Neveljavna vrsta artikla; dovoljeno: blago, material, storitev." });
          const parsed: ExcelRow = {
            sheet: sheet.name, row: rowNo, id, ime, cena: price, ddv: tax,
            vrsta: rawType ? rawType.toLowerCase() : undefined,
          };
          for (const [field, key] of [["kategorija", "kategorija"], ["opis", "opis"], ["barva", "barva"], ["imeZaNabavo", "imeZaNabavo"], ["enotaMere", "enotaMere"], ["skupina", "skupina"], ["vrstaEmbalaze", "vrstaEmbalaze"], ["depozitnaVrednost", "depozitnaVrednost"], ["drobniInventarPredlogaKljuc", "drobniInventarPredlogaKljuc"], ["gtin", "gtin"], ["taxCategory", "taxCategory"]] as const) {
            const valText = val(key);
            if (valText) {
              if (field === "depozitnaVrednost") {
                const n = number(valText);
                if (n === undefined || n < 0 || n > 9_999_999_999.99 || !hasScale(n, 100)) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Depozit mora biti nenegativno število z največ dvema decimalkama." });
                else parsed.depozitnaVrednost = n;
              } else if (field === "gtin") {
                if (!/^\d{8}$|^\d{12,14}$/.test(valText)) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "GTIN mora vsebovati 8, 12, 13 ali 14 števk." });
                else parsed.gtin = valText;
              } else if (field === "taxCategory") {
                if (!taxCategories.includes(valText)) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Neveljavna taxCategory; obstoječe dovoljene vrednosti so food, hot_beverage, cold_beverage, alcoholic, food_drink, vat_super_reduced_5 in other." });
                else parsed.taxCategory = valText;
              } else if (field === "enotaMere") {
                parsed.enotaMere = normalizePreparedFoodUnit(valText) ?? undefined;
              } else (parsed as any)[field] = valText;
            }
          }
          const purchaseTaxText = val("nabavnaDdvStopnja");
          if (purchaseTaxText) {
            const purchaseTax = number(purchaseTaxText);
            if (purchaseTax === undefined || !validTaxRates.includes(purchaseTax)) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Nabavna DDV stopnja mora biti ena od vrednosti 0, 5, 9,5 ali 22." });
            else parsed.nabavnaDdvStopnja = purchaseTax;
          }
          for (const key of ["aktiven", "nabavniArtikel", "prodajniArtikel", "toGo", "drobniInventar", "povratnaEmbalaza", "kdsIzkljucen"] as const) {
            const cell = val(key);
            if (!cell) continue;
            const parsedBool = bool(cell);
            if (parsedBool === undefined) errors.push({ vrstica: rowNo, list: sheet.name, napaka: `Polje ${key} mora biti DA ali NE.` });
            else parsed[key] = parsedBool;
          }
          if (parsed.vrstaEmbalaze && !packagingKinds.includes(parsed.vrstaEmbalaze.toLowerCase())) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Neveljavna vrsta embalaže." });
          if (parsed.vrstaEmbalaze) parsed.vrstaEmbalaze = parsed.vrstaEmbalaze.toLowerCase();
          if (sheetType === "returnable" && parsed.drobniInventar === true) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Povratna embalaža ne more biti drobni inventar." });
          if (sheetType === "inventory" && parsed.drobniInventar === false) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Na listu Drobni inventar mora biti drobniInventar=DA." });
          if (sheetType === "article" && parsed.drobniInventar === true) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Drobni inventar mora biti na svojem namenskem listu." });
          if (sheetType === "article" && parsed.povratnaEmbalaza === true) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Povratna embalaža mora biti na svojem namenskem listu." });
          if (sheetType === "article" && (parsed.vrstaEmbalaze !== undefined || parsed.depozitnaVrednost !== undefined)) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Podatki povratne embalaže morajo biti na namenskem listu." });
          if (sheetType === "inventory" && parsed.povratnaEmbalaza === true) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Drobni inventar ne sme biti povratna embalaža." });
          if (sheetType === "inventory" && !id &&
            (parsed.nabavniArtikel !== true || parsed.prodajniArtikel !== false ||
              parsed.vrsta !== "material" || parsed.drobniInventar !== true ||
              parsed.povratnaEmbalaza !== false)) {
            errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Nov drobni inventar mora biti material, samo nabavni, neprodajni in nepovratni artikel." });
          }
          if (sheetType === "returnable" && !id && !parsed.vrstaEmbalaze) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Nova povratna embalaža mora imeti vrsto embalaže." });
          if (sheetType === "returnable" && !id && parsed.povratnaEmbalaza !== true) errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Nova povratna embalaža mora imeti povratnaEmbalaza=DA." });
          articles.push(parsed);
        });
      } else if (sheet.name === "Normativi") {
        supportedSheetCount++;
        const header = headersFor(sheet);
        sheet.eachRow((row, rowNo) => {
          if (rowNo === 1) return;
          const val = (key: string) => {
            const col = header.get(key.toLowerCase());
            return col ? text(row.getCell(col).value) : "";
          };
          const artikelIme = val("artikelIme");
          const sestavinaIme = val("sestavinaIme");
          const qtyText = val("kolicina");
          if (!artikelIme && !sestavinaIme && !qtyText) return;
          const qty = number(qtyText);
          const parseId = (s: string) => s ? Number(s) : undefined;
          const artikelId = parseId(val("artikelId"));
          const sestavinaId = parseId(val("sestavinaId"));
          if (!artikelIme || !sestavinaIme || qty === undefined || qty <= 0 || qty > 999_999.9999 || !hasScale(qty, 10_000)) {
            errors.push({ vrstica: rowNo, list: sheet.name, napaka: "Normativ zahteva artikel, sestavino in količino > 0 z največ štirimi decimalkami." });
          } else if ((val("artikelId") && (!Number.isSafeInteger(artikelId) || (artikelId as number) <= 0)) || (val("sestavinaId") && (!Number.isSafeInteger(sestavinaId) || (sestavinaId as number) <= 0))) {
            errors.push({ vrstica: rowNo, list: sheet.name, napaka: "ID artikla/sestavine mora biti pozitivno celo število." });
          } else norms.push({ row: rowNo, artikelIme, sestavinaIme, kolicina: qty, artikelId, sestavinaId });
        });
      } else if (sheet.name === "Sifranti") {
        sheet.eachRow((row) => {
          const idText = text(row.getCell(3).value);
          const id = Number(idText);
          const serialized = text(row.getCell(4).value);
          if (!idText || !Number.isSafeInteger(id) || id <= 0) return;
          try {
            const parsed = JSON.parse(serialized) as ArticleBaseline;
            if (parsed.version === 1 && parsed.fields && FULL_BASELINE_FIELDS.every(field => field in parsed.fields)) {
              baselines.set(id, parsed);
              return;
            }
          } catch { /* legacy hidden baseline */ }
          const cena = number(text(row.getCell(5).value));
          const ddv = number(text(row.getCell(6).value));
          if (serialized && cena !== undefined && ddv !== undefined) {
            baselines.set(id, { version: 0, ime: serialized, cena: String(cena), ddv: String(ddv) });
          }
        });
      }
    }
    if (supportedSheetCount === 0) errors.push({ vrstica: 0, napaka: "Delovni zvezek ne vsebuje podprtih listov (Artikli, Povratna embalaža, Drobni inventar ali Normativi)." });
  } catch {
    res.status(422).json({ napaka: "Datoteke ni mogoče prebrati kot veljaven Excel delovni zvezek.", napake: [{ vrstica: 0, napaka: "Datoteka je poškodovana ali nepodprtega formata." }] });
    return;
  }

  const seenIds = new Set<number>();
  for (const row of articles) {
    if (row.id !== undefined && seenIds.has(row.id)) errors.push({ vrstica: row.row, list: row.sheet, napaka: `ID ${row.id} je v delovnem zvezku podvojen.` });
    if (row.id !== undefined) seenIds.add(row.id);
  }
  if (new Set(articles.filter(r => !r.id).map(r => r.ime.toLocaleLowerCase("sl"))).size !== articles.filter(r => !r.id).length) {
    errors.push({ vrstica: 0, napaka: "Ime novega artikla je v delovnem zvezku podvojeno." });
  }

  const categoryNames = [...new Set(articles.map(a => a.kategorija).filter((v): v is string => !!v))];
  const categories = categoryNames.length
    ? await db.select({ id: kategorijeTable.id, ime: kategorijeTable.ime }).from(kategorijeTable).where(and(eq(kategorijeTable.enotaId, unitId)))
    : [];
  const categoryMap = new Map(categories.map(c => [c.ime.toLocaleLowerCase("sl"), c.id]));
  for (const a of articles) if (a.kategorija && !categoryMap.has(a.kategorija.toLocaleLowerCase("sl"))) {
    errors.push({ vrstica: a.row, list: a.sheet, napaka: `Kategorija »${a.kategorija}« ne obstaja v tej enoti.` });
  }

  const currentIds = [...new Set(articles.flatMap(a => a.id ? [a.id] : []))];
  const existing = currentIds.length
    ? await db.select().from(artikliTable).where(and(eq(artikliTable.enotaId, unitId)))
    : [];
  const existingById = new Map(existing.filter(a => currentIds.includes(a.id)).map(a => [a.id, a]));
  const unitArticles = await db.select({
    id: artikliTable.id,
    ime: artikliTable.ime,
    mealType: artikliTable.mealType,
    enotaMere: artikliTable.enotaMere,
    nabavniArtikel: artikliTable.nabavniArtikel,
    prodajniArtikel: artikliTable.prodajniArtikel,
    povratnaEmbalaza: artikliTable.povratnaEmbalaza,
    drobniInventar: artikliTable.drobniInventar,
  })
    .from(artikliTable).where(eq(artikliTable.enotaId, unitId));
  const names = new Map<string, typeof unitArticles>();
  for (const a of unitArticles) {
    const key = a.ime.toLocaleLowerCase("sl");
    names.set(key, [...(names.get(key) ?? []), a]);
  }
  const duplicateMode = String(req.query.podvojeni ?? "preskoči");
  if (!["preskoči", "posodobi"].includes(duplicateMode)) errors.push({ vrstica: 0, napaka: "Parameter podvojeni mora biti preskoči ali posodobi." });
  const skipRows = new Set<ExcelRow>();
  for (const a of articles) {
    if (a.id) {
      const old = existingById.get(a.id);
      if (!old) errors.push({ vrstica: a.row, list: a.sheet, napaka: `ID ${a.id} ni najden v tej poslovni enoti.` });
      else {
        const baseline = baselines.get(a.id);
        if (!baseline) errors.push({ vrstica: a.row, list: a.sheet, napaka: `Posodobitvi ID ${a.id} manjka izvozni posnetek; za varno posodobitev znova izvozite katalog.` });
        else if (!baselineMatches(old, baseline)) errors.push({ vrstica: a.row, list: a.sheet, napaka: `Artikel ID ${a.id} je bil spremenjen po izvozu; najprej izvozite svež katalog.` });
        const expected = allowedSheets.get(a.sheet);
        if ((expected === "article" && (old.povratnaEmbalaza || old.drobniInventar)) ||
            (expected === "returnable" && !old.povratnaEmbalaza) ||
            (expected === "inventory" && !old.drobniInventar)) {
          errors.push({ vrstica: a.row, list: a.sheet, napaka: "ID pripada drugemu tipu artikla; vrste artikla s tem uvozom ni mogoče spremeniti." });
        }
        if (a.enotaMere !== undefined
          && normalizePreparedFoodUnit(a.enotaMere) !== normalizePreparedFoodUnit(old.enotaMere)) {
          errors.push({ vrstica: a.row, list: a.sheet, napaka: "Merske enote obstoječega artikla ni mogoče spremeniti z Excelom; lahko vpliva na zaloge, normative in prejete račune." });
        }
        const preparedUnitError = preparedFoodUnitRoleError({
          mealType: old.mealType,
          unit: a.enotaMere ?? old.enotaMere,
          purchaseArticle: a.nabavniArtikel ?? old.nabavniArtikel,
          salesArticle: a.prodajniArtikel ?? old.prodajniArtikel,
          returnablePackaging: a.povratnaEmbalaza ?? old.povratnaEmbalaza,
        });
        if (preparedUnitError) errors.push({ vrstica: a.row, list: a.sheet, napaka: preparedUnitError });
        if (expected === "inventory") {
          const inventoryRoleValid =
            (a.drobniInventar ?? old.drobniInventar) === true &&
            (a.nabavniArtikel ?? old.nabavniArtikel) === true &&
            (a.prodajniArtikel ?? old.prodajniArtikel) === false &&
            (a.vrsta ?? old.vrstaArtikla) === "material" &&
            (a.povratnaEmbalaza ?? old.povratnaEmbalaza) === false &&
            Number(a.ddv ?? old.davek) === 22 &&
            (a.taxCategory ?? old.taxCategory) === "other";
          if (!inventoryRoleValid) errors.push({ vrstica: a.row, list: a.sheet, napaka: "Drobni inventar mora ostati material, samo nabavni in nepovratni artikel z DDV 22 in taxCategory=other." });
        }
        if (expected === "returnable" && a.povratnaEmbalaza === false) {
          errors.push({ vrstica: a.row, list: a.sheet, napaka: "Na listu Povratna embalaža mora biti povratnaEmbalaza=DA." });
        }
      }
    } else {
      const expected = allowedSheets.get(a.sheet);
      const duplicates = names.get(a.ime.toLocaleLowerCase("sl")) ?? [];
      if (duplicates.length) {
        if (duplicateMode === "preskoči") skipRows.add(a);
        else errors.push({ vrstica: a.row, list: a.sheet, napaka: "Urejanje po imenu ni dovoljeno; za posodobitev mora datoteka vsebovati stabilni ID." });
      }
      if (expected === "inventory") {
        if (a.nabavniArtikel !== true || a.prodajniArtikel !== false || a.vrsta !== "material" ||
            a.drobniInventar !== true || a.povratnaEmbalaza !== false) {
          errors.push({ vrstica: a.row, list: a.sheet, napaka: "Drobni inventar mora biti material, samo nabavni in nepovratni artikel." });
        }
        if (a.ddv !== 22) errors.push({ vrstica: a.row, list: a.sheet, napaka: "Drobni inventar mora imeti DDV 22." });
        if (a.taxCategory && a.taxCategory !== "other") errors.push({ vrstica: a.row, list: a.sheet, napaka: "Drobni inventar mora imeti taxCategory=other." });
      }
      if (expected === "returnable" && a.povratnaEmbalaza === false) {
        errors.push({ vrstica: a.row, list: a.sheet, napaka: "Na listu Povratna embalaža mora biti povratnaEmbalaza=DA." });
      }
    }
    if (a.sheet === "Povratna embalaža" && a.drobniInventar) errors.push({ vrstica: a.row, list: a.sheet, napaka: "Konflikt tipa artikla." });
  }

  const validRows = articles.filter(a => !skipRows.has(a));
  type NormRef = { id?: number; newArticle?: ExcelRow };
  const resolveNormRef = (id: number | undefined, name: string, rowNo: number, column: string): NormRef | undefined => {
    if (id) {
      if (!unitArticles.some(a => a.id === id)) errors.push({ vrstica: rowNo, list: "Normativi", napaka: `ID ${column} ${id} ni najden v tej poslovni enoti.` });
      return { id };
    }
    const matches = names.get(name.toLocaleLowerCase("sl")) ?? [];
    if (matches.length === 1) return { id: matches[0]!.id };
    if (matches.length > 1) {
      errors.push({ vrstica: rowNo, list: "Normativi", napaka: `Ime ${column} ni enolično; uporabite stabilni ID.` });
      return undefined;
    }
    const planned = validRows.filter(a => a.ime.toLocaleLowerCase("sl") === name.toLocaleLowerCase("sl"));
    if (planned.length === 1) return { newArticle: planned[0] };
    errors.push({ vrstica: rowNo, list: "Normativi", napaka: `Ime ${column} ni najdeno v tej poslovni enoti ali uvoznem seznamu.` });
    return undefined;
  };
  const resolvedNorms = norms.map(n => ({
    ...n,
    parent: resolveNormRef(n.artikelId, n.artikelIme, n.row, "artikla"),
    ingredient: resolveNormRef(n.sestavinaId, n.sestavinaIme, n.row, "sestavine"),
  }));
  const normKeys = new Set<string>();
  for (const n of resolvedNorms) {
    const refKey = (ref: NormRef | undefined) => ref?.id ? `id:${ref.id}` : `new:${ref?.newArticle?.sheet}:${ref?.newArticle?.row}`;
    const key = `${refKey(n.parent)}:${refKey(n.ingredient)}`;
    if (normKeys.has(key)) errors.push({ vrstica: n.row, list: "Normativi", napaka: "Normativ za ta par artiklov je podvojen." });
    normKeys.add(key);
  }

  const bulkIngredientOwnerIds = articles.flatMap(row => {
    const owner = row.id ? existingById.get(row.id) : undefined;
    const finalSalesArticle = row.prodajniArtikel ?? owner?.prodajniArtikel;
    return owner?.mealType === "composite" && finalSalesArticle === false ? [owner.id] : [];
  });
  const parentIds = [...new Set([
    ...resolvedNorms.flatMap(n => n.parent?.id ? [n.parent.id] : []),
    ...bulkIngredientOwnerIds,
  ])];
  const savedNorms = parentIds.length
    ? await db.select({
      artikelId: normativiTable.artikelId,
      vhodniArtikelId: normativiTable.vhodniArtikelId,
      kolicina: normativiTable.kolicina,
    }).from(normativiTable).where(inArray(normativiTable.artikelId, parentIds))
    : [];
  for (const n of resolvedNorms) {
    if (!n.parent?.id || !n.ingredient?.id) {
      errors.push({ vrstica: n.row, list: "Normativi", napaka: "Uvoz ne ustvarja novih normativov; dodajte jih v urejevalniku normativov." });
      continue;
    }
    const existingNorm = savedNorms.find(row => row.artikelId === n.parent!.id && row.vhodniArtikelId === n.ingredient!.id);
    if (!existingNorm) {
      errors.push({ vrstica: n.row, list: "Normativi", napaka: "Normativna sprememba ni dovoljena prek Excel uvoza; uporabite urejevalnik, ki preveri revizijo, cikle in alergen." });
    } else if (Number(existingNorm.kolicina) !== n.kolicina) {
      errors.push({ vrstica: n.row, list: "Normativi", napaka: "Sprememba količine normativa ni dovoljena prek Excel uvoza; uporabite urejevalnik, ki preveri revizijo, cikle in alergen." });
    }
  }
  for (const ownerId of bulkIngredientOwnerIds) {
    const owner = existingById.get(ownerId);
    const hasBulkPreparedIngredient = savedNorms
      .filter(norm => norm.artikelId === ownerId)
      .some(norm => {
        const ingredient = unitArticles.find(article => article.id === norm.vhodniArtikelId);
        return ingredient?.mealType === "prepared" && isPreparedFoodBulkUnit(ingredient.enotaMere);
      });
    if (hasBulkPreparedIngredient && owner) {
      const row = articles.find(article => article.id === ownerId)!;
      errors.push({
        vrstica: row.row,
        list: row.sheet,
        napaka: "Sestavljene jedi s pripravljenimi sestavinami v kg ali l morajo ostati prodajne.",
      });
    }
  }

  const preview = articles.map(a => ({
    ime: a.ime,
    cena: a.cena ?? 0,
    ddv: a.ddv ?? 9.5,
    kategorija: a.kategorija ?? null,
    list: a.sheet,
    dejanje: skipRows.has(a) ? "preskoči" : a.id ? "posodobi" : "ustvari",
  }));
  if (errors.length) {
    res.status(422).json({
      napaka: `Excel ni uvožen: najdenih je ${errors.length} napak.`,
      napake: errors,
      predogled: preview,
      skupaj: articles.length + norms.length,
      veljavnih: 0,
      normativov: norms.length,
    });
    return;
  }
  if (dryRun) {
    res.json({ predogled: preview, napake: [], skupaj: articles.length + norms.length, veljavnih: validRows.length, normativov: norms.length });
    return;
  }

  try {
    const outcome = await db.transaction(async tx => {
      await lockPosBusinessDay(tx, unitId);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(376, ${unitId}::integer)`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(1315924557::integer, ${unitId}::integer)`);
      let imported = 0;
      let updated = 0;
      const skipped = skipRows.size;
      for (const a of validRows) {
        const expected = allowedSheets.get(a.sheet);
        const patch: Record<string, unknown> = { ime: a.ime };
        if (a.cena !== undefined) patch.cena = String(a.cena);
        if (a.ddv !== undefined) patch.davek = String(a.ddv);
        if (a.vrsta !== undefined) patch.vrstaArtikla = a.vrsta;
        if (a.kategorija !== undefined) patch.kategorijaId = categoryMap.get(a.kategorija.toLocaleLowerCase("sl")) ?? null;
        if (a.opis !== undefined) patch.opis = a.opis;
        if (a.barva !== undefined) patch.barva = a.barva;
        if (a.aktiven !== undefined) patch.aktiven = a.aktiven;
        if (a.kdsIzkljucen !== undefined) patch.kdsIzkljucen = a.kdsIzkljucen;
        if (a.nabavniArtikel !== undefined) patch.nabavniArtikel = a.nabavniArtikel;
        if (a.prodajniArtikel !== undefined) patch.prodajniArtikel = a.prodajniArtikel;
        if (a.imeZaNabavo !== undefined) patch.imeZaNabavo = a.imeZaNabavo;
        if (a.enotaMere !== undefined) patch.enotaMere = normalizePreparedFoodUnit(a.enotaMere);
        if (a.toGo !== undefined) patch.toGo = a.toGo;
        if (a.skupina !== undefined) patch.skupina = a.skupina;
        if (a.gtin !== undefined) patch.gtin = a.gtin;
        if (a.nabavnaDdvStopnja !== undefined) patch.nabavnaDdvStopnja = String(a.nabavnaDdvStopnja);
        if (a.taxCategory !== undefined) patch.taxCategory = a.taxCategory;
        if (expected === "returnable") {
          patch.vrstaEmbalaze = a.vrstaEmbalaze;
          patch.depozitnaVrednost = a.depozitnaVrednost === undefined ? undefined : String(a.depozitnaVrednost);
          patch.povratnaEmbalaza = true;
          patch.drobniInventar = false;
        } else if (expected === "inventory") {
          patch.drobniInventar = true;
          patch.povratnaEmbalaza = false;
          patch.vrstaArtikla = "material";
          patch.nabavniArtikel = true;
          patch.prodajniArtikel = false;
          patch.davek = "22";
          patch.taxCategory = "other";
          patch.drobniInventarPredlogaKljuc = a.drobniInventarPredlogaKljuc;
        } else if (!a.id) {
          patch.povratnaEmbalaza = false;
          patch.drobniInventar = false;
          patch.vrstaArtikla = a.vrsta ?? "storitev";
        }
        // Empty optional cells deliberately preserve existing values.
        for (const key of Object.keys(patch)) if (patch[key] === undefined) delete patch[key];
        if (a.id) {
          const baseline = baselines.get(a.id);
          if (!baseline) throw new Error(`Posodobitvi ID ${a.id} manjka izvozni posnetek.`);
          const [lockedArticle] = await tx.select().from(artikliTable)
            .where(and(eq(artikliTable.id, a.id), eq(artikliTable.enotaId, unitId))).for("update");
          if (!lockedArticle || !baselineMatches(lockedArticle, baseline)) {
            throw new Error(`Artikel ID ${a.id} je bil spremenjen po izvozu; najprej izvozite svež katalog.`);
          }
          const finalSalesArticle = a.prodajniArtikel ?? lockedArticle.prodajniArtikel;
          if (lockedArticle.mealType === "composite" && !finalSalesArticle) {
            const ownerNorms = await tx.select({
              ingredientId: normativiTable.vhodniArtikelId,
            }).from(normativiTable).where(eq(normativiTable.artikelId, lockedArticle.id));
            const ingredientIds = [...new Set(ownerNorms.map(norm => norm.ingredientId))];
            const ingredients = ingredientIds.length
              ? await tx.select({
                id: artikliTable.id,
                mealType: artikliTable.mealType,
                enotaMere: artikliTable.enotaMere,
              }).from(artikliTable).where(and(
                inArray(artikliTable.id, ingredientIds),
                eq(artikliTable.enotaId, unitId),
              )).for("update")
              : [];
            if (ingredients.some(ingredient =>
              ingredient.mealType === "prepared" && isPreparedFoodBulkUnit(ingredient.enotaMere))) {
              throw new Error(`Sestavljena jed ID ${a.id} s pripravljenimi sestavinami v kg ali l mora ostati prodajna.`);
            }
          }
          const [updatedRow] = await tx.update(artikliTable).set(patch as any)
            .where(and(eq(artikliTable.id, a.id), eq(artikliTable.enotaId, unitId))).returning({ id: artikliTable.id });
          if (!updatedRow) throw new Error(`ID ${a.id} med uvozom ni več na voljo ali je bil spremenjen po predogledu.`);
          updated++;
        } else {
          const [inserted] = await tx.insert(artikliTable)
            .values({ enotaId: unitId, cena: "0", ime: a.ime, ...patch } as any)
            .returning({ id: artikliTable.id });
          if (!inserted) throw new Error(`Artikla »${a.ime}« ni bilo mogoče ustvariti.`);
          imported++;
        }
      }
      return { imported, updated, skipped, importedNorms: 0 };
    });
    res.json({
      uvozenih: outcome.imported,
      posodobljenih: outcome.updated,
      preskocenih: outcome.skipped,
      normativiUvozenih: outcome.importedNorms,
      napake: [],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Neznana napaka pri zapisu.";
    res.status(422).json({ napaka: `Uvoz ni bil izveden; transakcija je bila razveljavljena. ${message}`, napake: [{ vrstica: 0, napaka: message }] });
  }
}