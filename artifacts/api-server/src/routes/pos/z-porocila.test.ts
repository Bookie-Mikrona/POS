/**
 * Integracijski testi za Z-poročilo.
 * Testirajo: zaklenjen dan, GT kumulativni, zaklep preprečuje račun,
 * odklep z revizijsko sledjo, snapshot nespremenljivost.
 *
 * Fixture je samozadostna — ustvari sentinel podjetje/enoto/blagajno,
 * če v dev DB ne obstajajo. Ni odvisna od obstoječih podatkov v bazi.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import supertest from "supertest";
import { createHmac } from "node:crypto";
import {
  db,
  artikliTable,
  blagajneTable,
  companiesTable,
  enoteTable,
  izmeneTable,
  mizeTable,
  narocilaTable,
  natakariTable,
  preparedFoodDailyLedgersTable,
  racuniTable,
  zPorocilaTable,
  zPorociloOdklePiTable,
  posCashReconciliationsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import zPorocilaRouter from "./z-porocila";
import { getCurrentPoslovniDatum } from "../../lib/pos-z-helpers";
import { posActorContext } from "../../middlewares/pos";
import { getPosActorSessionSecret } from "../../lib/posActorSessionSecret";

// ── Sentinel vrednosti za test fixture ───────────────────────────────────────
// Distinctive vrednosti, ki ne trčijo z realnimi podatki.
const SENTINEL_DAVCNA   = "TEST-Z-POROCILO-99";
const SENTINEL_ENOTA    = "__test-z-porocila__";
const SENTINEL_PP_ID    = "TEST-Z-PP-1";
const SENTINEL_B_ID     = "TEST-Z-B-1";

// ── Pomocne funkcije ──────────────────────────────────────────────────────────

/**
 * Zagotovi testno hierarhijo (company → enota → blagajna), idempotentno.
 * Ustvari manjkajoče člene; obstoječe pusti pri miru.
 */
async function getOrCreateTestBlagajna(): Promise<{
  blagajnaId: number;
  enotaId: number;
  companyId: string;
  natakarId: number;
}> {
  // 1. Company
  let [company] = await db
    .select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.podjetjeDavcna, SENTINEL_DAVCNA))
    .limit(1);

  if (!company) {
    [company] = await db
      .insert(companiesTable)
      .values({ podjetjeDavcna: SENTINEL_DAVCNA, naziv: "Test (z-porocila testi)" })
      .returning({ id: companiesTable.id });
  }

  // 2. Enota
  let [enota] = await db
    .select({ id: enoteTable.id })
    .from(enoteTable)
    .where(and(eq(enoteTable.companyId, company.id), eq(enoteTable.ime, SENTINEL_ENOTA)))
    .limit(1);

  if (!enota) {
    [enota] = await db
      .insert(enoteTable)
      .values({ companyId: company.id, ime: SENTINEL_ENOTA })
      .returning({ id: enoteTable.id });
  }

  // 3. Blagajna
  let [blagajna] = await db
    .select({ id: blagajneTable.id })
    .from(blagajneTable)
    .where(and(
      eq(blagajneTable.enotaId, enota.id),
      eq(blagajneTable.ppId, SENTINEL_PP_ID),
    ))
    .limit(1);

  if (!blagajna) {
    [blagajna] = await db
      .insert(blagajneTable)
      .values({
        enotaId: enota.id,
        ppId:    SENTINEL_PP_ID,
        bId:     SENTINEL_B_ID,
        ime:     "Test blagajna (z-porocila)",
        aktivna: true,
      })
      .returning({ id: blagajneTable.id });
  }

  let [natakar] = await db.select({ id: natakariTable.id }).from(natakariTable)
    .where(and(eq(natakariTable.companyId, company.id), eq(natakariTable.ime, "__test-z-audit__")))
    .limit(1);
  if (!natakar) {
    [natakar] = await db.insert(natakariTable).values({
      companyId: company.id,
      ime: "__test-z-audit__",
      priimek: "Natakar",
    }).returning({ id: natakariTable.id });
  }

  return {
    blagajnaId: blagajna.id,
    enotaId: enota.id,
    companyId: company.id,
    natakarId: natakar.id,
  };
}

