import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  artikliTable,
  companiesTable,
  db,
  enoteTable,
  pool,
  preparedFoodDailyLedgersTable,
  preparedFoodWasteRecordLinesTable,
  preparedFoodWasteRecordsTable,
} from "@workspace/db";
import preparedFoodRouter from "./prepared-food";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
const FIRST_DATE = "2097-04-10";
const LATEST_DATE = "2097-04-11";

let companyId: string;
let enotaId: number;
let articleId: number;
let recordId: number;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).enotaId = enotaId;
    next();
  });
  app.use(preparedFoodRouter);
  return app;
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_PFW_${RUN_ID}`,
    naziv: `Podjetje kala ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company.id;
  const [unit] = await db.insert(enoteTable).values({
    companyId,
    ime: `Kuhinja ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  enotaId = unit.id;
  const [article] = await db.insert(artikliTable).values({
    enotaId,
    ime: `Enolončnica ${RUN_ID}`,
    cena: "8.00",
    enotaMere: "porcija",
    mealType: "prepared",
  }).returning({ id: artikliTable.id });
  articleId = article.id;
  await db.insert(preparedFoodDailyLedgersTable).values([
    {
      enotaId,
      businessDate: FIRST_DATE,
      artikelId: articleId,
      preparedQuantity: "3",
      soldQuantity: "1",
      wasteQuantity: "2",
      wasteValue: "6",
      closedAt: new Date(),
    },
    {
      enotaId,
      businessDate: LATEST_DATE,
      artikelId: articleId,
      preparedQuantity: "1",
    },
  ]);
});

afterAll(async () => {
  if (recordId) {
    await db.delete(preparedFoodWasteRecordLinesTable)
      .where(eq(preparedFoodWasteRecordLinesTable.recordId, recordId));
  }
  await db.delete(preparedFoodWasteRecordsTable)
    .where(eq(preparedFoodWasteRecordsTable.enotaId, enotaId));
  await db.delete(preparedFoodDailyLedgersTable)
    .where(eq(preparedFoodDailyLedgersTable.enotaId, enotaId));
  await db.delete(artikliTable).where(inArray(artikliTable.id, [articleId]));
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("dnevne evidence pripravljene hrane", () => {
  it("vrne zgodovino in samo zadnji odprti dan označi kot uredljiv", async () => {
    const response = await supertest(buildApp()).get("/prepared-food/daily/history/2097");
    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(2);
    expect(response.body.find((row: any) => row.businessDate.startsWith(FIRST_DATE)).editable).toBe(false);
    expect(response.body.find((row: any) => row.businessDate.startsWith(LATEST_DATE)).editable).toBe(true);
  });

  it("strežniško zavrne spremembo starejšega dne", async () => {
    const response = await supertest(buildApp())
      .put(`/prepared-food/daily/${FIRST_DATE}/${articleId}`)
      .send({ thawedQuantity: 0, preparedQuantity: 4, correctionQuantity: 0, frozenAtEndQuantity: 0 });
    expect(response.status).toBe(409);
    expect(response.body.error).toContain("zadnjo odprto");
  });
});

describe("zapisnik kala", () => {
  it("pripravi dnevne vrstice in rekapitulacijo ter shrani osnutek", async () => {
    await db.update(preparedFoodDailyLedgersTable)
      .set({ wasteDeliveredQuantity: "0.5" })
      .where(and(
        eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
        eq(preparedFoodDailyLedgersTable.businessDate, FIRST_DATE),
        eq(preparedFoodDailyLedgersTable.artikelId, articleId),
      ));

    const preview = await supertest(buildApp())
      .get(`/prepared-food/waste-records/preview?from=${FIRST_DATE}&to=${FIRST_DATE}`);
    expect(preview.status).toBe(200);
    expect(preview.body.totalQuantity).toBe(1.5);
    expect(preview.body.dailyLines[0]).toMatchObject({
      articleId,
      quantity: 1.5,
      unitOfMeasure: "porcija",
    });

    const created = await supertest(buildApp())
      .post("/prepared-food/waste-records")
      .send({
        recordDate: FIRST_DATE,
        periodFrom: FIRST_DATE,
        periodTo: FIRST_DATE,
        wasteObservedAt: `${FIRST_DATE}T18:00:00.000Z`,
        disposalReason: "Pokvarljivost",
        signaturePerson: "Predal A",
        signatureManager: "Vodja B",
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      recordNumber: 1,
      companyName: `Podjetje kala ${RUN_ID}`,
      businessUnitName: `Kuhinja ${RUN_ID}`,
      status: "osnutek",
      totalQuantity: 1.5,
    });
    recordId = created.body.id;

    const [financialSnapshot] = await db.select({
      quantity: preparedFoodWasteRecordLinesTable.quantity,
      costPerUnit: preparedFoodWasteRecordLinesTable.costPerUnit,
      totalValue: preparedFoodWasteRecordLinesTable.totalValue,
    }).from(preparedFoodWasteRecordLinesTable)
      .where(eq(preparedFoodWasteRecordLinesTable.recordId, recordId));
    expect(financialSnapshot).toEqual({
      quantity: "1.5000",
      costPerUnit: "3.000000",
      totalValue: "4.5000",
    });

    const pdf = await supertest(buildApp())
      .get(`/prepared-food/waste-records/${recordId}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(Buffer.from(pdf.body).subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(Buffer.from(pdf.body).toString("latin1")).toContain("/Count 1");
  });

  it("atomsko potrdi zapisnik, odda ves kalo in ga zaklene", async () => {
    const confirmed = await supertest(buildApp())
      .post(`/prepared-food/waste-records/${recordId}/confirm`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe("potrjen");

    const [ledger] = await db.select().from(preparedFoodDailyLedgersTable).where(and(
      eq(preparedFoodDailyLedgersTable.enotaId, enotaId),
      eq(preparedFoodDailyLedgersTable.businessDate, FIRST_DATE),
      eq(preparedFoodDailyLedgersTable.artikelId, articleId),
    ));
    expect(ledger.wasteDeliveredQuantity).toBe("2.0000");

    const emptyPreview = await supertest(buildApp())
      .get(`/prepared-food/waste-records/preview?from=${FIRST_DATE}&to=${FIRST_DATE}`);
    expect(emptyPreview.body.totalQuantity).toBe(0);

    const update = await supertest(buildApp())
      .put(`/prepared-food/waste-records/${recordId}`)
      .send({
        recordDate: FIRST_DATE,
        periodFrom: FIRST_DATE,
        periodTo: FIRST_DATE,
        wasteObservedAt: `${FIRST_DATE}T18:00:00.000Z`,
        disposalReason: "Drug razlog",
        signaturePerson: "Predal A",
        signatureManager: "Vodja B",
      });
    expect(update.status).toBe(409);
    expect(update.body.error).toContain("ni mogoče spreminjati");
  });
});