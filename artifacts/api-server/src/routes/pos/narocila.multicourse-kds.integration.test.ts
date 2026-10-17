import express from "express";
import supertest from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  artikliTable, companiesTable, db, enoteTable, kdsDogodkiTable,
  kdsIzdajaDogodkiTable, kdsNalogiTable, kdsNastavitveTable,
  kdsPostajeTable, kdsPostajaMapiranjaTable, multicourseMenuCoursesTable,
  multicourseMenusTable, narocilaTable, pool, postavkeTable,
} from "@workspace/db";
import narocilaRouter from "./narocila";

// Deliberately do not mock ./kds: the POST itself must persist every ticket
// and its materialization event, without a GET or explicit repair afterwards.
const companyIds: string[] = [];
const orderIds: number[] = [];

afterAll(async () => {
  try {
    await db.transaction(async (tx) => {
      // Follow the KDS append-only fixture cleanup pattern, but keep DDL and
      // deletes in one transaction. A failure rolls back trigger changes too.
      await tx.execute(sql`ALTER TABLE kds_dogodki DISABLE TRIGGER kds_dogodki_append_only`);
      try {
        await tx.execute(sql`ALTER TABLE kds_izdaja_dogodki DISABLE TRIGGER kds_izdaja_dogodki_append_only`);
        try {
          if (orderIds.length) {
            const tickets = await tx.select({ id: kdsNalogiTable.id }).from(kdsNalogiTable)
              .where(inArray(kdsNalogiTable.narociloId, orderIds));
            if (tickets.length) {
              await tx.delete(kdsDogodkiTable).where(inArray(kdsDogodkiTable.nalogId, tickets.map(ticket => ticket.id)));
            }
            await tx.delete(kdsIzdajaDogodkiTable).where(inArray(kdsIzdajaDogodkiTable.narociloId, orderIds));
            await tx.delete(kdsNalogiTable).where(inArray(kdsNalogiTable.narociloId, orderIds));
            await tx.delete(postavkeTable).where(inArray(postavkeTable.narociloId, orderIds));
            await tx.delete(narocilaTable).where(inArray(narocilaTable.id, orderIds));
          }
        } finally {
          await tx.execute(sql`ALTER TABLE kds_izdaja_dogodki ENABLE TRIGGER kds_izdaja_dogodki_append_only`);
        }
      } finally {
        await tx.execute(sql`ALTER TABLE kds_dogodki ENABLE TRIGGER kds_dogodki_append_only`);
      }
      if (companyIds.length) {
        const units = tx.select({ id: enoteTable.id }).from(enoteTable)
          .where(inArray(enoteTable.companyId, companyIds));
        // Remove course references before cascading deletion of their articles.
        await tx.delete(multicourseMenusTable).where(inArray(multicourseMenusTable.enotaId, units));
        await tx.delete(companiesTable).where(inArray(companiesTable.id, companyIds));
      }
    });
  } finally {
    await pool.end();
  }
});