async function cleanupZPorocila(enotaId: number, blagajnaId: number) {
  await db.execute(sql`
    DELETE FROM pos_actor_audit
    WHERE enota_id = ${enotaId}
      AND action = ${"z_report_unlocked"}
  `);
  await db.delete(posCashReconciliationsTable)
    .where(and(eq(posCashReconciliationsTable.enotaId, enotaId), eq(posCashReconciliationsTable.blagajnaId, blagajnaId)));
  // Počistimo test odklepe in Z zapise za to blagajno
  const zRecords = await db
    .select({ id: zPorocilaTable.id })
    .from(zPorocilaTable)
    .where(and(eq(zPorocilaTable.enotaId, enotaId), eq(zPorocilaTable.blagajnaId, blagajnaId)));
  for (const z of zRecords) {
    await db.delete(zPorociloOdklePiTable).where(eq(zPorociloOdklePiTable.zPorociloId, z.id));
  }
  await db.delete(zPorocilaTable)
    .where(and(eq(zPorocilaTable.enotaId, enotaId), eq(zPorocilaTable.blagajnaId, blagajnaId)));
  // Ponastavi GT na blagajni
  await db.update(blagajneTable).set({ grandTotal: "0" }).where(eq(blagajneTable.id, blagajnaId));
  // Sentinel enota mora biti med testi brez starih odprtih operativnih zapisov.
  await db.delete(izmeneTable).where(eq(izmeneTable.enotaId, enotaId));
  await db.delete(narocilaTable)
    .where(and(eq(narocilaTable.enotaId, enotaId), eq(narocilaTable.status, "odprto")));
}

function createTestApp(
  ctx: { enotaId: number; companyId: string },
  identity: { clerkUserId?: string } = {},
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      enotaId: ctx.enotaId,
      companyId: ctx.companyId,
      clerkUserId: identity.clerkUserId ?? "z-close-test",
      vloga: "admin",
    });
    next();
  });
  app.use(posActorContext);
  app.use(zPorocilaRouter);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: error.message });
  });
  return app;
}

