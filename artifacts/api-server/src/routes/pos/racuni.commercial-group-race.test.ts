import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  artikliTable,
  blagajneTable,
  companiesTable,
  db,
  enoteTable,
  narocilaTable,
  normativiTable,
  pool,
  posKarticnaPlacilaAttemptTable,
  posKarticnaPlacilaReferenceTable,
  postavkeTable,
  racunFinalizationPlansTable,
  racunIzdajaZahteveTable,
  racuniTable,
  zalogaGibiTable,
} from "@workspace/db";
import racuniRouter from "./racuni";

afterAll(async () => {
  await pool.end();
});

type GroupKind = "modifier" | "multicourse";

async function waitForBothPlanInsertsToBlock(): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const waiting = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query NOT ILIKE 'LOCK TABLE pos_racun_finalization_plans%'
    `);
    if (Number(waiting.rows[0]?.count ?? 0) >= 2) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const diagnostics = await pool.query<{
    state: string;
    wait_event_type: string | null;
    wait_event: string | null;
    query: string;
  }>(`
    SELECT state, wait_event_type, wait_event, query
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND query NOT ILIKE '%pg_stat_activity%'
  `);
  throw new Error(`Oba računa nista dosegla finalization-plan pregrade: ${JSON.stringify(diagnostics.rows)}`);
}

async function runCommercialGroupRace(kind: GroupKind) {
  const runId = `${kind}-${Math.random().toString(36).slice(2, 10)}`;
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `T566${runId}`,
    naziv: `Commercial group race ${runId}`,
  }).returning({ id: companiesTable.id });
  const [enota] = await db.insert(enoteTable).values({
    companyId: company!.id,
    ime: `Commercial group race ${runId}`,
    capabilities: ["checkout", "receipts", "simulation"],
  }).returning({ id: enoteTable.id });
  const registers = await db.insert(blagajneTable).values([
    { enotaId: enota!.id, ppId: `PP1-${runId}`, bId: `B1-${runId}`, ime: `Register 1 ${runId}`, aktivna: true },
    { enotaId: enota!.id, ppId: `PP2-${runId}`, bId: `B2-${runId}`, ime: `Register 2 ${runId}`, aktivna: true },
  ]).returning({ id: blagajneTable.id });
  const [ingredient, saleArticle, innerArticle, unrelatedArticle] = await db.insert(artikliTable).values([
    {
      enotaId: enota!.id, ime: `Ingredient ${runId}`, cena: "1.00", davek: "22.00",
      nabavniArtikel: true, prodajniArtikel: false, enotaMere: "kg",
    },
    { enotaId: enota!.id, ime: `Commercial ${runId}`, cena: "12.00", davek: "22.00" },
    { enotaId: enota!.id, ime: `Inner ${runId}`, cena: "0.00", davek: "22.00", jeDelMenija: true },
    { enotaId: enota!.id, ime: `Unrelated ${runId}`, cena: "5.00", davek: "22.00" },
  ]).returning({ id: artikliTable.id });
  const stockArticleId = kind === "modifier" ? saleArticle!.id : innerArticle!.id;
  await db.insert(normativiTable).values({
    artikelId: stockArticleId,
    vhodniArtikelId: ingredient!.id,
    kolicina: "0.2500",
  });
  await db.insert(zalogaGibiTable).values({
    artikelId: ingredient!.id,
    tip: "prejemnica",
    kolicina: "10.0000",
    cenaKos: "2.000000",
    vrednost: "20.0000",
    opomba: `Opening stock ${runId}`,
    sourceSnapshot: "test_fixture",
  });
  const [narocilo] = await db.insert(narocilaTable).values({
    enotaId: enota!.id,
    skupaj: "17.00",
  }).returning({ id: narocilaTable.id });

  let selectedByFirst: number;
  let selectedBySecond: number;
  let groupIds: number[];
  if (kind === "modifier") {
    const [parent] = await db.insert(postavkeTable).values({
      narociloId: narocilo!.id, artikelId: saleArticle!.id, ime: `Meal ${runId}`,
      kolicina: 1, cenaKos: "12.00", skupaj: "12.00", davek: "22.00",
    }).returning({ id: postavkeTable.id });
    const [modifier] = await db.insert(postavkeTable).values({
      narociloId: narocilo!.id, ime: `Modifier ${runId}`, parentPostavkaId: parent!.id,
      kolicina: 1, cenaKos: "0.00", skupaj: "0.00", davek: "22.00",
    }).returning({ id: postavkeTable.id });
    selectedByFirst = parent!.id;
    selectedBySecond = modifier!.id;
    groupIds = [parent!.id, modifier!.id];
  } else {
    const pairingGroupId = `menu:${runId}`;
    const [commercial, firstCourse, secondCourse] = await db.insert(postavkeTable).values([
      {
        narociloId: narocilo!.id, artikelId: saleArticle!.id, ime: `Menu ${runId}`,
        kolicina: 1, cenaKos: "12.00", skupaj: "12.00", davek: "22.00",
        pairingGroupId,
      },
      {
        narociloId: narocilo!.id, artikelId: innerArticle!.id, ime: `First course ${runId}`,
        kolicina: 1, cenaKos: "0.00", skupaj: "0.00", davek: "22.00",
        pairingGroupId, courseNumber: 1, courseSequence: 1, jeDelMenija: true,
      },
      {
        narociloId: narocilo!.id, ime: `Second course ${runId}`,
        kolicina: 1, cenaKos: "0.00", skupaj: "0.00", davek: "22.00",
        pairingGroupId, courseNumber: 2, courseSequence: 2, jeDelMenija: true,
      },
    ]).returning({ id: postavkeTable.id });
    selectedByFirst = commercial!.id;
    selectedBySecond = firstCourse!.id;
    groupIds = [commercial!.id, firstCourse!.id, secondCourse!.id];
  }
  const [unrelated] = await db.insert(postavkeTable).values({
    narociloId: narocilo!.id, artikelId: unrelatedArticle!.id, ime: `Unrelated ${runId}`,
    kolicina: 1, cenaKos: "5.00", skupaj: "5.00", davek: "22.00",
  }).returning({ id: postavkeTable.id });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      companyId: company!.id,
      enotaId: enota!.id,
      clerkUserId: req.header("x-test-user") ?? `user-${runId}`,
      napravaKljuc: req.header("x-test-device") ?? `device-${runId}`,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    });
    next();
  });
  app.use(racuniRouter);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  const firstReference = `sumup-first-${runId}`;
  const secondReference = `sumup-second-${runId}`;
  const paymentAttempts = await db.insert(posKarticnaPlacilaAttemptTable).values([
    {
      companyId: company!.id, enotaId: enota!.id, narociloId: narocilo!.id,
      purpose: "receipt", idempotencyKey: `payment-${runId}-first`, provider: "sumup",
      providerReferenca: firstReference, znesek: "12.00", status: "completed",
      actor: `user-${runId}-first`, deviceKey: `device-${runId}-first`,
    },
    {
      companyId: company!.id, enotaId: enota!.id, narociloId: narocilo!.id,
      purpose: "receipt", idempotencyKey: `payment-${runId}-second`, provider: "sumup",
      providerReferenca: secondReference, znesek: "12.00", status: "completed",
      actor: `user-${runId}-second`, deviceKey: `device-${runId}-second`,
    },
  ]).returning({ id: posKarticnaPlacilaAttemptTable.id });
  const requestBody = (
    idempotencyKey: string,
    blagajnaId: number,
    postavkaId: number,
    paymentAttemptId: string,
    sumupCheckoutId: string,
  ) => ({
    narociloId: narocilo!.id,
    postavkeIds: [postavkaId],
    placilnaNacin: "kartica",
    znesekKartica: 12,
    paymentAttemptId,
    sumupCheckoutId,
    blagajnaId,
    idempotencyKey,
  });
  const firstKey = `receipt-${runId}-first`;
  const secondKey = `receipt-${runId}-second`;
  const barrier = await pool.connect();
  await barrier.query("BEGIN");
  await barrier.query("LOCK TABLE pos_racun_finalization_plans IN ACCESS EXCLUSIVE MODE");
  const firstPromise = supertest(app).post("/racuni")
    .set("x-test-user", `user-${runId}-first`)
    .set("x-test-device", `device-${runId}-first`)
    .send(requestBody(firstKey, registers[0]!.id, selectedByFirst, paymentAttempts[0]!.id, firstReference))
    .then(response => response);
  const secondPromise = supertest(app).post("/racuni")
    .set("x-test-user", `user-${runId}-second`)
    .set("x-test-device", `device-${runId}-second`)
    .send(requestBody(secondKey, registers[1]!.id, selectedBySecond, paymentAttempts[1]!.id, secondReference))
    .then(response => response);
  try {
    await waitForBothPlanInsertsToBlock();
  } finally {
    await barrier.query("COMMIT");
    barrier.release();
  }
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  expect([first.status, second.status].sort()).toEqual([201, 409]);
  const winner = first.status === 201
    ? {
        response: first, key: firstKey, registerId: registers[0]!.id, selectedId: selectedByFirst,
        attemptId: paymentAttempts[0]!.id, reference: firstReference, device: `device-${runId}-first`,
      }
    : {
        response: second, key: secondKey, registerId: registers[1]!.id, selectedId: selectedBySecond,
        attemptId: paymentAttempts[1]!.id, reference: secondReference, device: `device-${runId}-second`,
      };
  const loser = first.status === 409 ? first : second;
  const loserReference = first.status === 409 ? firstReference : secondReference;
  expect(loser.body).toMatchObject({ code: "COMMERCIAL_GROUP_ALREADY_RESERVED" });

  const receiptId = Number(winner.response.body.id);
  const lines = await db.select({ id: postavkeTable.id, racunId: postavkeTable.racunId })
    .from(postavkeTable)
    .where(inArray(postavkeTable.id, [...groupIds, unrelated!.id]));
  expect(lines.filter(line => groupIds.includes(line.id)).map(line => line.racunId))
    .toEqual(groupIds.map(() => receiptId));
  expect(lines.find(line => line.id === unrelated!.id)?.racunId).toBeNull();

  const receipts = await db.select({ id: racuniTable.id }).from(racuniTable)
    .where(eq(racuniTable.narociloId, narocilo!.id));
  expect(receipts).toEqual([{ id: receiptId }]);
  const plans = await db.select().from(racunFinalizationPlansTable)
    .where(eq(racunFinalizationPlansTable.racunId, receiptId));
  expect(plans).toHaveLength(1);
  const plan = plans[0]!.plan as any;
  expect(plan.soldLines.map((line: { id: number }) => line.id).sort((a: number, b: number) => a - b))
    .toEqual([...groupIds].sort((a, b) => a - b));
  expect(plan.stockMovements).toHaveLength(1);
  expect(plan.kds.effects).toEqual([]);
  const stockEffects = await db.select({ id: zalogaGibiTable.id }).from(zalogaGibiTable)
    .where(and(
      eq(zalogaGibiTable.artikelId, ingredient!.id),
      eq(zalogaGibiTable.sourceSnapshot, "racun_finalization_plan"),
      eq(zalogaGibiTable.referencaId, receiptId),
    ));
  expect(stockEffects).toHaveLength(1);
  const terminalReferences = await db.select({
    referenca: posKarticnaPlacilaReferenceTable.referenca,
    status: posKarticnaPlacilaReferenceTable.status,
    racunId: posKarticnaPlacilaReferenceTable.racunId,
  }).from(posKarticnaPlacilaReferenceTable).where(inArray(
    posKarticnaPlacilaReferenceTable.referenca,
    [firstReference, secondReference],
  ));
  expect(terminalReferences.find(reference => reference.referenca === winner.reference))
    .toMatchObject({ status: "used", racunId: receiptId });
  expect(terminalReferences.find(reference => reference.referenca === loserReference))
    .toMatchObject({ status: "failed", racunId: null });
  const issueRequests = await db.select().from(racunIzdajaZahteveTable)
    .where(eq(racunIzdajaZahteveTable.narociloId, narocilo!.id));
  expect(issueRequests).toHaveLength(1);
  expect(issueRequests[0]).toMatchObject({ status: "completed", racunId: receiptId });

  const replay = await supertest(app).post("/racuni").send(
    requestBody(winner.key, winner.registerId, winner.selectedId, winner.attemptId, winner.reference),
  ).set("x-test-device", winner.device);
  expect(replay.status, replay.body).toBe(200);
  expect(replay.body.id).toBe(receiptId);
  const replayLines = await db.select({ id: postavkeTable.id, racunId: postavkeTable.racunId })
    .from(postavkeTable).where(inArray(postavkeTable.id, groupIds));
  expect(replayLines.map(line => ({ id: line.id, racunId: line.racunId })).sort((a, b) => a.id - b.id))
    .toEqual(groupIds.map(id => ({ id, racunId: receiptId })).sort((a, b) => a.id - b.id));
  const plansAfterReplay = await db.select({ id: racunFinalizationPlansTable.id })
    .from(racunFinalizationPlansTable).where(eq(racunFinalizationPlansTable.racunId, receiptId));
  const stockEffectsAfterReplay = await db.select({ id: zalogaGibiTable.id }).from(zalogaGibiTable)
    .where(and(
      eq(zalogaGibiTable.artikelId, ingredient!.id),
      eq(zalogaGibiTable.sourceSnapshot, "racun_finalization_plan"),
      eq(zalogaGibiTable.referencaId, receiptId),
    ));
  expect(plansAfterReplay).toHaveLength(1);
  expect(stockEffectsAfterReplay).toEqual(stockEffects);
}

describe("commercial group partial receipt concurrency", () => {
  it("keeps an ordinary line and its modifier on one receipt", async () => {
    await runCommercialGroupRace("modifier");
  });

  it("keeps a commercial multicourse menu and all operational courses on one receipt", async () => {
    await runCommercialGroupRace("multicourse");
  });
});