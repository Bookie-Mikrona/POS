import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, sql } from "drizzle-orm";

import {
  artikliTable,
  companiesTable,
  db,
  enoteTable,
  zalogaGibiTable,
  zalogeTable,
  zacetneZalogePostavkeTable,
  zacetneZalogeTable,
} from "@workspace/db";

import zalogeRouter from "./zaloge";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";
import { appendStockMovementReversals } from "../../lib/stockMovementHistory";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

let companyId = "";
let enotaId = 0;
let artikelId = 0;
let zacetnaZalogaId = 0;
let zalogaGibId = 0;

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).enotaId = enotaId;
    next();
  });
  app.use(zalogeRouter);
  return app;
}

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({
      podjetjeDavcna: `ZAL${RUN_ID}`,
      naziv: `Zaloge test ${RUN_ID}`,
    })
    .returning({ id: companiesTable.id });
  companyId = company.id;

  const [enota] = await db
    .insert(enoteTable)
    .values({
      companyId,
      ime: `Enota zaloge ${RUN_ID}`,
    })
    .returning({ id: enoteTable.id });
  enotaId = enota.id;

  const [artikel] = await db
    .insert(artikliTable)
    .values({
      enotaId,
      ime: `Začetni artikel ${RUN_ID}`,
      cena: "4.00",
      davek: "22",
      vrstniRed: 1,
      nabavniArtikel: true,
    })
    .returning({ id: artikliTable.id });
  artikelId = artikel.id;

  const [zacetnaZaloga] = await db
    .insert(zacetneZalogeTable)
    .values({
      enotaId,
      leto: 2025,
      stevilka: `ZZ-${RUN_ID}`,
      datum: new Date("2025-01-01T00:00:00.000Z"),
    })
    .returning({ id: zacetneZalogeTable.id });
  zacetnaZalogaId = zacetnaZaloga.id;

  await db.insert(zacetneZalogePostavkeTable).values({
    zacetnaZalogaId,
    artikelId,
    kolicina: "10",
    cenaKos: "2.50",
    steviloPrejsnje: "0",
  });

  const [gib] = await db
    .insert(zalogaGibiTable)
    .values({
      artikelId,
      tip: "inventura",
      kolicina: "10",
      cenaKos: "2.50",
      vrednost: "25.00",
      opomba: "Začetne zaloge 2025",
      referencaId: zacetnaZalogaId,
      sourceSnapshot: "test_zacetne_zaloge_fixture",
    })
    .returning({ id: zalogaGibiTable.id });
  zalogaGibId = gib.id;

  await db.insert(zalogeTable).values({
    artikelId,
    kolicina: "10",
    povprecnaCena: "2.500000",
    skupnaVrednost: "25.0000",
  });
});

