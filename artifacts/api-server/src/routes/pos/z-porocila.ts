/**
 * Z-poročilo — formalni zaklenjeni dnevni zaključek blagajne.
 *
 * POST /z-porocilo/zakljuci    — atomen dnevni zaključek (blagajnik za svojo blagajno ali vodja)
 * GET  /z-porocilo             — seznam Z za blagajno
 * GET  /z-porocilo/status      — preveri, ali je tekoči dan zaklenjen
 * POST /z-porocilo/:id/odkleni — admin odklep z obveznim razlogom (revizija)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, isNull, lt, gte, ne, sum, count, sql, max } from "drizzle-orm";
import {
  blagajneTable, blagajniskeNastavitveTable, blagajniskiPremikiTable,
  db, posUporabnikiTable, racuniTable,
  zPorocilaTable, zPorociloOdklePiTable, posCashReconciliationsTable,
} from "@workspace/db";
import type { PosRequest } from "../../middlewares/pos";
import { calculateTheoreticalCashBalance } from "../../lib/cashMovementAccounting";
import {
  checkPreviousBusinessDayClosed,
  getZCloseBlockers,
  lockPosBusinessDay,
  type ZCloseBlocker,
} from "../../lib/pos-z-helpers";
import { getBusinessDayBounds, getCurrentPosBusinessDate } from "../../lib/pos-business-day";
import { getPosReceiptPrefixPattern } from "../../lib/pos-register-receipt-prefix";
import { getTipBreakdown } from "../../lib/tip-reporting";
import { writePosActorAudit } from "../../lib/posActorAudit";

const router: IRouter = Router();

function isManager(vloga: string): boolean {
  return ["admin", "admin_enote", "superadmin"].includes(vloga);
}

async function getExpectedCash(
  executor: Pick<typeof db, "execute" | "select">,
  companyId: string,
  enotaId: number,
  blagajnaId: number,
  poslovniDatum: string,
): Promise<{ pricakovanaGotovina: number; gotovinskaProdaja: number }> {
  const [blagajna] = await executor.select({
    ppId: blagajneTable.ppId, bId: blagajneTable.bId,
  }).from(blagajneTable).where(and(eq(blagajneTable.id, blagajnaId), eq(blagajneTable.enotaId, enotaId))).limit(1);
  if (!blagajna) throw Object.assign(new Error("Blagajna ne pripada enoti."), { status: 403 });
  const { start, end } = await getBusinessDayBounds(enotaId, poslovniDatum, executor);
  const prefix = getPosReceiptPrefixPattern(blagajna.ppId, blagajna.bId);
  const [settings] = await executor.select({ menjalniDenar: blagajniskeNastavitveTable.menjalniDenar })
    .from(blagajniskeNastavitveTable)
    .where(and(eq(blagajniskeNastavitveTable.companyId, companyId), eq(blagajniskeNastavitveTable.enotaId, enotaId), eq(blagajniskeNastavitveTable.blagajnaId, blagajnaId))).limit(1);
  const salesResult = await executor.execute(sql`
    SELECT COALESCE(SUM(CASE
      WHEN znesek_gotovina IS NOT NULL OR znesek_kartica IS NOT NULL OR znesek_bon IS NOT NULL OR znesek_bon_pica IS NOT NULL OR znesek_negotovinsko IS NOT NULL THEN COALESCE(znesek_gotovina::numeric, 0)
      WHEN placilna_nacin = 'gotovina' THEN skupaj::numeric ELSE 0 END), 0) AS znesek
    FROM racuni WHERE enota_id = ${enotaId} AND stevilka_racuna LIKE ${prefix} ESCAPE '!'
      AND status != 'storniran' AND je_storno IS NOT TRUE
      AND ustvarjeno >= ${start.toISOString()}::timestamptz AND ustvarjeno < ${end.toISOString()}::timestamptz
  `);
  const movements = await executor.execute(sql`
    SELECT tip, COALESCE(SUM(znesek::numeric), 0) AS znesek FROM blagajniski_premiki
    WHERE company_id = ${companyId} AND enota_id = ${enotaId} AND blagajna_id = ${blagajnaId}
      AND datum_cas >= ${start.toISOString()}::timestamptz AND datum_cas < ${end.toISOString()}::timestamptz
      AND status = 'POTRJEN' AND tip != 'STORNO' GROUP BY tip
  `);
  const gotovinskaProdaja = Number((salesResult.rows[0] as { znesek: string } | undefined)?.znesek ?? 0);
  const byType = new Map((movements.rows as Array<{ tip: string; znesek: string }>).map(row => [row.tip, Number(row.znesek)]));
  return {
    gotovinskaProdaja,
    pricakovanaGotovina: calculateTheoreticalCashBalance({
      menjalniDenar: Number(settings?.menjalniDenar ?? 50), gotovinskaProdaja,
      pologiGotovine: byType.get("POLOG_GOTOVINE") ?? 0,
      izplacilaDobaviteljem: byType.get("IZPLACILO_DOBAVITELJU") ?? 0,
      dvigiGotovine: 0, pologiTrr: byType.get("POLOG_TRR") ?? 0,
    }),
  };
}

async function requireRegister(enotaId: number, blagajnaId: number) {
  const [blagajna] = await db.select({ id: blagajneTable.id }).from(blagajneTable)
    .where(and(eq(blagajneTable.id, blagajnaId), eq(blagajneTable.enotaId, enotaId))).limit(1);
  return blagajna;
}

async function requireXReportRegister(
  posReq: PosRequest,
  blagajnaId: number,
  res: Response,
): Promise<boolean> {
  if (!await requireRegister(posReq.enotaId, blagajnaId)) {
    res.status(403).json({ error: "Blagajna ne pripada enoti." });
    return false;
  }
  if (posReq.vloga === "uporabnik") {
    const [user] = await db.select({ blagajnaId: posUporabnikiTable.blagajnaId })
      .from(posUporabnikiTable)
      .where(and(
        eq(posUporabnikiTable.clerkUserId, posReq.clerkUserId),
        eq(posUporabnikiTable.companyId, posReq.companyId),
        eq(posUporabnikiTable.aktiven, true),
      ))
      .limit(1);
    if (user?.blagajnaId !== blagajnaId) {
      res.status(403).json({ error: "Blagajnik lahko uporablja samo svojo dodeljeno blagajno." });
      return false;
    }
  }
  return true;
}

// ── X snapshot and cash reconciliation ───────────────────────────────────────
router.get("/x-porocilo", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const blagajnaId = Number(req.query.blagajnaId);
  if (!Number.isInteger(blagajnaId) || blagajnaId < 1) { res.status(400).json({ error: "Podajte blagajnaId." }); return; }
  if (!await requireXReportRegister(posReq, blagajnaId, res)) return;
  const poslovniDatum = typeof req.query.poslovniDatum === "string" && /^\d{4}-\d{2}-\d{2}$/.test(req.query.poslovniDatum)
    ? req.query.poslovniDatum : await getCurrentPosBusinessDate(posReq.enotaId);
  const cash = await getExpectedCash(db, posReq.companyId, posReq.enotaId, blagajnaId, poslovniDatum);
  const { start, end } = await getBusinessDayBounds(posReq.enotaId, poslovniDatum);
  const [register] = await db.select({ ppId: blagajneTable.ppId, bId: blagajneTable.bId }).from(blagajneTable).where(eq(blagajneTable.id, blagajnaId)).limit(1);
  const registerPrefix = getPosReceiptPrefixPattern(register!.ppId, register!.bId);
  const tipBreakdown = await getTipBreakdown(
    db, posReq.enotaId, start, end, registerPrefix,
  );
  const totalsResult = await db.execute(sql`
    SELECT COALESCE(SUM(r.skupaj::numeric),0) AS promet_dneva, COALESCE(SUM(r.ddv::numeric),0) AS skupaj_ddv, COUNT(*)::int AS stevilo_racunov,
      COALESCE(SUM(CASE WHEN (r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL) THEN COALESCE(r.znesek_gotovina::numeric,0) WHEN r.placilna_nacin='gotovina' THEN r.skupaj::numeric ELSE 0 END),0) AS gotovina,
      COALESCE(SUM(CASE WHEN (r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL) THEN COALESCE(r.znesek_kartica::numeric,0) WHEN r.placilna_nacin='kartica' THEN r.skupaj::numeric ELSE 0 END),0) AS kartica,
      COALESCE(SUM(CASE WHEN (r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL) THEN COALESCE(r.znesek_bon::numeric,0) WHEN r.placilna_nacin='bon' THEN r.skupaj::numeric ELSE 0 END),0) AS bon,
      COALESCE(SUM(CASE WHEN (r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL) THEN COALESCE(r.znesek_bon_pica::numeric,0) WHEN r.placilna_nacin='bon_pica' THEN r.skupaj::numeric ELSE 0 END),0) AS bon_pica,
      COALESCE(SUM(CASE WHEN (r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL) THEN COALESCE(r.znesek_negotovinsko::numeric,0) WHEN r.placilna_nacin='negotovinsko' THEN r.skupaj::numeric ELSE 0 END),0) AS negotovinsko,
      COALESCE(SUM(r.znesek_napitnina::numeric),0) AS znesek_napitnina
    FROM racuni r WHERE r.enota_id=${posReq.enotaId} AND r.stevilka_racuna LIKE ${registerPrefix} ESCAPE '!'
      AND r.status != 'storniran' AND r.je_storno IS NOT TRUE AND r.ustvarjeno >= ${start.toISOString()}::timestamptz AND r.ustvarjeno < ${end.toISOString()}::timestamptz
  `);
  const totalsRow = totalsResult.rows[0] as Record<string, string | number>;
  const numericTotals = Object.fromEntries(Object.entries(totalsRow).map(([key, value]) => [key, Number(value ?? 0)]));
  // Obdrži obstoječa SQL/snake_case polja, camelCase pa je javno ime novega
  // bon-pica razreza in je skladno z ostalimi POS poročili.
  const totals = { ...numericTotals, bonPica: numericTotals.bon_pica ?? 0 };
  const [reconciliation] = await db.select().from(posCashReconciliationsTable).where(and(
    eq(posCashReconciliationsTable.enotaId, posReq.enotaId), eq(posCashReconciliationsTable.blagajnaId, blagajnaId),
    eq(posCashReconciliationsTable.poslovniDatum, poslovniDatum),
  )).limit(1);
  const blockers = await getZCloseBlockers(db, posReq.enotaId, poslovniDatum, blagajnaId);
  res.json({ poslovniDatum, blagajnaId, ...cash, totals, tipBreakdown, reconciliation: reconciliation ? {
    ...reconciliation, pricakovanaGotovina: Number(reconciliation.pricakovanaGotovina), prestetaGotovina: Number(reconciliation.prestetaGotovina), razlika: Number(reconciliation.razlika),
  } : null, blockers });
});

router.post("/x-porocilo/uskladitev-gotovine", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const body = req.body as Record<string, unknown>;
  const blagajnaId = Number(body.blagajnaId);
  const prestetaGotovina = Number(body.prestetaGotovina);
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const overrideRazlog = typeof body.overrideRazlog === "string" ? body.overrideRazlog.trim() : "";
  if (!Number.isInteger(blagajnaId) || blagajnaId < 1 || !Number.isFinite(prestetaGotovina) || !idempotencyKey) {
    res.status(400).json({ error: "Podajte blagajnaId, prešteto gotovino in idempotencyKey." }); return;
  }
  if (!await requireXReportRegister(posReq, blagajnaId, res)) return;
  const poslovniDatum = typeof body.poslovniDatum === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.poslovniDatum)
    ? body.poslovniDatum : await getCurrentPosBusinessDate(posReq.enotaId);
  const expected = await getExpectedCash(db, posReq.companyId, posReq.enotaId, blagajnaId, poslovniDatum);
  const razlika = Math.round((prestetaGotovina - expected.pricakovanaGotovina) * 100) / 100;
  if (razlika !== 0 && !overrideRazlog) { res.status(400).json({ error: "Ob razliki gotovine je obvezen razlog odstopanja." }); return; }
  try {
    const [saved] = await db.insert(posCashReconciliationsTable).values({
      companyId: posReq.companyId, enotaId: posReq.enotaId, blagajnaId, poslovniDatum,
      pricakovanaGotovina: expected.pricakovanaGotovina.toFixed(2), prestetaGotovina: prestetaGotovina.toFixed(2),
      razlika: razlika.toFixed(2), confirmed: razlika === 0, overrideRazlog: overrideRazlog || null,
      actorId: posReq.clerkUserId, idempotencyKey,
    }).returning();
    res.status(201).json({ ...saved, pricakovanaGotovina: Number(saved.pricakovanaGotovina), prestetaGotovina: Number(saved.prestetaGotovina), razlika: Number(saved.razlika) });
  } catch (error: unknown) {
    const [existing] = await db.select().from(posCashReconciliationsTable).where(and(eq(posCashReconciliationsTable.enotaId, posReq.enotaId), eq(posCashReconciliationsTable.idempotencyKey, idempotencyKey))).limit(1);
    if (existing) { res.status(200).json({ ...existing, pricakovanaGotovina: Number(existing.pricakovanaGotovina), prestetaGotovina: Number(existing.prestetaGotovina), razlika: Number(existing.razlika) }); return; }
    // Za isti poslovni dan in blagajno je dovoljen en sam zapis usklajevanja.
    const [dayRecord] = await db.select().from(posCashReconciliationsTable).where(and(
      eq(posCashReconciliationsTable.enotaId, posReq.enotaId),
      eq(posCashReconciliationsTable.blagajnaId, blagajnaId),
      eq(posCashReconciliationsTable.poslovniDatum, poslovniDatum),
    )).limit(1);
    if (dayRecord) {
      if (dayRecord.confirmed && Number(dayRecord.prestetaGotovina) === prestetaGotovina) {
        res.status(200).json({ ...dayRecord, pricakovanaGotovina: Number(dayRecord.pricakovanaGotovina), prestetaGotovina: Number(dayRecord.prestetaGotovina), razlika: Number(dayRecord.razlika) });
        return;
      }
      res.status(409).json({ error: "Za ta poslovni dan je usklajevanje gotovine že shranjeno z drugim zneskom." });
      return;
    }
    throw error;
  }
});

// ── GET /z-porocilo/status ────────────────────────────────────────────────────
router.get("/z-porocilo/status", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const rawId = typeof req.query.blagajnaId === "string" ? req.query.blagajnaId : "";
  const blagajnaId = parseInt(rawId, 10);
  if (!Number.isInteger(blagajnaId) || blagajnaId < 1) {
    res.status(400).json({ error: "Podajte blagajnaId." }); return;
  }
  const [blagajna] = await db.select({ id: blagajneTable.id })
    .from(blagajneTable)
    .where(and(eq(blagajneTable.id, blagajnaId), eq(blagajneTable.enotaId, posReq.enotaId))).limit(1);
  if (!blagajna) { res.status(403).json({ error: "Blagajna ne pripada enoti." }); return; }

  const datum = await getCurrentPosBusinessDate(posReq.enotaId);
  const [z] = await db.select({
    id: zPorocilaTable.id,
    zStevilka: zPorocilaTable.zStevilka,
    zakljucenOb: zPorocilaTable.zakljucenOb,
    odklenjenOb: zPorocilaTable.odklenjenOb,
    grandTotalNov: zPorocilaTable.grandTotalNov,
  }).from(zPorocilaTable)
    .where(and(
      eq(zPorocilaTable.enotaId, posReq.enotaId),
      eq(zPorocilaTable.blagajnaId, blagajnaId),
      eq(zPorocilaTable.poslovniDatum, datum),
    )).limit(1);

  // Pretekli dan z dejavnostjo brez Z za to blagajno: UI ga mora ponuditi namesto današnjega.
  const preteklaVrata = await checkPreviousBusinessDayClosed(db, posReq.enotaId, datum);
  const manjkajociDatum = !preteklaVrata.allowed
    && preteklaVrata.missingRegisters.some(r => r.id === blagajnaId)
    ? preteklaVrata.previousBusinessDate
    : null;

  res.setHeader("Cache-Control", "no-store");
  res.json({
    datum,
    manjkajociDatum,
    zaklenjen: !!z && z.odklenjenOb === null,
    odklenjen: !!z && z.odklenjenOb !== null,
    zPorociloId: z?.id ?? null,
    zStevilka: z?.zStevilka ?? null,
    zakljucenOb: z?.zakljucenOb ?? null,
    grandTotalNov: z?.grandTotalNov ? Number(z.grandTotalNov) : null,
  });
});

// ── GET /z-porocilo ───────────────────────────────────────────────────────────
router.get("/z-porocilo", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const rawId = typeof req.query.blagajnaId === "string" ? req.query.blagajnaId : "";
  const blagajnaId = parseInt(rawId, 10);
  if (!Number.isInteger(blagajnaId) || blagajnaId < 1) {
    res.status(400).json({ error: "Podajte blagajnaId." }); return;
  }
  const [blagajna] = await db.select({ id: blagajneTable.id })
    .from(blagajneTable)
    .where(and(eq(blagajneTable.id, blagajnaId), eq(blagajneTable.enotaId, posReq.enotaId))).limit(1);
  if (!blagajna) { res.status(403).json({ error: "Blagajna ne pripada enoti." }); return; }

  const seznam = await db.select().from(zPorocilaTable)
    .where(and(eq(zPorocilaTable.enotaId, posReq.enotaId), eq(zPorocilaTable.blagajnaId, blagajnaId)))
    .orderBy(desc(zPorocilaTable.zStevilka))
    .limit(50);

  res.json(seznam.map(z => ({
    ...z,
    grandTotalPrej: Number(z.grandTotalPrej),
    grandTotalNov: Number(z.grandTotalNov),
    prometDneva: Number(z.prometDneva),
    skupajPromet: Number(z.skupajPromet),
    skupajDdv: Number(z.skupajDdv),
    gotovina: Number(z.gotovina), kartica: Number(z.kartica), sumup: Number(z.sumup),
    znesekNapitnina: Number(z.znesekNapitnina),
    bon: Number(z.bon), bonPica: Number(z.bonPica), negotovinsko: Number(z.negotovinsko),
    reprezentanca: Number(z.reprezentanca), lastnaPoraba: Number(z.lastnaPoraba),
    menjalniDenar: Number(z.menjalniDenar), gotovinskaProdaja: Number(z.gotovinskaProdaja),
    pologiGotovine: Number(z.pologiGotovine), izplacilaJobaviteljem: Number(z.izplacilaJobaviteljem),
    pologiTrr: Number(z.pologiTrr), stanjeBlagajne: Number(z.stanjeBlagajne),
    darilniBoniIzdaja: Number(z.darilniBoniIzdaja), darilniBoniUnovcitev: Number(z.darilniBoniUnovcitev),
    sspSubvencija: Number(z.sspSubvencija),
  })));
});

// ── POST /z-porocilo/zakljuci ─────────────────────────────────────────────────
router.post("/z-porocilo/zakljuci", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const body = req.body as Record<string, unknown>;
  const rawBlagajnaId = Number(body.blagajnaId);
  const zahtevaniPoslovniDatum =
    typeof body.poslovniDatum === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.poslovniDatum)
      ? body.poslovniDatum
      : null;

  if (!Number.isInteger(rawBlagajnaId) || rawBlagajnaId < 1) {
    res.status(400).json({ error: "Podajte blagajnaId." }); return;
  }
  if (!await requireXReportRegister(posReq, rawBlagajnaId, res)) return;

  const [blagajnaRow] = await db.select({ id: blagajneTable.id, ppId: blagajneTable.ppId, bId: blagajneTable.bId })
    .from(blagajneTable)
    .where(and(eq(blagajneTable.id, rawBlagajnaId), eq(blagajneTable.enotaId, posReq.enotaId))).limit(1);
  if (!blagajnaRow) { res.status(403).json({ error: "Blagajna ne pripada enoti." }); return; }

  const blagajnaPrefix = getPosReceiptPrefixPattern(blagajnaRow.ppId, blagajnaRow.bId);
  const blagajnaFilter = sql`AND stevilka_racuna LIKE ${blagajnaPrefix} ESCAPE '!'`;

  try {
    const result = await db.transaction(async (tx) => {
      // Enotni zaklep prepreči novo naročilo med preverjanjem pogojev in Z-zapisom.
      await lockPosBusinessDay(tx, posReq.enotaId);
      const poslovniDatum = zahtevaniPoslovniDatum
        ?? await getCurrentPosBusinessDate(posReq.enotaId, undefined, tx);
      const { start: odDate, end: doDate } = await getBusinessDayBounds(
        posReq.enotaId,
        poslovniDatum,
        tx,
      );
       const tipBreakdown = await getTipBreakdown(tx, posReq.enotaId, odDate, doDate, blagajnaPrefix);
      // Advisory lock prepreči sočasne zaključke iste blagajne.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`z-zakljucek:${posReq.enotaId}:${rawBlagajnaId}`}))`);

      // Preveri obstoječi Z za ta dan
      const [obstojeciZ] = await tx.select({
        id: zPorocilaTable.id,
        odklenjenOb: zPorocilaTable.odklenjenOb,
        prometDneva: zPorocilaTable.prometDneva,
        grandTotalNov: zPorocilaTable.grandTotalNov,
      }).from(zPorocilaTable)
        .where(and(
          eq(zPorocilaTable.enotaId, posReq.enotaId),
          eq(zPorocilaTable.blagajnaId, rawBlagajnaId),
          eq(zPorocilaTable.poslovniDatum, poslovniDatum),
        )).limit(1);

      if (obstojeciZ && obstojeciZ.odklenjenOb === null) {
        throw Object.assign(new Error("Dan je že zaklenjen z Z-poročilom."), { status: 409 });
      }
      const jePonovniZakljucek = !!obstojeciZ && obstojeciZ.odklenjenOb !== null;

      const blockers = await getZCloseBlockers(tx, posReq.enotaId, poslovniDatum, rawBlagajnaId);
      if (blockers.length > 0) {
        throw Object.assign(
          new Error("Dneva še ni mogoče zaključiti. Odpravite navedene blokade."),
          { status: 409, code: "Z_POGOJI_NISO_IZPOLNJENI", blockers },
        );
      }
      const [reconciliation] = await tx.select({
        confirmed: posCashReconciliationsTable.confirmed,
        overrideRazlog: posCashReconciliationsTable.overrideRazlog,
      }).from(posCashReconciliationsTable).where(and(
        eq(posCashReconciliationsTable.enotaId, posReq.enotaId),
        eq(posCashReconciliationsTable.blagajnaId, rawBlagajnaId),
        eq(posCashReconciliationsTable.poslovniDatum, poslovniDatum),
      )).limit(1);
      if (!reconciliation || (!reconciliation.confirmed && !reconciliation.overrideRazlog?.trim())) {
        throw Object.assign(
          new Error("Pred Z-zaključkom potrdite uskladitev gotovine ali zabeležite razlog odstopanja."),
          { status: 409, code: "GOTOVINA_NI_USKLAJENA" },
        );
      }

      // ── Izračun prometnih vrednosti ────────────────────────────────────────
      const pogoj = and(
        gte(racuniTable.ustvarjeno, odDate),
        lt(racuniTable.ustvarjeno, doDate),
        eq(racuniTable.enotaId, posReq.enotaId),
        ne(racuniTable.status, "storniran"),
        ne(racuniTable.jeStorno, true),
        sql`stevilka_racuna LIKE ${blagajnaPrefix} ESCAPE '!'`,
      );

      const [skupni] = await tx.select({
        skupaj: sum(racuniTable.skupaj),
        napitnina: sum(racuniTable.znesekNapitnina),
        stevilo: count(racuniTable.id),
        ddv: sum(racuniTable.ddv),
      }).from(racuniTable).where(pogoj);

      const hasSplit = sql`(znesek_gotovina IS NOT NULL OR znesek_kartica IS NOT NULL OR znesek_bon IS NOT NULL OR znesek_bon_pica IS NOT NULL OR znesek_negotovinsko IS NOT NULL)`;
      const placRes = await tx.execute(sql`
        SELECT
          SUM(CASE WHEN ${hasSplit} THEN COALESCE(znesek_gotovina::numeric,0) WHEN placilna_nacin='gotovina' THEN skupaj::numeric ELSE 0 END) AS gotovina,
          SUM(CASE WHEN ${hasSplit} THEN CASE WHEN sumup_checkout_id IS NULL THEN COALESCE(znesek_kartica::numeric,0) ELSE 0 END WHEN placilna_nacin='kartica' AND sumup_checkout_id IS NULL THEN skupaj::numeric ELSE 0 END) AS kartica,
          SUM(CASE WHEN ${hasSplit} THEN CASE WHEN sumup_checkout_id IS NOT NULL THEN COALESCE(znesek_kartica::numeric,0) ELSE 0 END WHEN placilna_nacin='kartica' AND sumup_checkout_id IS NOT NULL THEN skupaj::numeric ELSE 0 END) AS sumup,
          SUM(CASE WHEN ${hasSplit} THEN COALESCE(znesek_bon::numeric,0) WHEN placilna_nacin='bon' THEN skupaj::numeric ELSE 0 END) AS bon,
          SUM(CASE WHEN ${hasSplit} THEN COALESCE(znesek_bon_pica::numeric,0) WHEN placilna_nacin='bon_pica' THEN skupaj::numeric ELSE 0 END) AS bon_pica,
          COALESCE(SUM(stevilo_bonov),0)::int AS stevilo_bonov,
          SUM(CASE WHEN ${hasSplit} THEN COALESCE(znesek_negotovinsko::numeric,0) WHEN placilna_nacin='negotovinsko' THEN skupaj::numeric ELSE 0 END) AS negotovinsko
        FROM racuni
        WHERE ustvarjeno >= ${odDate.toISOString()}::timestamptz
          AND ustvarjeno < ${doDate.toISOString()}::timestamptz
          AND enota_id = ${posReq.enotaId}
          AND status != 'storniran' AND je_storno IS NOT TRUE
          ${blagajnaFilter}
      `);
      type PlacRow = { gotovina:string; kartica:string; sumup:string; bon:string; bon_pica:string; stevilo_bonov:number; negotovinsko:string };
      const pl = placRes.rows[0] as PlacRow;

      // Reprezentanca/lastna_poraba — face value iz postavk
      const faceValRes = await tx.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN r.placilna_nacin='reprezentanca' THEN p.skupaj::numeric ELSE 0 END),0) AS repr,
          COALESCE(SUM(CASE WHEN r.placilna_nacin='lastna_poraba' THEN p.skupaj::numeric ELSE 0 END),0) AS lastna
        FROM postavke p
        JOIN racuni r ON r.id = p.racun_id
        WHERE r.ustvarjeno >= ${odDate.toISOString()}::timestamptz
          AND r.ustvarjeno < ${doDate.toISOString()}::timestamptz
          AND r.enota_id = ${posReq.enotaId}
          AND r.status != 'storniran' AND r.je_storno IS NOT TRUE
          AND r.stevilka_racuna LIKE ${blagajnaPrefix} ESCAPE '!'
          AND r.placilna_nacin IN ('reprezentanca','lastna_poraba')
      `);
      type FaceRow = { repr: string; lastna: string };
      const fv = faceValRes.rows[0] as FaceRow;

      // DDV po stopnjah
      const ddvRes = await tx.execute(sql`
        SELECT p.davek::numeric AS stopnja,
               SUM(p.skupaj::numeric * p.davek::numeric / (100 + p.davek::numeric)) AS ddv_znesek,
               SUM(p.skupaj::numeric / (1 + p.davek::numeric/100)) AS osnova
        FROM postavke p
        JOIN racuni r ON r.id = p.racun_id
        WHERE r.ustvarjeno >= ${odDate.toISOString()}::timestamptz
          AND r.ustvarjeno < ${doDate.toISOString()}::timestamptz
          AND r.enota_id = ${posReq.enotaId}
          AND r.status != 'storniran' AND r.je_storno IS NOT TRUE
          AND r.stevilka_racuna LIKE ${blagajnaPrefix} ESCAPE '!'
        GROUP BY p.davek ORDER BY p.davek
      `);
      type DdvRow = { stopnja:string; ddv_znesek:string; osnova:string };
      const ddvPoStopnjah = (ddvRes.rows as DdvRow[]).map(r => ({
        stopnja: Number(r.stopnja), ddvZnesek: Number(r.ddv_znesek), osnova: Number(r.osnova),
      }));

      // Od/do zap
      const zapRes = await tx.execute(sql`
        SELECT MIN(SPLIT_PART(stevilka_racuna,'-',3)) AS od_zap, MAX(SPLIT_PART(stevilka_racuna,'-',3)) AS do_zap
        FROM racuni
        WHERE ustvarjeno >= ${odDate.toISOString()}::timestamptz
          AND ustvarjeno < ${doDate.toISOString()}::timestamptz
          AND enota_id = ${posReq.enotaId}
          AND status != 'storniran' AND je_storno IS NOT TRUE
          ${blagajnaFilter}
      `);
      type ZapRow = { od_zap:string|null; do_zap:string|null };
      const zap = zapRes.rows[0] as ZapRow;

      // ── Blagajniški dnevnik (getBalance logika) ───────────────────────────
      const [floatSett] = await tx.select({ menjalniDenar: blagajniskeNastavitveTable.menjalniDenar })
        .from(blagajniskeNastavitveTable)
        .where(and(
          eq(blagajniskeNastavitveTable.companyId, posReq.companyId),
          eq(blagajniskeNastavitveTable.enotaId, posReq.enotaId),
          eq(blagajniskeNastavitveTable.blagajnaId, rawBlagajnaId),
        )).limit(1);

      const cashSalRes = await tx.execute(sql`
        SELECT COALESCE(SUM(CASE WHEN znesek_gotovina IS NOT NULL OR znesek_kartica IS NOT NULL OR znesek_bon IS NOT NULL OR znesek_bon_pica IS NOT NULL OR znesek_negotovinsko IS NOT NULL THEN COALESCE(znesek_gotovina::numeric,0) WHEN placilna_nacin='gotovina' THEN skupaj::numeric ELSE 0 END),0) AS znesek
        FROM racuni
        WHERE enota_id = ${posReq.enotaId}
          AND stevilka_racuna LIKE ${blagajnaPrefix} ESCAPE '!'
          AND status != 'storniran' AND je_storno IS NOT TRUE
          AND ustvarjeno >= ${odDate.toISOString()}::timestamptz
          AND ustvarjeno < ${doDate.toISOString()}::timestamptz
      `);
      const cashSal = cashSalRes.rows[0] as { znesek: string };

      const movRes = await tx.select({
        tip: blagajniskiPremikiTable.tip,
        znesek: sum(blagajniskiPremikiTable.znesek),
      }).from(blagajniskiPremikiTable)
        .where(and(
          eq(blagajniskiPremikiTable.companyId, posReq.companyId),
          eq(blagajniskiPremikiTable.enotaId, posReq.enotaId),
          eq(blagajniskiPremikiTable.blagajnaId, rawBlagajnaId),
          gte(blagajniskiPremikiTable.datumCas, odDate),
          lt(blagajniskiPremikiTable.datumCas, doDate),
          eq(blagajniskiPremikiTable.status, "POTRJEN"),
          ne(blagajniskiPremikiTable.tip, "STORNO"),
        )).groupBy(blagajniskiPremikiTable.tip);
      const byType = new Map(movRes.map(r => [r.tip, Number(r.znesek ?? 0)]));
      const balInput = {
        menjalniDenar: Number(floatSett?.menjalniDenar ?? 50),
        gotovinskaProdaja: Number(cashSal.znesek ?? 0),
        pologiGotovine: byType.get("POLOG_GOTOVINE") ?? 0,
        izplacilaDobaviteljem: byType.get("IZPLACILO_DOBAVITELJU") ?? 0,
        dvigiGotovine: 0,
        pologiTrr: byType.get("POLOG_TRR") ?? 0,
      };
      const stanje = calculateTheoreticalCashBalance(balInput);

      // ── Darilni boni ───────────────────────────────────────────────────────
      const dbonRes = await tx.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN dbg.tip='izdaja'    THEN dbg.znesek::numeric ELSE 0 END),0) AS izdaja,
          COALESCE(SUM(CASE WHEN dbg.tip='unovcitev' THEN dbg.znesek::numeric ELSE 0 END),0) AS unovcitev
        FROM darilni_bon_gibi dbg
        JOIN racuni r ON r.id = dbg.racun_id
        WHERE r.ustvarjeno >= ${odDate.toISOString()}::timestamptz
          AND r.ustvarjeno < ${doDate.toISOString()}::timestamptz
          AND r.enota_id = ${posReq.enotaId}
          AND r.status != 'storniran' AND r.je_storno IS NOT TRUE
          AND r.stevilka_racuna LIKE ${blagajnaPrefix} ESCAPE '!'
      `);
      type DbonRow = { izdaja: string; unovcitev: string };
      const dbon = dbonRes.rows[0] as DbonRow;

      // ── SŠP subvencija ─────────────────────────────────────────────────────
      const sspRes = await tx.execute(sql`
        SELECT COALESCE(SUM(znesek_subvencija::numeric),0) AS skupaj
        FROM racuni
        WHERE ustvarjeno >= ${odDate.toISOString()}::timestamptz
          AND ustvarjeno < ${doDate.toISOString()}::timestamptz
          AND enota_id = ${posReq.enotaId}
          AND status != 'storniran' AND je_storno IS NOT TRUE
          ${blagajnaFilter}
      `);
      type SspRow = { skupaj: string };
      const ssp = sspRes.rows[0] as SspRow;

      // ── FURS statistika ────────────────────────────────────────────────────
      const fursRes = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE eor IS NOT NULL AND status = 'poslan')   AS potrjeni,
          COUNT(*) FILTER (WHERE eor IS NULL OR status = 'napaka')        AS nepotrjeni
        FROM racuni
        WHERE ustvarjeno >= ${odDate.toISOString()}::timestamptz
          AND ustvarjeno < ${doDate.toISOString()}::timestamptz
          AND enota_id = ${posReq.enotaId}
          AND status != 'storniran' AND je_storno IS NOT TRUE
          ${blagajnaFilter}
      `);
      type FursRow = { potrjeni: string; nepotrjeni: string };
      const furs = fursRes.rows[0] as FursRow;

      // ── Grand Total ────────────────────────────────────────────────────────
      const [blagajnaGT] = await tx.select({ grandTotal: blagajneTable.grandTotal })
        .from(blagajneTable).where(eq(blagajneTable.id, rawBlagajnaId)).limit(1);
      const grandTotalPrej = Number(blagajnaGT?.grandTotal ?? 0);
      const prometDneva = Number(skupni?.skupaj ?? 0);
      const grandTotalNov = Math.round((grandTotalPrej + prometDneva) * 100) / 100;

      // ── Z-številka ─────────────────────────────────────────────────────────
      const [maxZ] = await tx.select({ m: max(zPorocilaTable.zStevilka) })
        .from(zPorocilaTable).where(eq(zPorocilaTable.blagajnaId, rawBlagajnaId));
      // Globalno MAX per blagajna + 1 (velja za nov in ponovni zaključek)
      const novaStevilka = Number(maxZ?.m ?? 0) + 1;

      const snapshot = {
        companyId: posReq.companyId,
        enotaId: posReq.enotaId,
        blagajnaId: rawBlagajnaId,
        poslovniDatum,
        zStevilka: novaStevilka,
        zakljucilUporabnik: posReq.clerkUserId,
        grandTotalPrej: grandTotalPrej.toFixed(2),
        grandTotalNov: grandTotalNov.toFixed(2),
        prometDneva: prometDneva.toFixed(2),
        skupajPromet: prometDneva.toFixed(2),
        skupajDdv: Number(skupni?.ddv ?? 0).toFixed(2),
        steviloRacunov: Number(skupni?.stevilo ?? 0),
        odZap: zap.od_zap ?? null,
        doZap: zap.do_zap ?? null,
        gotovina: Number(pl?.gotovina ?? 0).toFixed(2),
        kartica: Number(pl?.kartica ?? 0).toFixed(2),
        znesekNapitnina: Number(skupni?.napitnina ?? 0).toFixed(2),
        tipBreakdown,
        sumup: Number(pl?.sumup ?? 0).toFixed(2),
        bon: Number(pl?.bon ?? 0).toFixed(2),
        bonPica: Number(pl?.bon_pica ?? 0).toFixed(2),
        steviloBonov: Number(pl?.stevilo_bonov ?? 0),
        negotovinsko: Number(pl?.negotovinsko ?? 0).toFixed(2),
        reprezentanca: Number(fv?.repr ?? 0).toFixed(2),
        lastnaPoraba: Number(fv?.lastna ?? 0).toFixed(2),
        ddvPoStopnjah,
        menjalniDenar: balInput.menjalniDenar.toFixed(2),
        gotovinskaProdaja: balInput.gotovinskaProdaja.toFixed(2),
        pologiGotovine: balInput.pologiGotovine.toFixed(2),
        izplacilaJobaviteljem: balInput.izplacilaDobaviteljem.toFixed(2),
        pologiTrr: balInput.pologiTrr.toFixed(2),
        stanjeBlagajne: stanje.toFixed(2),
        darilniBoniIzdaja: Number(dbon?.izdaja ?? 0).toFixed(2),
        darilniBoniUnovcitev: Number(dbon?.unovcitev ?? 0).toFixed(2),
        sspSubvencija: Number(ssp?.skupaj ?? 0).toFixed(2),
        fursPotrjeni: Number(furs?.potrjeni ?? 0),
        fursNepotrjeni: Number(furs?.nepotrjeni ?? 0),
        odklenjenOb: null as Date | null,
        odklenilUporabnik: null as string | null,
      };

      let zId: number;
      if (jePonovniZakljucek && obstojeciZ) {
        // Posodobi obstoječi Z (ponovni zaključek po odklepu)
        const [updated] = await tx.update(zPorocilaTable)
          .set({ ...snapshot, zakljucenOb: new Date() })
          .where(eq(zPorocilaTable.id, obstojeciZ.id))
          .returning({ id: zPorocilaTable.id });
        zId = updated!.id;

        // Zapiši GT po ponovnem zaključku v odklep zapis
        await tx.update(zPorociloOdklePiTable)
          .set({ gtPoPonovnem: grandTotalNov.toFixed(2) })
          .where(and(
            eq(zPorociloOdklePiTable.zPorociloId, obstojeciZ.id),
            isNull(zPorociloOdklePiTable.gtPoPonovnem),
          ));
      } else {
        // Nov Z zapis
        const [inserted] = await tx.insert(zPorocilaTable).values(snapshot).returning({ id: zPorocilaTable.id });
        zId = inserted!.id;
      }

      // Posodobi GT na blagajni
      await tx.update(blagajneTable)
        .set({ grandTotal: grandTotalNov.toFixed(2) })
        .where(eq(blagajneTable.id, rawBlagajnaId));

      return { zId, novaStevilka, grandTotalPrej, grandTotalNov, snapshot };
    });

    const [z] = await db.select().from(zPorocilaTable).where(eq(zPorocilaTable.id, result.zId)).limit(1);
    res.status(201).json({ ...z, znesekNapitnina: Number(z?.znesekNapitnina ?? 0), jePonovniZakljucek: false });
  } catch (err: unknown) {
    const e = err as { status?: number; message?: string; code?: string; blockers?: ZCloseBlocker[] };
    if (e?.status === 409) {
      res.status(409).json({
        error: e.message,
        ...(e.code ? { code: e.code } : {}),
        ...(e.blockers ? { blockers: e.blockers } : {}),
      });
      return;
    }
    throw err;
  }
});

// ── POST /z-porocilo/:id/odkleni ──────────────────────────────────────────────
router.post("/z-porocilo/:id/odkleni", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  if (!isManager(posReq.vloga)) {
    res.status(403).json({ error: "Odklep zahteva vodjo ali administratorja." }); return;
  }

  const zId = parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isInteger(zId) || zId < 1) { res.status(400).json({ error: "Neveljaven ID." }); return; }

  const body = req.body as Record<string, unknown>;
  const razlog = typeof body.razlog === "string" ? body.razlog.trim() : "";
  if (!razlog) { res.status(400).json({ error: "Razlog odklepa je obvezen." }); return; }

  const result = await db.transaction(async (tx) => {
    const [z] = await tx.select().from(zPorocilaTable)
      .where(and(eq(zPorocilaTable.id, zId), eq(zPorocilaTable.enotaId, posReq.enotaId)))
      .limit(1)
      .for("update");
    if (!z) return { outcome: "not_found" as const };
    if (z.odklenjenOb !== null) return { outcome: "already_unlocked" as const };

    const gtPrej = Number(z.grandTotalNov);
    const prometDneva = Number(z.prometDneva);

    // Zapiši odklep v revizijsko sled
    await tx.insert(zPorociloOdklePiTable).values({
      zPorociloId: zId,
      odklenilUporabnik: posReq.clerkUserId,
      razlog,
      gtPrej: gtPrej.toFixed(2),
    });
    await writePosActorAudit(query => tx.execute(query), {
      enotaId: posReq.enotaId,
      natakarId: posReq.posActorNatakarId ?? null,
      actorClerkUserId: posReq.clerkUserId,
      action: "z_report_unlocked",
      metadata: { zPorociloId: zId },
    });

    // Označi Z kot odklenjen
    await tx.update(zPorocilaTable)
      .set({ odklenjenOb: new Date(), odklenilUporabnik: posReq.clerkUserId })
      .where(eq(zPorocilaTable.id, zId));

    // Obrni GT (odštej promet tega dne, da bo ponovni zaključek točen)
    const novGT = Math.round((gtPrej - prometDneva) * 100) / 100;
    await tx.update(blagajneTable)
      .set({ grandTotal: Math.max(0, novGT).toFixed(2) })
      .where(eq(blagajneTable.id, z.blagajnaId));

    return { outcome: "unlocked" as const };
  });
  if (result.outcome === "not_found") {
    res.status(404).json({ error: "Z-poročilo ni najdeno." }); return;
  }
  if (result.outcome === "already_unlocked") {
    res.status(409).json({ error: "Z-poročilo je že odklenjeno." }); return;
  }

  const [updated] = await db.select().from(zPorocilaTable).where(eq(zPorocilaTable.id, zId)).limit(1);
  res.json({ ...updated, odklenjen: true });
});

export default router;
