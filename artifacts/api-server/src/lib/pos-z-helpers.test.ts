import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  blagajneTable,
  companiesTable,
  db,
  enoteTable,
  izmeneTable,
  narocilaTable,
  natakariTable,
  zPorocilaTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { checkPreviousBusinessDayClosed, lockPosBusinessDay } from "./pos-z-helpers";

const DAVCNA = "TEST-PREVIOUS-Z-DAY-99";
const ENOTA = "__test-previous-z-day__";

async function fixture() {
  let [company] = await db.select({ id: companiesTable.id }).from(companiesTable)
    .where(eq(companiesTable.podjetjeDavcna, DAVCNA));
  if (!company) {
    [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: DAVCNA,
      naziv: "Test prejšnjega Z dne",
    }).returning({ id: companiesTable.id });
  }
  let [unit] = await db.select({ id: enoteTable.id }).from(enoteTable)
    .where(and(eq(enoteTable.companyId, company.id), eq(enoteTable.ime, ENOTA)));
  if (!unit) {
    [unit] = await db.insert(enoteTable).values({
      companyId: company.id,
      ime: ENOTA,
      zacetekDnevaUra: "04:00",
    }).returning({ id: enoteTable.id });
  }
  let [register] = await db.select({ id: blagajneTable.id }).from(blagajneTable)
    .where(and(eq(blagajneTable.enotaId, unit.id), eq(blagajneTable.ppId, "PREV-Z-PP")));
  if (!register) {
    [register] = await db.insert(blagajneTable).values({
      enotaId: unit.id,
      ppId: "PREV-Z-PP",
      bId: "PREV-Z-B",
      ime: "Testna blagajna prejšnjega dne",
      aktivna: true,
    }).returning({ id: blagajneTable.id });
  }
  let [waiter] = await db.select({ id: natakariTable.id }).from(natakariTable)
    .where(and(eq(natakariTable.companyId, company.id), eq(natakariTable.ime, "Prazen")));
  if (!waiter) {
    [waiter] = await db.insert(natakariTable).values({
      companyId: company.id,
      ime: "Prazen",
      priimek: "Natakar",
    }).returning({ id: natakariTable.id });
  }
  return { companyId: company.id, enotaId: unit.id, blagajnaId: register.id, natakarId: waiter.id };
}

async function cleanup(enotaId: number) {
  await db.delete(zPorocilaTable).where(eq(zPorocilaTable.enotaId, enotaId));
  await db.delete(narocilaTable).where(eq(narocilaTable.enotaId, enotaId));
  await db.delete(izmeneTable).where(eq(izmeneTable.enotaId, enotaId));
}

