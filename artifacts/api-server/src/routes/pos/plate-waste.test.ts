import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import {
  companiesTable,
  db,
  enoteTable,
  plateWasteDailyEntriesTable,
  plateWasteHandoversTable,
  pool,
  posUporabnikiTable,
  preparedFoodDailyLedgersTable,
} from "@workspace/db";
import plateWasteRouter from "./plate-waste";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
const DATE = "2098-05-12";
let companyId: string;
let enotaId: number;
let handoverId: number;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).enotaId = enotaId;
    (req as any).clerkUserId = `test-user-${RUN_ID}`;
    next();
  });
  app.use(plateWasteRouter);
  return app;
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_PW_${RUN_ID}`,
    naziv: `Podjetje odpadki ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company.id;
  const [unit] = await db.insert(enoteTable).values({
    companyId,
    ime: `Restavracija ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  enotaId = unit.id;
  await db.insert(posUporabnikiTable).values({
    clerkUserId: `test-user-${RUN_ID}`,
    companyId,
    enotaId,
    vloga: "admin_enote",
    ime: "Maja",
    priimek: `Test ${RUN_ID}`,
  });
});

afterAll(async () => {
  await db.delete(plateWasteHandoversTable).where(eq(plateWasteHandoversTable.enotaId, enotaId));
  await db.delete(plateWasteDailyEntriesTable).where(eq(plateWasteDailyEntriesTable.enotaId, enotaId));
  await db.delete(posUporabnikiTable).where(eq(posUporabnikiTable.companyId, companyId));
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("ločena evidenca odpadkov s krožnikov", () => {
  it("shrani dnevni vnos brez posega v evidenco pripravljene hrane", async () => {
    const created = await supertest(buildApp())
      .put(`/plate-waste/daily/${DATE}`)
      .send({ quantityKg: 2.5, note: "Kosilo" });

    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      enotaId,
      quantityKg: 2.5,
      note: "Kosilo",
      createdByName: `Maja Test ${RUN_ID}`,
    });

    const preparedRows = await db.select({ id: preparedFoodDailyLedgersTable.id })
      .from(preparedFoodDailyLedgersTable)
      .where(eq(preparedFoodDailyLedgersTable.enotaId, enotaId));
    expect(preparedRows).toHaveLength(0);
  });

  it("zavrne negativni dnevni vnos", async () => {
    const response = await supertest(buildApp())
      .put(`/plate-waste/daily/${DATE}`)
      .send({ quantityKg: -1 });
    expect(response.status).toBe(400);
  });

  it("zabeleži oddajo in sledljivi popravek kot novi vrstici", async () => {
    const handover = await supertest(buildApp())
      .post("/plate-waste/handovers")
      .send({
        handoverDate: DATE,
        entryType: "oddaja",
        quantityKg: 1.2,
        collectorName: "Prevzemnik d.o.o.",
        manifestNumber: "EL-42",
      });
    expect(handover.status).toBe(201);
    handoverId = handover.body.id;

    const correction = await supertest(buildApp())
      .post("/plate-waste/handovers")
      .send({
        handoverDate: DATE,
        entryType: "popravek",
        quantityKg: -0.2,
        collectorName: "Prevzemnik d.o.o.",
        correctionOfId: handoverId,
        note: "Popravek tehtanja",
      });
    expect(correction.status).toBe(201);
    expect(correction.body).toMatchObject({
      entryType: "popravek",
      quantityKg: -0.2,
      correctionOfId: handoverId,
      createdByName: `Maja Test ${RUN_ID}`,
    });

    const pdf = await supertest(buildApp()).get(`/plate-waste/handovers/${handoverId}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain(`odpadki-kroznik-${handoverId}.pdf`);
    expect(Buffer.from(pdf.body).subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const overview = await supertest(buildApp()).get(`/plate-waste?from=${DATE}&to=${DATE}`);
    expect(overview.status).toBe(200);
    expect(overview.body).toMatchObject({
      categoryCode: "20 01 08",
      source: "ostanki s krožnikov",
      summary: {
        generatedQuantityKg: 2.5,
        handedOverQuantityKg: 1,
        remainingQuantityKg: 1.5,
      },
    });
    expect(overview.body.handovers).toHaveLength(2);
  });

  it("ne sprejme popravka, vezanega na drugo oziroma neobstoječo oddajo", async () => {
    const response = await supertest(buildApp())
      .post("/plate-waste/handovers")
      .send({
        handoverDate: DATE,
        entryType: "popravek",
        quantityKg: -0.1,
        collectorName: "Prevzemnik d.o.o.",
        correctionOfId: 2147483647,
      });
    expect(response.status).toBe(422);
  });

  it("zahteva povezavo samo pri popravku in samo na izvirno oddajo", async () => {
    const unlinkedCorrection = await supertest(buildApp())
      .post("/plate-waste/handovers")
      .send({
        handoverDate: DATE,
        entryType: "popravek",
        quantityKg: -0.1,
        collectorName: "Prevzemnik d.o.o.",
      });
    expect(unlinkedCorrection.status).toBe(422);

    const linkedHandover = await supertest(buildApp())
      .post("/plate-waste/handovers")
      .send({
        handoverDate: DATE,
        entryType: "oddaja",
        quantityKg: 0.1,
        collectorName: "Prevzemnik d.o.o.",
        correctionOfId: handoverId,
      });
    expect(linkedHandover.status).toBe(422);

    const rows = await db.select()
      .from(plateWasteHandoversTable)
      .where(eq(plateWasteHandoversTable.enotaId, enotaId));
    const correction = rows.find((row) => row.entryType === "popravek");
    expect(correction).toBeDefined();

    const correctionOfCorrection = await supertest(buildApp())
      .post("/plate-waste/handovers")
      .send({
        handoverDate: DATE,
        entryType: "popravek",
        quantityKg: 0.1,
        collectorName: "Prevzemnik d.o.o.",
        correctionOfId: correction!.id,
      });
    expect(correctionOfCorrection.status).toBe(422);

    const belowZero = await supertest(buildApp())
      .post("/plate-waste/handovers")
      .send({
        handoverDate: DATE,
        entryType: "popravek",
        quantityKg: -1.1,
        collectorName: "Prevzemnik d.o.o.",
        correctionOfId: handoverId,
      });
    expect(belowZero.status).toBe(422);
  });

  it("tudi baza neposredno zavrne oddaje in popravke brez pravilne povezave", async () => {
    const expectConstraintViolation = async (
      values: typeof plateWasteHandoversTable.$inferInsert,
    ) => {
      try {
        await db.insert(plateWasteHandoversTable).values(values);
        expect.fail("Baza je sprejela neveljavno povezavo popravka.");
      } catch (error) {
        expect((error as { cause?: { constraint?: string } }).cause?.constraint)
          .toBe("plate_waste_handovers_correction_reference_check");
      }
    };

    await expectConstraintViolation({
      enotaId,
      handoverDate: DATE,
      entryType: "popravek",
      quantityKg: "-0.1",
      collectorName: "Prevzemnik d.o.o.",
      createdBy: `test-user-${RUN_ID}`,
    });

    await expectConstraintViolation({
      enotaId,
      handoverDate: DATE,
      entryType: "oddaja",
      quantityKg: "0.1",
      collectorName: "Prevzemnik d.o.o.",
      correctionOfId: handoverId,
      createdBy: `test-user-${RUN_ID}`,
    });
  });

  it("zavrne neobstoječe koledarske datume brez tihe normalizacije", async () => {
    expect((await supertest(buildApp()).get("/plate-waste?from=2098-02-30&to=2098-03-02")).status).toBe(400);
    expect((await supertest(buildApp())
      .put("/plate-waste/daily/2098-02-30")
      .send({ quantityKg: 1 })).status).toBe(400);
    expect((await supertest(buildApp())
      .post("/plate-waste/handovers")
      .send({
        handoverDate: "2098-02-30",
        entryType: "oddaja",
        quantityKg: 1,
        collectorName: "Prevzemnik d.o.o.",
      })).status).toBe(400);
    expect((await supertest(buildApp())
      .get("/plate-waste/export?from=2098-02-30&to=2098-03-02")).status).toBe(400);
  });

  it("izvozi ločeno evidenco kot CSV", async () => {
    await supertest(buildApp())
      .put(`/plate-waste/daily/${DATE}`)
      .send({ quantityKg: 2.5, note: "=HYPERLINK(\"https://example.test\")" });
    const response = await supertest(buildApp()).get(`/plate-waste/export?from=${DATE}&to=${DATE}`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.text).toContain("Nastanek");
    expect(response.text).toContain("Prevzemnik d.o.o.");
    expect(response.text).toContain(`Maja Test ${RUN_ID}`);
    expect(response.text).toContain("'=HYPERLINK");
    expect(response.text).not.toContain(';"=HYPERLINK');
  });
});