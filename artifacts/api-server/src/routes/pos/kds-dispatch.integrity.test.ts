import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  companiesTable,
  artikliTable,
  db,
  enoteTable,
  kdsIzdajaDogodkiTable,
  mizeTable,
  narocilaTable,
  pool,
  postavkeTable,
} from "@workspace/db";
import narocilaRouter from "./narocila";

const runId = Math.random().toString(36).slice(2, 10).toUpperCase();
let companyId: string;
let enotaId: number;
let mizaId: number;
let artikelId: number;
const narociloIds: number[] = [];

function app() {
  const result = express();
  result.use(express.json());
  result.use((req, _res, next) => {
    (req as any).enotaId = enotaId;
    next();
  });
  result.use(narocilaRouter);
  return result;
}

async function ustvariNarocilo(stevilkaNarocila: number) {
  const [narocilo] = await db.insert(narocilaTable).values({
    enotaId,
    mizaId,
    stevilkaNarocila,
  }).returning({ id: narocilaTable.id });
  narociloIds.push(narocilo!.id);
  return narocilo!.id;
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_KDS_DISPATCH_${runId}`,
    naziv: `KDS dispatch test ${runId}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;

  const [enota] = await db.insert(enoteTable).values({
    companyId,
    ime: `KDS enota ${runId}`,
  }).returning({ id: enoteTable.id });
  enotaId = enota!.id;

  const [miza] = await db.insert(mizeTable).values({
    enotaId,
    stevilka: 994,
  }).returning({ id: mizeTable.id });
  mizaId = miza!.id;

  const [artikel] = await db.insert(artikliTable).values({
    enotaId,
    ime: `KDS artikel ${runId}`,
    cena: "10.00",
    davek: "22.00",
    vrstniRed: 1,
  }).returning({ id: artikliTable.id });
  artikelId = artikel!.id;
});

afterAll(async () => {
  await pool.query("ALTER TABLE kds_izdaja_dogodki DISABLE TRIGGER kds_izdaja_dogodki_append_only");
  try {
    await db.delete(kdsIzdajaDogodkiTable).where(eq(kdsIzdajaDogodkiTable.enotaId, enotaId));
  } finally {
    await pool.query("ALTER TABLE kds_izdaja_dogodki ENABLE TRIGGER kds_izdaja_dogodki_append_only");
  }
  if (narociloIds.length) {
    await db.delete(narocilaTable).where(inArray(narocilaTable.id, narociloIds));
  }
  await db.delete(mizeTable).where(eq(mizeTable.id, mizaId));
  await db.delete(artikliTable).where(eq(artikliTable.id, artikelId));
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("KDS predaja zamrzne sestavo naročila", () => {
  it("zavrne brisanje predanega naročila in ohrani revizijski dogodek", async () => {
    const narociloId = await ustvariNarocilo(1);
    await db.insert(kdsIzdajaDogodkiTable).values({
      enotaId,
      narociloId,
      idempotencyKey: `delete:${runId}`,
      actorClerkUserId: "test-user",
    });

    const response = await supertest(app()).delete(`/narocila/${narociloId}`);
    expect(response.status).toBe(409);
    expect(response.body.code).toBe("KDS_NAROCILO_JE_PREDANO");

    const events = await db.select().from(kdsIzdajaDogodkiTable)
      .where(eq(kdsIzdajaDogodkiTable.narociloId, narociloId));
    expect(events).toHaveLength(1);
    await expect(
      db.update(kdsIzdajaDogodkiTable)
        .set({ actorClerkUserId: "spremenjen" })
        .where(eq(kdsIzdajaDogodkiTable.narociloId, narociloId)),
    ).rejects.toThrow();
    await expect(
      db.delete(kdsIzdajaDogodkiTable)
        .where(eq(kdsIzdajaDogodkiTable.narociloId, narociloId)),
    ).rejects.toThrow();
    await expect(db.delete(narocilaTable).where(eq(narocilaTable.id, narociloId))).rejects.toThrow();
  });

  it("zavrne združitev, če je predan cilj ali izvor", async () => {
    const predanCilj = await ustvariNarocilo(2);
    const navadenVir = await ustvariNarocilo(3);
    const navadenCilj = await ustvariNarocilo(4);
    const predanVir = await ustvariNarocilo(5);
    await db.insert(kdsIzdajaDogodkiTable).values([
      { enotaId, narociloId: predanCilj, idempotencyKey: `merge-target:${runId}`, actorClerkUserId: "test-user" },
      { enotaId, narociloId: predanVir, idempotencyKey: `merge-source:${runId}`, actorClerkUserId: "test-user" },
    ]);

    const targetResponse = await supertest(app())
      .post(`/narocila/${predanCilj}/spoji`)
      .send({ virNarociloId: navadenVir });
    expect(targetResponse.status).toBe(409);
    expect(targetResponse.body.code).toBe("KDS_NAROCILO_JE_PREDANO");

    const sourceResponse = await supertest(app())
      .post(`/narocila/${navadenCilj}/spoji`)
      .send({ virNarociloId: predanVir });
    expect(sourceResponse.status).toBe(409);
    expect(sourceResponse.body.code).toBe("KDS_NAROCILO_JE_PREDANO");
  });

  it("ogled predanega telefonskega naročila ne spreminja starih To Go vrstic", async () => {
    const [narocilo] = await db.insert(narocilaTable).values({
      enotaId,
      stevilkaNarocila: 6,
      nacin: "telefon",
      nacinIzpolnitve: "prevzem",
    }).returning({ id: narocilaTable.id });
    narociloIds.push(narocilo!.id);
    const [postavka] = await db.insert(postavkeTable).values({
      narociloId: narocilo!.id,
      artikelId,
      ime: `KDS artikel ${runId}`,
      kolicina: 1,
      cenaKos: "10.00",
      skupaj: "10.00",
      davek: "22.00",
      toGo: false,
    }).returning({ id: postavkeTable.id });
    await db.insert(kdsIzdajaDogodkiTable).values({
      enotaId,
      narociloId: narocilo!.id,
      idempotencyKey: `get:${runId}`,
      actorClerkUserId: "test-user",
    });

    const before = await db.select({
      toGo: postavkeTable.toGo,
      davek: postavkeTable.davek,
      appliedRuleId: postavkeTable.appliedRuleId,
    }).from(postavkeTable).where(eq(postavkeTable.id, postavka!.id));
    const response = await supertest(app()).get(`/narocila/${narocilo!.id}`);
    const after = await db.select({
      toGo: postavkeTable.toGo,
      davek: postavkeTable.davek,
      appliedRuleId: postavkeTable.appliedRuleId,
    }).from(postavkeTable).where(eq(postavkeTable.id, postavka!.id));

    expect(response.status).toBe(200);
    expect(after).toEqual(before);
  });

  it("vključi dispatch migracijo v post-merge postopek", async () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationRunner = await readFile(
      path.resolve(currentDir, "../../../scripts/apply-post-merge-migrations.ts"),
      "utf8",
    );
    expect(migrationRunner).toContain('"144-pos-kds-dispatch.sql"');
  });

  it("vključi audit Viva vračil v post-merge postopek", async () => {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const migrationRunner = await readFile(
      path.resolve(currentDir, "../../../scripts/apply-post-merge-migrations.ts"),
      "utf8",
    );
    expect(migrationRunner).toContain('"173-viva-refund-actor-status-audit.sql"');
    expect(migrationRunner).toContain('"174-viva-refund-manual-resolution.sql"');
  });
});