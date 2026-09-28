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
let app: express.Express;

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
    expect(workbook.getWorksheet("Artikli")?.getCell("L3").value).toEqual(expect.objectContaining({ formula: expect.any(String) }));
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
});