describe("prejšnji poslovni dan", () => {
  let ctx: Awaited<ReturnType<typeof fixture>>;

  beforeEach(async () => {
    ctx = await fixture();
    await cleanup(ctx.enotaId);
  });

  afterEach(async () => {
    if (ctx) await cleanup(ctx.enotaId);
  });

  it("prvi delovni dan dovoli začetek brez zgodovinskega Z-poročila", async () => {
    const result = await checkPreviousBusinessDayClosed(db, ctx.enotaId, "2025-06-01");
    expect(result).toEqual({
      allowed: true,
      previousBusinessDate: null,
      missingRegisters: [],
    });
  });

  it("prazna izmena na zaprti dan ne zahteva praznega Z-poročila", async () => {
    await db.insert(izmeneTable).values({
      enotaId: ctx.enotaId,
      natakariId: ctx.natakarId,
      blagajnaId: ctx.blagajnaId,
      zacetek: new Date("2025-06-08T12:00:00+02:00"),
      konec: new Date("2025-06-08T12:05:00+02:00"),
    });

    const result = await checkPreviousBusinessDayClosed(db, ctx.enotaId, "2025-06-09");

    expect(result).toEqual({
      allowed: true,
      previousBusinessDate: null,
      missingRegisters: [],
    });
  });

  it("prazno preklicano naročilo ne zahteva praznega Z-poročila", async () => {
    await db.insert(narocilaTable).values({
      enotaId: ctx.enotaId,
      status: "preklicano",
      skupaj: "0",
      ustvarjeno: new Date("2025-06-08T12:00:00+02:00"),
    });

    const result = await checkPreviousBusinessDayClosed(db, ctx.enotaId, "2025-06-09");

    expect(result).toEqual({
      allowed: true,
      previousBusinessDate: null,
      missingRegisters: [],
    });
  });

  it("zahteva Z zadnjega dne z dejavnostjo in preskoči zaprte koledarske dni", async () => {
    await db.insert(narocilaTable).values({
      enotaId: ctx.enotaId,
      status: "zakljuceno",
      skupaj: "0",
      ustvarjeno: new Date("2025-06-06T12:00:00+02:00"),
    });

    const blocked = await checkPreviousBusinessDayClosed(db, ctx.enotaId, "2025-06-09");
    expect(blocked.allowed).toBe(false);
    expect(blocked.previousBusinessDate).toBe("2025-06-06");
    expect(blocked.missingRegisters).toEqual([
      { id: ctx.blagajnaId, name: "Testna blagajna prejšnjega dne" },
    ]);

    await db.insert(zPorocilaTable).values({
      companyId: ctx.companyId,
      enotaId: ctx.enotaId,
      blagajnaId: ctx.blagajnaId,
      poslovniDatum: "2025-06-06",
      zStevilka: 1,
      zakljucilUporabnik: "test-user",
      grandTotalPrej: "0",
      grandTotalNov: "0",
      prometDneva: "0",
      ddvPoStopnjah: [],
    });

    const allowed = await checkPreviousBusinessDayClosed(db, ctx.enotaId, "2025-06-09");
    expect(allowed.allowed).toBe(true);
    expect(allowed.previousBusinessDate).toBe("2025-06-06");
  });

  it("pri dejavnosti brez blagajne zahteva Z vseh aktivnih blagajn", async () => {
    const [secondRegister] = await db.insert(blagajneTable).values({
      enotaId: ctx.enotaId,
      ppId: "PREV-Z-PP-2",
      bId: "PREV-Z-B-2",
      ime: "Druga testna blagajna",
      aktivna: true,
    }).returning({ id: blagajneTable.id });
    try {
      await db.insert(narocilaTable).values({
        enotaId: ctx.enotaId,
        status: "zakljuceno",
        skupaj: "0",
        ustvarjeno: new Date("2025-06-06T12:00:00+02:00"),
      });

      const result = await checkPreviousBusinessDayClosed(db, ctx.enotaId, "2025-06-09");

      expect(result.allowed).toBe(false);
      expect(result.missingRegisters.map((register) => register.id).sort((a, b) => a - b)).toEqual(
        [ctx.blagajnaId, secondRegister.id].sort((a, b) => a - b),
      );
    } finally {
      await db.delete(blagajneTable).where(eq(blagajneTable.id, secondRegister.id));
    }
  });

  it("zgodovinski zaključek ne zahteva evidence jedi, ki je bila dodana pozneje", async () => {
    const { artikliTable } = await import("@workspace/db");
    const [article] = await db.insert(artikliTable).values({
      enotaId: ctx.enotaId,
      ime: "Pozneje dodana pripravljena jed",
      cena: "1.00",
      mealType: "prepared",
    }).returning({ id: artikliTable.id });
    try {
      const { getZCloseBlockers } = await import("./pos-z-helpers");
      const blockers = await getZCloseBlockers(db, ctx.enotaId, "2024-01-01");
      expect(blockers.some((blocker) => blocker.type === "OPEN_PREPARED_FOOD")).toBe(false);
    } finally {
      await db.delete(artikliTable).where(eq(artikliTable.id, article.id));
    }
  });

  it("odklenjeno Z-poročilo ne šteje kot zaključen dan", async () => {
    await db.insert(zPorocilaTable).values({
      companyId: ctx.companyId,
      enotaId: ctx.enotaId,
      blagajnaId: ctx.blagajnaId,
      poslovniDatum: "2025-07-01",
      zStevilka: 1,
      zakljucilUporabnik: "test-user",
      grandTotalPrej: "0",
      grandTotalNov: "0",
      prometDneva: "0",
      ddvPoStopnjah: [],
      odklenjenOb: new Date("2025-07-02T08:00:00+02:00"),
    });

    const result = await checkPreviousBusinessDayClosed(db, ctx.enotaId, "2025-07-02");
    expect(result.allowed).toBe(false);
    expect(result.previousBusinessDate).toBe("2025-07-01");
    expect(result.missingRegisters).toHaveLength(1);
  });

  it("zaklep poslovnega dne serializira sočasni Z-zaključek in novo operativno stanje", async () => {
    let releaseFirst!: () => void;
    let firstLocked!: () => void;
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const locked = new Promise<void>((resolve) => { firstLocked = resolve; });
    let secondAcquired = false;

    const first = db.transaction(async (tx) => {
      await lockPosBusinessDay(tx, ctx.enotaId);
      firstLocked();
      await release;
    });
    await locked;

    const second = db.transaction(async (tx) => {
      await lockPosBusinessDay(tx, ctx.enotaId);
      secondAcquired = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(secondAcquired).toBe(false);

    releaseFirst();
    await Promise.all([first, second]);
    expect(secondAcquired).toBe(true);
  });
});