describe("direct POS multicourse POST → persistent KDS streams", () => {
  it.each([
    { izbor: "fixed_four" as const, courseNumbers: [3, 1, 4, 2] },
    { izbor: "choose_three" as const, courseNumbers: [4, 2, 1] },
  ])("routes every food/wine component for $izbor in serving order", async ({ izbor, courseNumbers }) => {
    const run = crypto.randomUUID();
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `MC_KDS_${run}`, naziv: `Multicourse KDS ${run}`,
    }).returning();
    companyIds.push(company!.id);
    const [unit] = await db.insert(enoteTable).values({
      companyId: company!.id, ime: `Multicourse KDS ${run}`,
    }).returning();
    const enotaId = unit!.id;
    const [wrapper] = await db.insert(artikliTable).values({
      enotaId, ime: `Meni ${run}`, cena: "80", davek: "9.5", prodajniArtikel: true,
    }).returning();
    const components: Array<{
      courseNumber: number;
      food: typeof artikliTable.$inferSelect;
      wine: typeof artikliTable.$inferSelect;
    }> = [];
    for (let courseNumber = 1; courseNumber <= 4; courseNumber++) {
      const [food] = await db.insert(artikliTable).values({
        enotaId, ime: `Jed ${courseNumber} ${run}`, cena: "10", davek: "9.5",
        pripravaVrsta: "hrana", prodajniArtikel: true,
      }).returning();
      const [wine] = await db.insert(artikliTable).values({
        enotaId, ime: `Vino ${courseNumber} ${run}`, cena: "5", davek: "22",
        pripravaVrsta: "pijaca", prodajniArtikel: true,
      }).returning();
      components.push({ courseNumber, food: food!, wine: wine! });
    }
    const [menu] = await db.insert(multicourseMenusTable).values({
      enotaId, menuArtikelId: wrapper!.id, izbor, foodPricePercent: "75",
      selectionMode: izbor === "fixed_four" ? "fixed" : "choose",
      selectionCount: izbor === "choose_three" ? 3 : null,
    }).returning();
    await db.insert(multicourseMenuCoursesTable).values(components.map(({ courseNumber, food, wine }) => ({
      menuId: menu!.id, courseNumber, courseName: `Hod ${courseNumber}`,
      foodArtikelId: food.id, allowedFoodArtikelIds: [food.id], allowedWineArtikelIds: [wine.id],
    })));

    const [kitchen, bar, fallback] = await db.insert(kdsPostajeTable).values([
      { enotaId, ime: "Kuhinja", tip: "kitchen" },
      { enotaId, ime: "Bar", tip: "bar" },
      { enotaId, ime: "Fallback", tip: "custom" },
    ]).returning();
    await db.insert(kdsNastavitveTable).values({
      enotaId, profil: "custom", fallbackPostajaId: fallback!.id,
    });
    await db.insert(kdsPostajaMapiranjaTable).values(components.flatMap(({ food, wine }) => [
      { artikelId: food.id, postajaId: kitchen!.id },
      { artikelId: wine.id, postajaId: bar!.id },
    ]));
    const [order] = await db.insert(narocilaTable).values({
      enotaId, stevilkaNarocila: 590611,
    }).returning();
    const narociloId = order!.id;
    orderIds.push(narociloId);
    const selections = courseNumbers.map(courseNumber => {
      const { food, wine } = components.find(course => course.courseNumber === courseNumber)!;
      return { courseNumber, foodArtikelId: food.id, wineArtikelId: wine.id };
    });
    const app = express();
    app.use(express.json(), (req, _res, next) => {
      Object.assign(req, {
        companyId: company!.id, enotaId, jeDdvZavezanec: false,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });
      next();
    }, narocilaRouter);
    const response = await supertest(app).post(`/narocila/${narociloId}/multicourse`)
      .send({ menuArtikelId: wrapper!.id, quantity: 1, selections });
    expect(response.status, JSON.stringify(response.body)).toBe(201);

    const lines = await db.select().from(postavkeTable).where(eq(postavkeTable.narociloId, narociloId));
    const courseLines = lines.filter(line => line.courseNumber != null);
    const commercialLines = lines.filter(line => line.courseNumber == null);
    expect(courseLines).toHaveLength(selections.length * 2);
    expect(commercialLines).toHaveLength(2);
    const pairingGroupId = courseLines[0]!.pairingGroupId;
    expect(pairingGroupId).toEqual(expect.stringMatching(/^multicourse:/));
    expect(lines.every(line => line.pairingGroupId === pairingGroupId)).toBe(true);

    const tickets = await db.select().from(kdsNalogiTable).where(eq(kdsNalogiTable.narociloId, narociloId));
    expect(tickets).toHaveLength(selections.length * 2);
    expect(new Set(tickets.map(ticket => ticket.postavkaId)).size).toBe(courseLines.length);
    expect(tickets.some(ticket => commercialLines.some(line => line.id === ticket.postavkaId))).toBe(false);
    for (const [index, selection] of selections.entries()) {
      for (const [artikelId, postajaId] of [
        [selection.foodArtikelId, kitchen!.id],
        [selection.wineArtikelId, bar!.id],
      ]) {
        const matchingLines = courseLines.filter(line => line.artikelId === artikelId);
        expect(matchingLines).toHaveLength(1);
        const line = matchingLines[0]!;
        const metadata = { pairingGroupId, courseNumber: selection.courseNumber, courseSequence: index + 1 };
        expect(line).toMatchObject(metadata);
        expect(tickets.filter(ticket => ticket.postavkaId === line.id)).toEqual([
          expect.objectContaining({
            ...metadata, enotaId, narociloId, postajaId, uporabljenFallback: false,
            stanje: index === 0 ? "aktivno" : "zadrzano",
          }),
        ]);
      }
    }
    const events = await db.select().from(kdsDogodkiTable)
      .where(inArray(kdsDogodkiTable.nalogId, tickets.map(ticket => ticket.id)));
    expect(events).toHaveLength(tickets.length);
    for (const ticket of tickets) {
      expect(events.filter(event => event.nalogId === ticket.id)).toEqual([
        expect.objectContaining({
          tip: "materializiran", zaporedje: 1, idempotencyKey: `materialize:${ticket.id}`,
        }),
      ]);
    }
  });
});