afterAll(async () => {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.allow_stock_movement_cleanup = 'on'`);
    if (zalogaGibId) {
      await tx.delete(zalogaGibiTable).where(eq(zalogaGibiTable.id, zalogaGibId));
    }
    if (artikelId) {
      await tx.delete(zalogeTable).where(eq(zalogeTable.artikelId, artikelId));
      await tx
        .delete(zacetneZalogePostavkeTable)
        .where(eq(zacetneZalogePostavkeTable.artikelId, artikelId));
    }
    if (zacetnaZalogaId) {
      await tx
        .delete(zacetneZalogeTable)
        .where(eq(zacetneZalogeTable.id, zacetnaZalogaId));
    }
    if (artikelId) {
      await tx.delete(artikliTable).where(eq(artikliTable.id, artikelId));
    }
    if (enotaId) {
      await tx.delete(enoteTable).where(eq(enoteTable.id, enotaId));
    }
    if (companyId) {
      await tx.delete(companiesTable).where(eq(companiesTable.id, companyId));
    }
  });
});

describe("GET /zaloge/kartica/:artikelId", () => {
  it("vrne kartico artikla z začetno zalogo", async () => {
    const response = await supertest(createApp()).get(`/zaloge/kartica/${artikelId}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      artikelId,
      kolicina: 10,
      povprecnaCena: 2.5,
      skupnaVrednost: 25,
    });
    expect(response.body.gibi).toHaveLength(1);
    expect(response.body.gibi[0]).toMatchObject({
      artikelId,
      tip: "inventura",
      kolicina: 10,
      cenaKos: 2.5,
      vrednost: 25,
      opomba: "Začetne zaloge 2025",
      referencaId: zacetnaZalogaId,
    });
  });

  it("edit in delete zgodovinskega prejema ohranita pravilen WAC poznejših gibov", async () => {
    const [artikel] = await db
      .insert(artikliTable)
      .values({
        enotaId,
        ime: `WAC artikel ${RUN_ID}`,
        cena: "4.00",
        davek: "22",
        vrstniRed: 2,
        nabavniArtikel: true,
      })
      .returning({ id: artikliTable.id });
    const referenceId = 800_000_000 + artikel.id;

    try {
      const [original] = await db.insert(zalogaGibiTable).values({
        artikelId: artikel.id,
        tip: "prejemnica",
        kolicina: "10",
        cenaKos: "2",
        vrednost: "20",
        referencaId: referenceId,
        actorSnapshot: "wac-original",
        sourceSnapshot: "prejemnica",
        effectiveAtSnapshot: new Date("2025-01-01T00:00:00.000Z"),
      }).returning({ id: zalogaGibiTable.id });
      await db.insert(zalogaGibiTable).values([
        {
          artikelId: artikel.id,
          tip: "poraba",
          kolicina: "-4",
          cenaKos: "2",
          vrednost: "-8",
          actorSnapshot: "wac-consumer",
          sourceSnapshot: "test_wac_consumption",
          effectiveAtSnapshot: new Date("2025-01-02T00:00:00.000Z"),
        },
        {
          artikelId: artikel.id,
          tip: "prejemnica",
          kolicina: "10",
          cenaKos: "4",
          vrednost: "40",
          actorSnapshot: "wac-later",
          sourceSnapshot: "test_wac_later_receipt",
          effectiveAtSnapshot: new Date("2025-01-03T00:00:00.000Z"),
        },
      ]);

      await appendStockMovementReversals(db, {
        referenceId,
        sourceSnapshots: ["prejemnica"],
        actorSnapshot: "wac-editor",
        reversalSourceSnapshot: "prejemnica_reversal",
        note: "WAC test edit",
      });
      const [replacement] = await db.insert(zalogaGibiTable).values({
        artikelId: artikel.id,
        tip: "prejemnica",
        kolicina: "10",
        cenaKos: "3",
        vrednost: "30",
        referencaId: referenceId,
        actorSnapshot: "wac-editor",
        sourceSnapshot: "prejemnica",
        effectiveAtSnapshot: new Date("2025-01-01T00:00:00.000Z"),
      }).returning({ id: zalogaGibiTable.id });

      await recomputeZaloge([artikel.id]);
      let [stock] = await db.select().from(zalogeTable)
        .where(eq(zalogeTable.artikelId, artikel.id));
      expect(Number(stock.kolicina)).toBeCloseTo(16, 6);
      expect(Number(stock.povprecnaCena)).toBeCloseTo(3.875, 6);
      expect(Number(stock.skupnaVrednost)).toBeCloseTo(62, 4);
      const [consumptionAfterEdit] = await db.select().from(zalogaGibiTable)
        .where(and(
          eq(zalogaGibiTable.artikelId, artikel.id),
          eq(zalogaGibiTable.sourceSnapshot, "test_wac_consumption"),
        ));
      expect(Number(consumptionAfterEdit.cenaKos)).toBeCloseTo(2, 6);
      expect(Number(consumptionAfterEdit.vrednost)).toBeCloseTo(-8, 4);

      await appendStockMovementReversals(db, {
        referenceId,
        sourceSnapshots: ["prejemnica"],
        actorSnapshot: "wac-deleter",
        reversalSourceSnapshot: "prejemnica_reversal",
        note: "WAC test delete",
      });
      await recomputeZaloge([artikel.id]);
      [stock] = await db.select().from(zalogeTable)
        .where(eq(zalogeTable.artikelId, artikel.id));
      expect(Number(stock.kolicina)).toBeCloseTo(6, 6);
      expect(Number(stock.povprecnaCena)).toBeCloseTo(32 / 6, 6);
      expect(Number(stock.skupnaVrednost)).toBeCloseTo(32, 4);
      const [consumptionAfterDelete] = await db.select().from(zalogaGibiTable)
        .where(and(
          eq(zalogaGibiTable.artikelId, artikel.id),
          eq(zalogaGibiTable.sourceSnapshot, "test_wac_consumption"),
        ));
      expect(Number(consumptionAfterDelete.vrednost)).toBeCloseTo(-8, 4);

      const originalAfter = await db.select().from(zalogaGibiTable)
        .where(eq(zalogaGibiTable.id, original.id));
      expect(originalAfter[0].actorSnapshot).toBe("wac-original");
      expect(replacement.id).toBeGreaterThan(original.id);
    } finally {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL app.allow_stock_movement_cleanup = 'on'`);
        await tx.delete(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, artikel.id));
        await tx.delete(zalogeTable).where(eq(zalogeTable.artikelId, artikel.id));
        await tx.delete(artikliTable).where(eq(artikliTable.id, artikel.id));
      });
    }
  });
});