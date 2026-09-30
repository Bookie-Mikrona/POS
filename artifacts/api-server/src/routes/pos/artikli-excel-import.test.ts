import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

const { state } = vi.hoisted(() => ({
  state: {
    articles: [] as Array<Record<string, any>>,
    categories: [] as Array<Record<string, any>>,
    norms: [] as Array<Record<string, any>>,
    writes: 0,
    onLock: undefined as (() => void) | undefined,
  },
}));

vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  const sourceRows = (table: unknown) => table === original.artikliTable
    ? state.articles.filter(row => row.enotaId === 5)
    : table === original.kategorijeTable
      ? state.categories
      : table === original.normativiTable ? state.norms : [];
  const mutableRows = (table: unknown) => table === original.artikliTable
    ? state.articles
    : table === original.kategorijeTable ? state.categories
      : table === original.normativiTable ? state.norms : [];
  const makeSelect = () => {
    let table: unknown;
    const result: any = {
      from(value: unknown) { table = value; return result; },
      where() { return result; },
      for() { return result; },
      limit() { return result; },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(sourceRows(table)).then(resolve, reject);
      },
    };
    return result;
  };
  const tx = {
    select: () => makeSelect(),
    execute: async () => {
      state.onLock?.();
      state.onLock = undefined;
      return { rows: [] };
    },
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            state.writes++;
            const rows = sourceRows(table);
            if (table === original.artikliTable) {
              const row = rows[0];
              if (!row) return [];
              Object.assign(row, patch);
              return [{ id: row.id }];
            }
            return [];
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (value: Record<string, unknown>) => {
        state.writes++;
        const inserted = { id: 900 + state.writes, ...value };
        mutableRows(table).push(inserted);
        const result: any = {
          returning: async () => [{ id: inserted.id }],
          then: (resolve: (value: unknown) => unknown) => Promise.resolve([]).then(resolve),
        };
        return result;
      },
    }),
  };
  return {
    ...original,
    db: {
      select: () => makeSelect(),
    transaction: async (callback: (tx: any) => Promise<unknown>) => callback(tx),
    },
  };
});

import { uvoziArtikliExcel } from "./artikli-excel-import";

async function workbookUpload(rows: Array<Record<string, unknown>>, sheetName = "Artikli") {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  const headers = Object.keys(rows[0] ?? { ime: "" });
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(headers.map(header => row[header]));
  const snapshots = workbook.addWorksheet("Sifranti", { state: "veryHidden" });
  const baselineDefaults = {
    opis: null, vrstaArtikla: null, kategorijaId: null, barva: null, aktiven: null,
    nabavniArtikel: null, prodajniArtikel: null, jeSkupinskiNabavniArtikel: null,
    povratnaEmbalaza: null, drobniInventar: null, drobniInventarPredlogaKljuc: null,
    vrstaEmbalaze: null, depozitnaVrednost: null, imeZaNabavo: null, enotaMere: null,
    toGo: null, skupina: null, gtin: null, nabavnaDdvStopnja: null, taxCategory: null,
    mealType: null,
  };
  for (const id of [...new Set(rows.map(row => Number(row.id)).filter(Number.isSafeInteger))]) {
    const article = state.articles.find(row => row.id === id)!;
    const fields = { ...baselineDefaults, ...article };
    snapshots.addRow(["", "", id, JSON.stringify({
      version: 1,
      fields: Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "id" && key !== "enotaId")),
    })]);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const req: any = {
    enotaId: 5,
    vloga: "admin",
    file: { buffer },
    query: { dryRun: "true", podvojeni: "preskoči" },
  };
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(value: unknown) { this.body = value; return this; },
  };
  await uvoziArtikliExcel(req, res);
  return { req, res };
}

