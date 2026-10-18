import express from "express";
import supertest from "supertest";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { artikliTable, companiesTable, db, enoteTable } from "@workspace/db";
import { eq } from "drizzle-orm";

vi.mock("../../middlewares/pos", () => ({
  requireEnota: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as any).enotaId = Number(req.header("x-enota-id"));
    (req as any).vloga = "admin";
    next();
  },
}));

const run = `excel-roundtrip-${Math.random().toString(36).slice(2)}`;
let companyId = "";
let unitId = 0;
let targetUnitId = 0;
let app: express.Express;

async function exportWorkbook() {
  const exported = await supertest(app)
    .get("/artikli/izvozi-excel")
    .set("x-enota-id", String(unitId))
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(Buffer.from(chunk)));
      response.on("end", () => callback(null, Buffer.concat(chunks)));
    });
  expect(exported.status).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(exported.body as any);
  return workbook;
}

async function importWorkbook(workbook: ExcelJS.Workbook, unit = unitId) {
  return supertest(app)
    .post("/artikli/uvozi-excel")
    .set("x-enota-id", String(unit))
    .attach("excel", Buffer.from(await workbook.xlsx.writeBuffer()), "catalog.xlsx");
}

const articleSheets = ["Artikli", "Povratna embalaža", "Drobni inventar"];
function column(sheet: ExcelJS.Worksheet, name: string) {
  let index = 0;
  sheet.getRow(1).eachCell((cell, col) => {
    if (cell.value === name) index = col;
  });
  expect(index).toBeGreaterThan(0);
  return index;
}