async function createActorSessionToken(
  ctx: { enotaId: number; companyId: string },
  natakarId: number,
): Promise<string> {
  const [shift] = await db.insert(izmeneTable).values({
    enotaId: ctx.enotaId, natakariId: natakarId,
  }).returning({ id: izmeneTable.id });
  const secret = getPosActorSessionSecret();
  if (!secret) throw new Error("POS actor session secret ni konfiguriran za test.");
  const encoded = Buffer.from(JSON.stringify({
    n: natakarId,
    s: shift.id,
    u: ctx.enotaId,
    c: ctx.companyId,
    e: Date.now() + 60_000,
  })).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

// ── Testi ────────────────────────────────────────────────────────────────────

describe("Z-poročilo — DB integracijski testi", () => {
  let ctx: Awaited<ReturnType<typeof getOrCreateTestBlagajna>>;

  beforeEach(async () => {
    ctx = await getOrCreateTestBlagajna();
    await cleanupZPorocila(ctx.enotaId, ctx.blagajnaId);
  });

  afterEach(async () => {
    if (ctx) await cleanupZPorocila(ctx.enotaId, ctx.blagajnaId);
  });

  it("vstavi prvi Z zapis z zStevilka=1 in GT 0→promet", async () => {
    const datum = "2025-01-10";
    const [z] = await db.insert(zPorocilaTable).values({
      companyId: ctx.companyId,
      enotaId: ctx.enotaId,
      blagajnaId: ctx.blagajnaId,
      poslovniDatum: datum,
      zStevilka: 1,
      zakljucilUporabnik: "test-user",
      grandTotalPrej: "0.00",
      grandTotalNov: "150.00",
      prometDneva: "150.00",
      znesekNapitnina: "3.00",
      ddvPoStopnjah: [],
    }).returning();
    expect(z.zStevilka).toBe(1);
    expect(Number(z.grandTotalNov)).toBe(150);
    expect(Number(z.prometDneva)).toBe(150);
    expect(Number(z.znesekNapitnina)).toBe(3);
    expect(z.odklenjenOb).toBeNull();
  });

  it("unikatnost (enota+blagajna+datum) prepreči duplikat", async () => {
    const datum = "2025-01-11";
    const base = {
      companyId: ctx.companyId, enotaId: ctx.enotaId, blagajnaId: ctx.blagajnaId,
      poslovniDatum: datum, zStevilka: 1, zakljucilUporabnik: "user1",
      grandTotalPrej: "0", grandTotalNov: "100", prometDneva: "100", ddvPoStopnjah: [],
    };
    await db.insert(zPorocilaTable).values(base);
    await expect(db.insert(zPorocilaTable).values({ ...base, zStevilka: 2 })).rejects.toThrow();
  });

  it("GT per blagajna se sešteva čez dneve", async () => {
    const dnevi = [
      { datum: "2025-02-01", promet: "100.00", gtPrej: "0.00", gtNov: "100.00", z: 1 },
      { datum: "2025-02-02", promet: "200.00", gtPrej: "100.00", gtNov: "300.00", z: 2 },
      { datum: "2025-02-03", promet: "50.00",  gtPrej: "300.00", gtNov: "350.00", z: 3 },
    ];
    for (const d of dnevi) {
      await db.insert(zPorocilaTable).values({
        companyId: ctx.companyId, enotaId: ctx.enotaId, blagajnaId: ctx.blagajnaId,
        poslovniDatum: d.datum, zStevilka: d.z, zakljucilUporabnik: "user1",
        grandTotalPrej: d.gtPrej, grandTotalNov: d.gtNov, prometDneva: d.promet,
        ddvPoStopnjah: [],
      });
    }
    const zRecords = await db
      .select({ z: zPorocilaTable.zStevilka, gt: zPorocilaTable.grandTotalNov })
      .from(zPorocilaTable)
      .where(and(eq(zPorocilaTable.enotaId, ctx.enotaId), eq(zPorocilaTable.blagajnaId, ctx.blagajnaId)));
    expect(zRecords).toHaveLength(3);
    const z3 = zRecords.find(r => r.z === 3);
    expect(Number(z3?.gt)).toBe(350);
  });

  it("odklep zahteva razlog (NOT NULL, CHECK length>0)", async () => {
    const [z] = await db.insert(zPorocilaTable).values({
      companyId: ctx.companyId, enotaId: ctx.enotaId, blagajnaId: ctx.blagajnaId,
      poslovniDatum: "2025-03-01", zStevilka: 1, zakljucilUporabnik: "user1",
      grandTotalPrej: "0", grandTotalNov: "200", prometDneva: "200", ddvPoStopnjah: [],
    }).returning();

    // Prazen razlog mora biti zavrnjen
    await expect(
      db.insert(zPorociloOdklePiTable).values({
        zPorociloId: z.id, odklenilUporabnik: "admin", razlog: "   ", gtPrej: "200",
      })
    ).rejects.toThrow();
  });

  it("API zavrne manjkajoč, prazen in presledkovni razlog ter veljaven odklep izvede samo enkrat", async () => {
    await db.update(blagajneTable)
      .set({ grandTotal: "500.00" })
      .where(eq(blagajneTable.id, ctx.blagajnaId));
    const [z] = await db.insert(zPorocilaTable).values({
      companyId: ctx.companyId,
      enotaId: ctx.enotaId,
      blagajnaId: ctx.blagajnaId,
      poslovniDatum: "2025-03-04",
      zStevilka: 1,
      zakljucilUporabnik: "user1",
      grandTotalPrej: "400.00",
      grandTotalNov: "500.00",
      prometDneva: "100.00",
      ddvPoStopnjah: [],
    }).returning({ id: zPorocilaTable.id });
    const app = createTestApp(ctx, {
      clerkUserId: "clerk-admin-audit",
    });
    const actorSessionToken = await createActorSessionToken(ctx, ctx.natakarId);

    for (const body of [{}, { razlog: "" }, { razlog: " \t\n " }]) {
      const response = await supertest(app)
        .post(`/z-porocilo/${z.id}/odkleni`)
        .send(body);
      expect(response.status, JSON.stringify(response.body)).toBe(400);
      expect(response.body).toEqual({ error: "Razlog odklepa je obvezen." });

      const [unchangedZ] = await db.select({
        odklenjenOb: zPorocilaTable.odklenjenOb,
        odklenilUporabnik: zPorocilaTable.odklenilUporabnik,
      }).from(zPorocilaTable).where(eq(zPorocilaTable.id, z.id));
      const [unchangedRegister] = await db.select({
        grandTotal: blagajneTable.grandTotal,
      }).from(blagajneTable).where(eq(blagajneTable.id, ctx.blagajnaId));
      const unlocks = await db.select({ id: zPorociloOdklePiTable.id })
        .from(zPorociloOdklePiTable)
        .where(eq(zPorociloOdklePiTable.zPorociloId, z.id));
      const actorAudits = await db.execute(sql`
        SELECT id
        FROM pos_actor_audit
        WHERE enota_id = ${ctx.enotaId}
          AND action = ${"z_report_unlocked"}
          AND metadata->>'zPorociloId' = ${String(z.id)}
      `);

      expect(unchangedZ).toEqual({ odklenjenOb: null, odklenilUporabnik: null });
      expect(unchangedRegister?.grandTotal).toBe("500.00");
      expect(unlocks).toHaveLength(0);
      expect(actorAudits.rows).toHaveLength(0);
    }

    const validResponses = await Promise.all([
      supertest(app)
        .post(`/z-porocilo/${z.id}/odkleni`)
        .set("X-Pos-Actor-Session", actorSessionToken)
        .send({ razlog: "  Popravek zaradi napačnega zaključka  " }),
      supertest(app)
        .post(`/z-porocilo/${z.id}/odkleni`)
        .set("X-Pos-Actor-Session", actorSessionToken)
        .send({ razlog: "  Popravek zaradi napačnega zaključka  " }),
    ]);
    expect(validResponses.map(response => response.status).sort()).toEqual([200, 409]);

    const unlocksAfterSuccess = await db.select({
      zPorociloId: zPorociloOdklePiTable.zPorociloId,
      razlog: zPorociloOdklePiTable.razlog,
      odklenilUporabnik: zPorociloOdklePiTable.odklenilUporabnik,
      enotaId: zPorocilaTable.enotaId,
    }).from(zPorociloOdklePiTable)
      .innerJoin(zPorocilaTable, eq(zPorocilaTable.id, zPorociloOdklePiTable.zPorociloId))
      .where(eq(zPorociloOdklePiTable.zPorociloId, z.id));
    const [registerAfterSuccess] = await db.select({
      grandTotal: blagajneTable.grandTotal,
    }).from(blagajneTable).where(eq(blagajneTable.id, ctx.blagajnaId));

    expect(unlocksAfterSuccess).toEqual([{
      zPorociloId: z.id,
      razlog: "Popravek zaradi napačnega zaključka",
      odklenilUporabnik: "clerk-admin-audit",
      enotaId: ctx.enotaId,
    }]);
    expect(registerAfterSuccess?.grandTotal).toBe("400.00");
    const actorAuditsAfterSuccess = await db.execute(sql`
      SELECT enota_id, natakar_id, actor_user_id, actor_clerk_user_id, action, metadata
      FROM pos_actor_audit
      WHERE enota_id = ${ctx.enotaId}
        AND action = ${"z_report_unlocked"}
        AND metadata->>'zPorociloId' = ${String(z.id)}
    `);
    expect(actorAuditsAfterSuccess.rows).toEqual([{
      enota_id: ctx.enotaId,
      natakar_id: ctx.natakarId,
      actor_user_id: null,
      actor_clerk_user_id: "clerk-admin-audit",
      action: "z_report_unlocked",
      metadata: { zPorociloId: z.id },
    }]);

    const unlocksAfterDuplicate = await db.select({
      razlog: zPorociloOdklePiTable.razlog,
    }).from(zPorociloOdklePiTable)
      .where(eq(zPorociloOdklePiTable.zPorociloId, z.id));
    const [registerAfterDuplicate] = await db.select({
      grandTotal: blagajneTable.grandTotal,
    }).from(blagajneTable).where(eq(blagajneTable.id, ctx.blagajnaId));
    expect(unlocksAfterDuplicate).toEqual([{ razlog: "Popravek zaradi napačnega zaključka" }]);
    expect(registerAfterDuplicate?.grandTotal).toBe("400.00");
  });

  it("ob odpovedi generičnega actor audita v celoti razveljavi odklep", async () => {
    const failingClerkUserId = "clerk-z-audit-forced-failure";
    const constraintName = "pos_actor_audit_test_reject_z_unlock";
    await db.update(blagajneTable)
      .set({ grandTotal: "500.00" })
      .where(eq(blagajneTable.id, ctx.blagajnaId));
    const [z] = await db.insert(zPorocilaTable).values({
      companyId: ctx.companyId,
      enotaId: ctx.enotaId,
      blagajnaId: ctx.blagajnaId,
      poslovniDatum: "2025-03-05",
      zStevilka: 1,
      zakljucilUporabnik: "user1",
      grandTotalPrej: "400.00",
      grandTotalNov: "500.00",
      prometDneva: "100.00",
      ddvPoStopnjah: [],
    }).returning({ id: zPorocilaTable.id });
    const app = createTestApp(ctx, { clerkUserId: failingClerkUserId });
    const actorSessionToken = await createActorSessionToken(ctx, ctx.natakarId);

    await db.execute(sql.raw(`
      ALTER TABLE pos_actor_audit
      DROP CONSTRAINT IF EXISTS ${constraintName}
    `));
    await db.execute(sql.raw(`
      ALTER TABLE pos_actor_audit
      ADD CONSTRAINT ${constraintName}
      CHECK (actor_clerk_user_id IS DISTINCT FROM '${failingClerkUserId}')
      NOT VALID
    `));

    try {
      const response = await supertest(app)
        .post(`/z-porocilo/${z.id}/odkleni`)
        .set("X-Pos-Actor-Session", actorSessionToken)
        .send({ razlog: "Ta odklep se mora povrniti" });

      expect(response.status).toBe(500);
      expect(response.status).not.toBe(200);

      const [unchangedZ] = await db.select({
        odklenjenOb: zPorocilaTable.odklenjenOb,
        odklenilUporabnik: zPorocilaTable.odklenilUporabnik,
      }).from(zPorocilaTable).where(eq(zPorocilaTable.id, z.id));
      const unlocks = await db.select({ id: zPorociloOdklePiTable.id })
        .from(zPorociloOdklePiTable)
        .where(eq(zPorociloOdklePiTable.zPorociloId, z.id));
      const [register] = await db.select({
        grandTotal: blagajneTable.grandTotal,
      }).from(blagajneTable).where(eq(blagajneTable.id, ctx.blagajnaId));
      const actorAudits = await db.execute(sql`
        SELECT id
        FROM pos_actor_audit
        WHERE enota_id = ${ctx.enotaId}
          AND action = ${"z_report_unlocked"}
          AND metadata->>'zPorociloId' = ${String(z.id)}
      `);

      expect(unchangedZ).toEqual({ odklenjenOb: null, odklenilUporabnik: null });
      expect(unlocks).toHaveLength(0);
      expect(register?.grandTotal).toBe("500.00");
      expect(actorAudits.rows).toHaveLength(0);
    } finally {
      await db.execute(sql.raw(`
        ALTER TABLE pos_actor_audit
        DROP CONSTRAINT IF EXISTS ${constraintName}
      `));
    }
  });

  it("odklep zapiše revizijsko sled z gtPrej", async () => {
    const [z] = await db.insert(zPorocilaTable).values({
      companyId: ctx.companyId, enotaId: ctx.enotaId, blagajnaId: ctx.blagajnaId,
      poslovniDatum: "2025-03-02", zStevilka: 1, zakljucilUporabnik: "user1",
      grandTotalPrej: "0", grandTotalNov: "300", prometDneva: "300", ddvPoStopnjah: [],
    }).returning();

    await db.insert(zPorociloOdklePiTable).values({
      zPorociloId: z.id, odklenilUporabnik: "admin", razlog: "Napaka pri vnosi", gtPrej: "300",
    });

    const [odklep] = await db.select().from(zPorociloOdklePiTable)
      .where(eq(zPorociloOdklePiTable.zPorociloId, z.id));
    expect(Number(odklep.gtPrej)).toBe(300);
    expect(odklep.gtPoPonovnem).toBeNull();
    expect(odklep.razlog).toBe("Napaka pri vnosi");
  });

  it("ponovni zaključek: gtPoPonovnem se zapiše v odklep", async () => {
    const [z] = await db.insert(zPorocilaTable).values({
      companyId: ctx.companyId, enotaId: ctx.enotaId, blagajnaId: ctx.blagajnaId,
      poslovniDatum: "2025-03-03", zStevilka: 1, zakljucilUporabnik: "user1",
      grandTotalPrej: "0", grandTotalNov: "400", prometDneva: "400", ddvPoStopnjah: [],
    }).returning();

    const [odkl] = await db.insert(zPorociloOdklePiTable).values({
      zPorociloId: z.id, odklenilUporabnik: "admin", razlog: "Test odklepa", gtPrej: "400",
    }).returning();

    // Označi odklenjen
    await db.update(zPorocilaTable).set({ odklenjenOb: new Date() }).where(eq(zPorocilaTable.id, z.id));
    // Ponovni zaključek — posodobi gtPoPonovnem
    await db.update(zPorociloOdklePiTable).set({ gtPoPonovnem: "380.00" }).where(eq(zPorociloOdklePiTable.id, odkl.id));

    const [updated] = await db.select().from(zPorociloOdklePiTable).where(eq(zPorociloOdklePiTable.id, odkl.id));
    expect(Number(updated.gtPoPonovnem)).toBe(380);
  });

  it("blagajne.grand_total je numeric stolpec (schema preverjanje)", async () => {
    const [blagajna] = await db
      .select({ grandTotal: blagajneTable.grandTotal })
      .from(blagajneTable)
      .where(eq(blagajneTable.id, ctx.blagajnaId))
      .limit(1);
    // grandTotal mora biti string (drizzle numeric), pretvoriva v number mora uspeti
    expect(Number(blagajna?.grandTotal ?? "0")).toBeGreaterThanOrEqual(0);
  });

  it("POST zaključi Z iz računa in ločeno shrani kartično napitnino", async () => {
    const datum = "2025-04-10";
    const [order] = await db.insert(narocilaTable).values({
      enotaId: ctx.enotaId, status: "zakljuceno", skupaj: "12.00",
    }).returning({ id: narocilaTable.id });
    const [receipt] = await db.insert(racuniTable).values({
      enotaId: ctx.enotaId, narociloId: order.id,
      stevilkaRacuna: `${SENTINEL_PP_ID}-${SENTINEL_B_ID}-000001`,
      skupaj: "12.00", ddv: "2.16", placilnaNacin: "kartica", status: "poslan",
      ustvarjeno: new Date(`${datum}T10:00:00+02:00`),
      znesekKartica: "15.00", znesekNapitnina: "3.00",
    }).returning({ id: racuniTable.id });
    try {
      await db.insert(posCashReconciliationsTable).values({
        companyId: ctx.companyId, enotaId: ctx.enotaId, blagajnaId: ctx.blagajnaId, poslovniDatum: datum,
        pricakovanaGotovina: "50.00", prestetaGotovina: "50.00", razlika: "0.00", confirmed: true,
        actorId: "test-user", idempotencyKey: `cash-${datum}`,
      });
      const response = await supertest(createTestApp(ctx)).post("/z-porocilo/zakljuci")
        .send({ blagajnaId: ctx.blagajnaId, poslovniDatum: datum });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(Number(response.body.prometDneva)).toBe(12);
      expect(Number(response.body.skupajPromet)).toBe(12);
      expect(Number(response.body.kartica)).toBe(15);
      expect(Number(response.body.znesekNapitnina)).toBe(3);
      const [snapshot] = await db.select().from(zPorocilaTable)
        .where(and(eq(zPorocilaTable.enotaId, ctx.enotaId), eq(zPorocilaTable.poslovniDatum, datum)));
      expect(Number(snapshot.znesekNapitnina)).toBe(3);
    } finally {
      await db.delete(racuniTable).where(eq(racuniTable.id, receipt.id));
      await db.delete(narocilaTable).where(eq(narocilaTable.id, order.id));
    }
  });

  it("POST vrne vse operativne blokade in po njihovi odpravi zaključi dan", async () => {
    const datum = await getCurrentPoslovniDatum(ctx.enotaId);
    const eventTime = new Date();
    const [natakar] = await db.insert(natakariTable).values({
      companyId: ctx.companyId,
      ime: "Odprti",
      priimek: "Natakar",
    }).returning({ id: natakariTable.id });
    const [izmena] = await db.insert(izmeneTable).values({
      enotaId: ctx.enotaId,
      natakariId: natakar.id,
      blagajnaId: ctx.blagajnaId,
      zacetek: eventTime,
    }).returning({ id: izmeneTable.id });
    const [miza] = await db.insert(mizeTable).values({
      enotaId: ctx.enotaId,
      stevilka: 9910,
      ime: "Testna zasedena miza",
      status: "zasedena",
    }).returning({ id: mizeTable.id });
    const [order] = await db.insert(narocilaTable).values({
      enotaId: ctx.enotaId,
      mizaId: miza.id,
      status: "odprto",
      skupaj: "0",
      ustvarjeno: eventTime,
    }).returning({ id: narocilaTable.id });
    const [article] = await db.insert(artikliTable).values({
      enotaId: ctx.enotaId,
      ime: "Testna pripravljena jed",
      cena: "1.00",
      mealType: "prepared",
    }).returning({ id: artikliTable.id });

    try {
      const blocked = await supertest(createTestApp(ctx))
        .post("/z-porocilo/zakljuci")
        .send({ blagajnaId: ctx.blagajnaId, poslovniDatum: datum })
        .expect(409);
      expect(blocked.body.code).toBe("Z_POGOJI_NISO_IZPOLNJENI");
      expect(blocked.body.blockers.map((item: { type: string }) => item.type)).toEqual([
        "OPEN_SHIFTS",
        "OCCUPIED_TABLES",
        "OPEN_ORDERS",
        "OPEN_PREPARED_FOOD",
      ]);

      await db.update(izmeneTable).set({ konec: eventTime })
        .where(eq(izmeneTable.id, izmena.id));
      await db.update(narocilaTable).set({ status: "zakljuceno" }).where(eq(narocilaTable.id, order.id));
      await db.update(mizeTable).set({ status: "prosta" }).where(eq(mizeTable.id, miza.id));
      await db.insert(preparedFoodDailyLedgersTable).values({
        enotaId: ctx.enotaId,
        businessDate: datum,
        artikelId: article.id,
        closedAt: eventTime,
      });
      await db.insert(posCashReconciliationsTable).values({
        companyId: ctx.companyId, enotaId: ctx.enotaId, blagajnaId: ctx.blagajnaId, poslovniDatum: datum,
        pricakovanaGotovina: "50.00", prestetaGotovina: "50.00", razlika: "0.00", confirmed: true,
        actorId: "test-user", idempotencyKey: `cash-${datum}`,
      });

      await supertest(createTestApp(ctx))
        .post("/z-porocilo/zakljuci")
        .send({ blagajnaId: ctx.blagajnaId, poslovniDatum: datum })
        .expect(201);
    } finally {
      await db.delete(preparedFoodDailyLedgersTable)
        .where(eq(preparedFoodDailyLedgersTable.artikelId, article.id));
      await db.delete(artikliTable).where(eq(artikliTable.id, article.id));
      await db.delete(narocilaTable).where(eq(narocilaTable.id, order.id));
      await db.delete(mizeTable).where(eq(mizeTable.id, miza.id));
      await db.delete(izmeneTable).where(eq(izmeneTable.id, izmena.id));
      await db.delete(natakariTable).where(eq(natakariTable.id, natakar.id));
    }
  });
});