describe("POS article Excel import", () => {
  beforeEach(() => {
    state.articles = [
      { id: 31, enotaId: 5, ime: "Existing", cena: "2.00", davek: "22", povratnaEmbalaza: false, drobniInventar: false },
      { id: 32, enotaId: 6, ime: "Other tenant", cena: "1.00", davek: "22", povratnaEmbalaza: false, drobniInventar: false },
    ];
    state.categories = [{ id: 4, enotaId: 5, ime: "Pijača" }];
    state.norms = [];
    state.writes = 0;
    state.onLock = undefined;
  });

  it("previews the same stable-ID workbook without writing", async () => {
    const { res } = await workbookUpload([{ id: 31, ime: "Existing", cena: 3, ddv: 22, vrstaArtikla: "blago" }]);
    expect(res.statusCode).toBe(200);
    expect(res.body.predogled).toEqual([expect.objectContaining({
      ime: "Existing", cena: 3, ddv: 22, kategorija: null, list: "Artikli", dejanje: "posodobi",
    })]);
    expect(res.body.veljavnih).toBe(1);
    expect(state.writes).toBe(0);
  });

  it("rejects a foreign/unknown ID instead of matching by name", async () => {
    const { res } = await workbookUpload([{ id: 32, ime: "Other tenant", cena: 1, ddv: 22 }]);
    expect(res.statusCode).toBe(422);
    expect(res.body.napake[0].napaka).toContain("ni najden");
    expect(state.writes).toBe(0);
  });

  it("rejects duplicate stable IDs before any writes", async () => {
    const { res } = await workbookUpload([
      { id: 31, ime: "Existing", cena: 1, ddv: 22 },
      { id: 31, ime: "Existing", cena: 2, ddv: 22 },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.body.napake.some((e: { napaka: string }) => e.napaka.includes("podvojen"))).toBe(true);
    expect(state.writes).toBe(0);
  });

  it("rejects populated rows with no name and new rows missing price or sales tax", async () => {
    const { res } = await workbookUpload([
      { id: 31, ime: "", cena: 1, ddv: 22 },
      { ime: "New", cena: "", ddv: "" },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.body.napake.some((e: { napaka: string }) => e.napaka.includes("manjka obvezno ime"))).toBe(true);
    expect(res.body.napake.some((e: { napaka: string }) => e.napaka.includes("ceno"))).toBe(true);
    expect(res.body.napake.some((e: { napaka: string }) => e.napaka.includes("prodajni DDV"))).toBe(true);
    expect(state.writes).toBe(0);
  });

  it("rejects a stale exported snapshot before it can overwrite a concurrent edit", async () => {
    const { req, res } = await workbookUpload([{ id: 31, ime: "Existing", cena: 4, ddv: 22 }]);
    state.articles[0]!.cena = "3.00";
    const workbook = new ExcelJS.Workbook();
    const articles = workbook.addWorksheet("Artikli");
    articles.addRow(["id", "ime", "cena", "ddv"]);
    articles.addRow([31, "Existing", 4, 22]);
    const snapshot = workbook.addWorksheet("Sifranti", { state: "veryHidden" });
    snapshot.addRow(["", "", 31, "Existing", 2, 22]);
    req.file.buffer = await workbook.xlsx.writeBuffer();
    await uvoziArtikliExcel(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.napake[0].napaka).toContain("spremenjen po izvozu");
    expect(state.writes).toBe(0);
  });

  it("includes role and tax fields in the full stale-workbook snapshot", async () => {
    const { req, res } = await workbookUpload([{ id: 31, ime: "Existing", cena: 2, ddv: 22 }]);
    req.query.dryRun = "false";
    state.articles[0]!.taxCategory = "other";
    await uvoziArtikliExcel(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.napake[0].napaka).toContain("spremenjen po izvozu");
    expect(state.writes).toBe(0);
  });

  it("rejects a non-sales composite owner with a prepared bulk ingredient during preview", async () => {
    state.articles[0] = {
      ...state.articles[0],
      mealType: "composite",
      nabavniArtikel: false,
      prodajniArtikel: true,
      enotaMere: null,
    };
    state.articles.push({
      id: 35, enotaId: 5, ime: "Goulash", cena: "0", davek: "0",
      mealType: "prepared", enotaMere: "KGM",
      nabavniArtikel: false, prodajniArtikel: false, povratnaEmbalaza: false, drobniInventar: false,
    });
    state.norms = [{ artikelId: 31, vhodniArtikelId: 35, kolicina: "0.35" }];

    const { res } = await workbookUpload([{
      id: 31, ime: "Existing", cena: 2, ddv: 22, prodajniArtikel: false,
    }]);
    expect(res.statusCode).toBe(422);
    expect(res.body.napake.some((error: { napaka: string }) => error.napaka.includes("morajo ostati prodajne"))).toBe(true);
    expect(state.writes).toBe(0);
  });

  it("rechecks bulk ingredient ownership under the import transaction locks", async () => {
    state.articles[0] = {
      ...state.articles[0],
      mealType: "composite",
      nabavniArtikel: false,
      prodajniArtikel: true,
      enotaMere: null,
    };
    state.articles.push({
      id: 35, enotaId: 5, ime: "Goulash", cena: "0", davek: "0",
      mealType: "prepared", enotaMere: "KGM",
      nabavniArtikel: false, prodajniArtikel: false, povratnaEmbalaza: false, drobniInventar: false,
    });
    const { req, res } = await workbookUpload([{
      id: 31, ime: "Existing", cena: 2, ddv: 22, prodajniArtikel: false,
    }]);
    req.query.dryRun = "false";
    state.onLock = () => {
      state.norms.push({ artikelId: 31, vhodniArtikelId: 35, kolicina: "0.35" });
    };

    await uvoziArtikliExcel(req, res);

    expect(state.norms.some(norm => norm.artikelId === 31 && norm.vhodniArtikelId === 35)).toBe(true);
    expect(res.statusCode).toBe(422);
    expect(res.body.napake[0].napaka).toContain("sestavinami v kg ali l");
    expect(state.writes).toBe(0);
  });

  it("rejects invalid tax and unknown category values", async () => {
    const { res } = await workbookUpload([
      { ime: "Would be valid", cena: 1, ddv: 22, kategorija: "" },
      { ime: "New", cena: 1, ddv: 12, kategorija: "Unknown" },
    ]);
    expect(res.statusCode).toBe(422);
    expect(res.body.napake.some((e: { napaka: string }) => e.napaka.includes("DDV"))).toBe(true);
    expect(res.body.napake.some((e: { napaka: string }) => e.napaka.includes("Kategorija"))).toBe(true);
    expect(state.writes).toBe(0);
    expect(state.articles.some(article => article.ime === "Would be valid")).toBe(false);
  });

  it("rejects a row placed on a contradictory specialty sheet", async () => {
    state.articles.push({ id: 33, enotaId: 5, ime: "Regular", povratnaEmbalaza: false, drobniInventar: false });
    const { res } = await workbookUpload([{ id: 33, ime: "Regular", cena: 1, ddv: 22 }], "Povratna embalaža");
    expect(res.statusCode).toBe(422);
    expect(res.body.napake.some((item: { napaka: string }) => item.napaka.includes("drugemu tipu"))).toBe(true);
    expect(state.writes).toBe(0);
  });

  it("rejects changing an existing article's unit and invalid inventory roles", async () => {
    state.articles.push({
      id: 34, enotaId: 5, ime: "Bad inventory", cena: "3.00", davek: "22",
      povratnaEmbalaza: false, drobniInventar: true, nabavniArtikel: false,
      prodajniArtikel: false, vrstaArtikla: "material", enotaMere: "kom",
    });
    const unit = await workbookUpload([{ id: 31, ime: "Existing", cena: 1, ddv: 22, enotaMere: "kg" }]);
    expect(unit.res.statusCode).toBe(422);
    expect(unit.res.body.napake.some((e: { napaka: string }) => e.napaka.includes("Merske enote"))).toBe(true);
    const inventory = await workbookUpload([{
      id: 34, ime: "Bad inventory", cena: 3, ddv: 22, vrstaArtikla: "material",
      nabavniArtikel: "NE", prodajniArtikel: "NE", drobniInventar: "DA",
    }], "Drobni inventar");
    expect(inventory.res.statusCode).toBe(422);
    expect(inventory.res.body.napake.some((e: { napaka: string }) => e.napaka.includes("mora ostati"))).toBe(true);
    expect(state.writes).toBe(0);
  });

  it("rejects creating small inventory with a sales role", async () => {
    const { res } = await workbookUpload([{
      ime: "Invalid inventory", cena: 5, ddv: 22, vrstaArtikla: "material",
      nabavniArtikel: "DA", prodajniArtikel: "DA", povratnaEmbalaza: "NE",
      drobniInventar: "DA", taxCategory: "other",
    }], "Drobni inventar");
    expect(res.statusCode).toBe(422);
    expect(res.body.napake.some((e: { napaka: string }) => e.napaka.includes("samo nabavni"))).toBe(true);
    expect(state.writes).toBe(0);
  });

  it("validates tax category rather than inferring or creating values", async () => {
    const { res } = await workbookUpload([{ ime: "New", cena: 1, ddv: 22, taxCategory: "invented" }]);
    expect(res.statusCode).toBe(422);
    expect(res.body.napake.some((e: { napaka: string }) => e.napaka.includes("taxCategory"))).toBe(true);
    expect(state.writes).toBe(0);
  });

  it("rejects changed normative data instead of bypassing revision/cycle guards", async () => {
    state.norms = [{ id: 70, artikelId: 31, vhodniArtikelId: 31, kolicina: "1.0000", vrstniRed: 0 }];
    const workbook = new ExcelJS.Workbook();
    const norms = workbook.addWorksheet("Normativi");
    norms.addRow(["artikelId", "sestavinaId", "artikelIme", "sestavinaIme", "kolicina"]);
    norms.addRow([31, 31, "Existing", "Existing", 2]);
    const req: any = { enotaId: 5, vloga: "admin", file: { buffer: await workbook.xlsx.writeBuffer() }, query: { dryRun: "true" } };
    const res: any = {
      statusCode: 200, body: undefined,
      status(code: number) { this.statusCode = code; return this; },
      json(value: unknown) { this.body = value; return this; },
    };
    await uvoziArtikliExcel(req, res);
    expect(res.statusCode).toBe(422);
    expect(res.body.napake[0].napaka).toContain("Sprememba količine normativa ni dovoljena");
    expect(state.writes).toBe(0);
  });

  it("applies valid catalog and normative data atomically", async () => {
    const { req, res } = await workbookUpload([{ ime: "Created", cena: 2, ddv: 9.5 }]);
    req.query.dryRun = "false";
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Artikli");
    sheet.addRow(["ime", "cena", "ddv", "vrstaArtikla", "kategorija", "gtin", "nabavnaDdvStopnja", "taxCategory"]);
    sheet.addRow(["Created", 2, 9.5, "blago", "Pijača", "12345670", 5, "food"]);
    const packaging = workbook.addWorksheet("Povratna embalaža");
    packaging.addRow(["ime", "cena", "ddv", "vrstaArtikla", "povratnaEmbalaza", "vrstaEmbalaze", "depozitnaVrednost"]);
    packaging.addRow(["Returnable bottle", 0.2, 22, "blago", "DA", "steklenica", 0.1]);
    const inventory = workbook.addWorksheet("Drobni inventar");
    inventory.addRow(["ime", "cena", "ddv", "vrstaArtikla", "nabavniArtikel", "prodajniArtikel", "povratnaEmbalaza", "drobniInventar", "drobniInventarPredlogaKljuc"]);
    inventory.addRow(["Kitchen tool", 5, 22, "material", "DA", "NE", "NE", "DA", "tool-v1"]);
    const norms = workbook.addWorksheet("Normativi");
    norms.addRow(["artikelId", "sestavinaId", "artikelIme", "sestavinaIme", "kolicina"]);
    norms.addRow([31, 31, "Existing", "Existing", 1]);
    state.norms.push({ id: 70, artikelId: 31, vhodniArtikelId: 31, kolicina: "1.0000", vrstniRed: 0 });
    req.file.buffer = await workbook.xlsx.writeBuffer();
    await uvoziArtikliExcel(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.uvozenih).toBe(3);
    expect(res.body.normativiUvozenih).toBe(0);
    expect(state.articles.some(article => article.ime === "Created" && article.enotaId === 5
      && article.gtin === "12345670" && article.nabavnaDdvStopnja === "5" && article.taxCategory === "food")).toBe(true);
    expect(state.articles.some(article => article.ime === "Returnable bottle" && article.povratnaEmbalaza && article.vrstaEmbalaze === "steklenica")).toBe(true);
    expect(state.articles.some(article => article.ime === "Kitchen tool" && article.drobniInventar && article.drobniInventarPredlogaKljuc === "tool-v1")).toBe(true);
    expect(state.norms).toHaveLength(1);
  });
});