describe("POS article Excel export/import roundtrip", () => {
  beforeAll(async () => {
    const { default: artikliRouter } = await import("./artikli");
    app = express();
    app.use(artikliRouter);

    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `${run}-tax`,
      naziv: run,
    }).returning({ id: companiesTable.id });
    companyId = company!.id;
    const [unit] = await db.insert(enoteTable).values({
      companyId,
      ime: `${run}-unit`,
    }).returning({ id: enoteTable.id });
    unitId = unit!.id;
    const [target] = await db.insert(enoteTable).values({
      companyId, ime: `${run}-target`,
    }).returning({ id: enoteTable.id });
    targetUnitId = target!.id;

    await db.insert(artikliTable).values([
      {
        enotaId: unitId,
        ime: `${run}-regular`,
        cena: "2.50",
        davek: "22",
        vrstaArtikla: "blago",
        nabavniArtikel: true,
        prodajniArtikel: true,
        taxCategory: "food",
        kdsIzkljucen: false,
      },
      {
        enotaId: unitId,
        ime: `${run}-excluded`,
        cena: "1.00",
        davek: "22",
        vrstaArtikla: "storitev",
        kdsIzkljucen: true,
      },
      {
        enotaId: unitId,
        ime: `${run}-returnable`,
        cena: "0.20",
        davek: "22",
        vrstaArtikla: "blago",
        povratnaEmbalaza: true,
        vrstaEmbalaze: "steklenica",
        depozitnaVrednost: "0.10",
        kdsIzkljucen: true,
      },
      {
        enotaId: unitId,
        ime: `${run}-inventory`,
        cena: "5.00",
        davek: "22",
        vrstaArtikla: "material",
        nabavniArtikel: true,
        prodajniArtikel: false,
        drobniInventar: true,
        taxCategory: "other",
        drobniInventarPredlogaKljuc: "tool-v1",
        kdsIzkljucen: true,
      },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  });

  it("previews an untouched GET-exported workbook, including formula-only templates", async () => {
    const exported = await supertest(app)
      .get("/artikli/izvozi-excel")
      .set("x-enota-id", String(unitId))
      .buffer(true)
      .parse((response, callback) => {
        const chunks: Buffer[] = [];
        response.on("data", chunk => chunks.push(Buffer.from(chunk)));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(exported.status).toBe(200);
    expect(exported.headers["content-type"]).toContain("spreadsheetml");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body as any);
    expect(workbook.getWorksheet("Artikli")?.getCell("L4").value).toEqual(expect.objectContaining({ formula: expect.any(String) }));
    expect(workbook.getWorksheet("Povratna embalaža")?.rowCount).toBeGreaterThan(1);
    expect(workbook.getWorksheet("Drobni inventar")?.rowCount).toBeGreaterThan(1);

    const preview = await supertest(app)
      .post("/artikli/uvozi-excel?dryRun=true")
      .set("x-enota-id", String(unitId))
      .attach("excel", exported.body as Buffer, {
        filename: "catalog-roundtrip.xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
    expect(preview.status).toBe(200);
    expect(preview.body.napake).toEqual([]);
    expect(preview.body.predogled).toEqual(expect.arrayContaining([
      expect.objectContaining({ ime: `${run}-regular`, list: "Artikli", dejanje: "posodobi" }),
      expect.objectContaining({ ime: `${run}-returnable`, list: "Povratna embalaža", dejanje: "posodobi" }),
      expect.objectContaining({ ime: `${run}-inventory`, list: "Drobni inventar", dejanje: "posodobi" }),
    ]));
  }, 60_000);

  it("exports explicit DA/NE flags and preserves them when copied to another unit", async () => {
    const workbook = await exportWorkbook();
    for (const name of articleSheets) {
      const sheet = workbook.getWorksheet(name)!;
      const flag = column(sheet, "kdsIzkljucen");
      expect(sheet.getRow(1).getCell(flag).note).toContain("Ne prikazuj na KDS");
      expect(sheet.getRow(2).getCell(flag).dataValidation.formulae).toEqual(['"DA,NE"']);
      sheet.eachRow((row, number) => {
        if (number === 1 || !row.getCell(2).value) return;
        expect(row.getCell(flag).value).toBe(row.getCell(2).value === `${run}-regular` ? "NE" : "DA");
        row.getCell(1).value = null; // IDs belong to the source unit, not the target.
      });
    }
    const imported = await importWorkbook(workbook, targetUnitId);
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    expect(imported.body.uvozenih).toBe(4);
    const copied = await db.select().from(artikliTable).where(eq(artikliTable.enotaId, targetUnitId));
    expect(copied).toHaveLength(4);
    for (const row of copied) expect(row.kdsIzkljucen).toBe(row.ime !== `${run}-regular`);
  }, 60_000);

  it("applies explicit flags in both directions, including NE over a saved exclusion", async () => {
    const workbook = await exportWorkbook();
    const sheet = workbook.getWorksheet("Artikli")!;
    const flag = column(sheet, "kdsIzkljucen");
    sheet.eachRow((row, number) => {
      if (number > 1 && row.getCell(2).value) {
        row.getCell(flag).value = row.getCell(2).value === `${run}-regular` ? "DA" : "NE";
      }
    });
    const imported = await importWorkbook(workbook);
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    const saved = await db.select().from(artikliTable).where(eq(artikliTable.enotaId, unitId));
    expect(saved.find(row => row.ime === `${run}-regular`)?.kdsIzkljucen).toBe(true);
    expect(saved.find(row => row.ime === `${run}-excluded`)?.kdsIzkljucen).toBe(false);
  }, 60_000);

  it("accepts old workbooks without the column or snapshot field without changing saved flags", async () => {
    const workbook = await exportWorkbook();
    const before = await db.select().from(artikliTable).where(eq(artikliTable.enotaId, unitId));
    for (const name of articleSheets) {
      const sheet = workbook.getWorksheet(name)!;
      sheet.spliceColumns(column(sheet, "kdsIzkljucen"), 1);
    }
    workbook.getWorksheet("Sifranti")!.eachRow(row => {
      if (!row.getCell(3).value) return;
      const baseline = JSON.parse(String(row.getCell(4).value));
      delete baseline.fields.kdsIzkljucen;
      row.getCell(4).value = JSON.stringify(baseline);
    });
    const sheet = workbook.getWorksheet("Artikli")!;
    const newRow = sheet.getRow(4);
    newRow.getCell(2).value = `${run}-legacy-new`;
    newRow.getCell(3).value = 1;
    newRow.getCell(4).value = 22;
    const imported = await importWorkbook(workbook);
    expect(imported.status, JSON.stringify(imported.body)).toBe(200);
    expect(imported.body.posodobljenih).toBe(4);
    expect(imported.body.uvozenih).toBe(1);
    const after = await db.select().from(artikliTable).where(eq(artikliTable.enotaId, unitId));
    for (const old of before) expect(after.find(row => row.id === old.id)?.kdsIzkljucen).toBe(old.kdsIzkljucen);
    expect(after.find(row => row.ime === `${run}-legacy-new`)?.kdsIzkljucen).toBe(false);
  }, 60_000);

  it("preserves flags for blank cells and rejects invalid values without any writes", async () => {
    const workbook = await exportWorkbook();
    const before = await db.select().from(artikliTable).where(eq(artikliTable.enotaId, unitId));
    for (const name of articleSheets) {
      const sheet = workbook.getWorksheet(name)!;
      const flag = column(sheet, "kdsIzkljucen");
      sheet.eachRow((row, number) => { if (number > 1) row.getCell(flag).value = null; });
    }
    expect((await importWorkbook(workbook)).status).toBe(200);
    expect(await db.select().from(artikliTable).where(eq(artikliTable.enotaId, unitId))).toEqual(before);
    const sheet = workbook.getWorksheet("Artikli")!;
    sheet.getRow(2).getCell(column(sheet, "kdsIzkljucen")).value = "morda";
    const invalid = await importWorkbook(workbook);
    expect(invalid.status).toBe(422);
    expect(invalid.body.napake).toEqual(expect.arrayContaining([
      expect.objectContaining({ napaka: "Polje kdsIzkljucen mora biti DA ali NE." }),
    ]));
    expect(await db.select().from(artikliTable).where(eq(artikliTable.enotaId, unitId))).toEqual(before);
  }, 60_000);

  it("rejects a stale export if the saved KDS setting changed after export", async () => {
    const workbook = await exportWorkbook();
    const [article] = await db.select().from(artikliTable).where(eq(artikliTable.enotaId, unitId));
    await db.update(artikliTable).set({ kdsIzkljucen: !article!.kdsIzkljucen })
      .where(eq(artikliTable.id, article!.id));
    const imported = await importWorkbook(workbook);
    expect(imported.status).toBe(422);
    expect(imported.body.napake).toEqual(expect.arrayContaining([
      expect.objectContaining({ napaka: expect.stringContaining("spremenjen po izvozu") }),
    ]));
    const [saved] = await db.select().from(artikliTable).where(eq(artikliTable.id, article!.id));
    expect(saved!.kdsIzkljucen).toBe(!article!.kdsIzkljucen);
  }, 60_000);
});