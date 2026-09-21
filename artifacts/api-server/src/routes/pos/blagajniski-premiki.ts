import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, gte, inArray, isNull, lt, lte, ne, notInArray, sql, sum } from "drizzle-orm";
import Decimal from "decimal.js";
import { getBusinessDayBounds, getCurrentPosBusinessDate } from "../../lib/pos-business-day";
import {
  accountsTable,
  accountingPeriodsTable,
  blagajneTable,
  blagajniskeNastavitveTable,
  blagajniskiPremikiTable,
  companiesTable,
  counterpartiesTable,
  db,
  enoteTable,
  invoicesTable,
  journalEntriesTable,
  journalEntryLinesTable,
  posBookingSettingsTable,
  posUporabnikiTable,
  racuniTable,
} from "@workspace/db";
import type { PosRequest } from "../../middlewares/pos";
import {
  calculateTheoreticalCashBalance,
  cashMovementLines,
  reverseCashMovementLines,
  type CashMovementType,
} from "../../lib/cashMovementAccounting";

const router: IRouter = Router();
const LIMIT_GOTOVINSKEGA_PLACILA = new Decimal(420);
type AccountForPosting = {
  id: string;
  isActive: boolean;
  allowsPosting: boolean;
  requiresPartner: boolean;
  requiresCostCenter: boolean;
  code: string;
};

function isManager(vloga: string): boolean {
  return ["admin", "admin_enote", "superadmin"].includes(vloga);
}

function parseDate(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

async function getPoslovniDanMeje(enotaId: number, datum: string): Promise<{ odUtc: Date; doUtc: Date }> {
  const bounds = await getBusinessDayBounds(enotaId, datum);
  return { odUtc: bounds.start, doUtc: bounds.end };
}

function parseAmount(value: unknown): Decimal | null {
  try {
    const amount = new Decimal(String(value));
    return amount.isFinite() && amount.gt(0) && amount.decimalPlaces() <= 2 ? amount : null;
  } catch {
    return null;
  }
}

function isMovementType(value: unknown): value is Exclude<CashMovementType, "STORNO"> {
  return value === "IZPLACILO_DOBAVITELJU"
    || value === "POLOG_GOTOVINE"
    || value === "DVIG_GOTOVINE"
    || value === "POLOG_TRR"
    || value === "PRILIV_TRR";
}

async function resolveBlagajna(
  req: PosRequest,
  rawBlagajnaId: unknown,
  res: Response,
): Promise<{ id: number; enotaId: number } | null> {
  const blagajnaId = Number(rawBlagajnaId);
  if (!Number.isInteger(blagajnaId) || blagajnaId < 1) {
    res.status(400).json({ error: "Izberite blagajno." });
    return null;
  }

  const [blagajna] = await db
    .select({ id: blagajneTable.id, enotaId: blagajneTable.enotaId })
    .from(blagajneTable)
    .where(and(eq(blagajneTable.id, blagajnaId), eq(blagajneTable.enotaId, req.enotaId)))
    .limit(1);
  if (!blagajna) {
    res.status(403).json({ error: "Blagajna ne pripada izbrani poslovni enoti." });
    return null;
  }

  if (req.vloga === "uporabnik") {
    const [user] = await db
      .select({ blagajnaId: posUporabnikiTable.blagajnaId })
      .from(posUporabnikiTable)
      .where(and(
        eq(posUporabnikiTable.clerkUserId, req.clerkUserId),
        eq(posUporabnikiTable.companyId, req.companyId),
        eq(posUporabnikiTable.aktiven, true),
      ))
      .limit(1);
    if (user?.blagajnaId !== blagajnaId) {
      res.status(403).json({ error: "Blagajnik lahko uporablja samo svojo dodeljeno blagajno." });
      return null;
    }
  }
  return blagajna;
}

async function assertPartnerAndInvoice(
  companyId: string,
  partnerId: string | null,
  prejetiRacunId: string | null,
  res: Response,
): Promise<{ partnerId: string | null; prejetiRacunId: string | null } | null> {
  if (partnerId) {
    const [partner] = await db
      .select({ id: counterpartiesTable.id })
      .from(counterpartiesTable)
      .where(and(eq(counterpartiesTable.id, partnerId), eq(counterpartiesTable.companyId, companyId)))
      .limit(1);
    if (!partner) {
      res.status(400).json({ error: "Dobavitelj ne pripada temu podjetju." });
      return null;
    }
  }
  if (prejetiRacunId) {
    const [invoice] = await db
      .select({ id: invoicesTable.id, counterpartyId: invoicesTable.counterpartyId, type: invoicesTable.type })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, prejetiRacunId), eq(invoicesTable.companyId, companyId)))
      .limit(1);
    if (!invoice || invoice.type !== "received") {
      res.status(400).json({ error: "Izbrani račun ni prejeti račun tega podjetja." });
      return null;
    }
    if (partnerId && invoice.counterpartyId !== partnerId) {
      res.status(400).json({ error: "Dobavitelj in prejeti račun se ne ujemata." });
      return null;
    }
    return { partnerId: partnerId ?? invoice.counterpartyId, prejetiRacunId };
  }
  return { partnerId, prejetiRacunId };
}

async function getBalance(
  companyId: string,
  enotaId: number,
  blagajnaId: number,
  datum: string,
) {
  const [floatSettings] = await db
    .select({ menjalniDenar: blagajniskeNastavitveTable.menjalniDenar })
    .from(blagajniskeNastavitveTable)
    .where(and(
      eq(blagajniskeNastavitveTable.companyId, companyId),
      eq(blagajniskeNastavitveTable.enotaId, enotaId),
      eq(blagajniskeNastavitveTable.blagajnaId, blagajnaId),
    ))
    .limit(1);

  const [blagajna] = await db.select({ ppId: blagajneTable.ppId, bId: blagajneTable.bId })
    .from(blagajneTable).where(eq(blagajneTable.id, blagajnaId)).limit(1);
  const prefix = blagajna ? `${blagajna.ppId}-${blagajna.bId}-` : "";
  const meje = await getPoslovniDanMeje(enotaId, datum);
  const cashSalesResult = await db.execute(sql`
    SELECT COALESCE(SUM(
      CASE
        WHEN znesek_gotovina IS NOT NULL OR znesek_kartica IS NOT NULL
          OR znesek_bon IS NOT NULL OR znesek_bon_pica IS NOT NULL
          OR znesek_negotovinsko IS NOT NULL
        THEN COALESCE(znesek_gotovina::numeric, 0)
        WHEN placilna_nacin = 'gotovina' THEN skupaj::numeric
        ELSE 0
      END
    ), 0) AS znesek
    FROM racuni
    WHERE enota_id = ${enotaId}
      AND stevilka_racuna LIKE ${`${prefix}%`}
      AND status != 'storniran'
      AND je_storno IS NOT TRUE
      AND ustvarjeno >= ${meje.odUtc.toISOString()}::timestamptz
      AND ustvarjeno < ${meje.doUtc.toISOString()}::timestamptz
  `);
  const cashSales = cashSalesResult.rows[0] as { znesek?: string } | undefined;

  const movementRows = await db
    .select({ tip: blagajniskiPremikiTable.tip, znesek: sum(blagajniskiPremikiTable.znesek) })
    .from(blagajniskiPremikiTable)
    .where(and(
      eq(blagajniskiPremikiTable.companyId, companyId),
      eq(blagajniskiPremikiTable.enotaId, enotaId),
      eq(blagajniskiPremikiTable.blagajnaId, blagajnaId),
      gte(blagajniskiPremikiTable.datumCas, meje.odUtc),
      lt(blagajniskiPremikiTable.datumCas, meje.doUtc),
      eq(blagajniskiPremikiTable.status, "POTRJEN"),
      ne(blagajniskiPremikiTable.tip, "STORNO"),
    ))
    .groupBy(blagajniskiPremikiTable.tip);
  const amountByType = new Map(movementRows.map((row) => [row.tip, Number(row.znesek ?? 0)]));
  const input = {
    menjalniDenar: Number(floatSettings?.menjalniDenar ?? 50),
    gotovinskaProdaja: Number(cashSales?.znesek ?? 0),
    pologiGotovine: amountByType.get("POLOG_GOTOVINE") ?? 0,
    izplacilaDobaviteljem: amountByType.get("IZPLACILO_DOBAVITELJU") ?? 0,
    // Dvig z banke in bančni priliv sta stopnji na 110/109; fizično
    // gotovino spremeni šele ločen prejem v blagajno oziroma polog iz nje.
    dvigiGotovine: 0,
    pologiTrr: amountByType.get("POLOG_TRR") ?? 0,
  };
  return { ...input, stanje: calculateTheoreticalCashBalance(input) };
}

async function createPostedEntry(
  // Drizzle transakcija ima enak query vmesnik kot db, brez `$client`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  movement: {
    id: string; companyId: string; enotaId: number; poslovniDatum: string; tip: Exclude<CashMovementType, "STORNO">;
    znesek: string; opis: string; partnerId: string | null; createdBy: string; confirmedBy: string;
  },
  reversalOf?: string | null,
): Promise<string> {
  const [settings] = await tx.select().from(posBookingSettingsTable)
    .where(eq(posBookingSettingsTable.companyId, movement.companyId)).limit(1);
  const needsBankAccount = movement.tip === "DVIG_GOTOVINE" || movement.tip === "PRILIV_TRR";
  if (!settings?.cashAccountId || !settings.payablesAccountId || !settings.cashInTransitAccountId || (needsBankAccount && !settings.bankAccountId)) {
    throw new Error("Za blagajniške premike nastavite konto blagajne (100), dobaviteljev (220) in Denar na poti (109).");
  }
  const [period] = await tx.select({ id: accountingPeriodsTable.id, status: accountingPeriodsTable.status })
    .from(accountingPeriodsTable)
    .where(and(
      eq(accountingPeriodsTable.companyId, movement.companyId),
      lte(accountingPeriodsTable.startDate, movement.poslovniDatum),
      gte(accountingPeriodsTable.endDate, movement.poslovniDatum),
      notInArray(accountingPeriodsTable.status, ["locked"]),
    ))
    .limit(1);
  if (!period) throw new Error("Za datum premika ni odprtega računovodskega obdobja.");

  const [enota] = await tx.select({ costCenterId: enoteTable.costCenterId })
    .from(enoteTable).where(eq(enoteTable.id, movement.enotaId)).limit(1);
  const basicLines = cashMovementLines(movement.tip, {
    cashAccountId: settings.cashAccountId,
    payablesAccountId: settings.payablesAccountId,
    cashInTransitAccountId: settings.cashInTransitAccountId,
    bankAccountId: settings.bankAccountId!,
  }, movement.partnerId);
  const lines = reversalOf ? reverseCashMovementLines(basicLines) : basicLines;
  const accountIds = [...new Set([
    ...lines.map((line) => line.accountId),
    settings.cashAccountId,
    settings.payablesAccountId,
    settings.cashInTransitAccountId,
    ...(settings.bankAccountId ? [settings.bankAccountId] : []),
  ])];
  const accounts: AccountForPosting[] = await tx.select({
    id: accountsTable.id,
    isActive: accountsTable.isActive,
    allowsPosting: accountsTable.allowsPosting,
    requiresPartner: accountsTable.requiresPartner,
    requiresCostCenter: accountsTable.requiresCostCenter,
    code: accountsTable.code,
  }).from(accountsTable).where(and(inArray(accountsTable.id, accountIds), eq(accountsTable.companyId, movement.companyId)));
  if (accounts.length !== accountIds.length || accounts.some((account) => !account.isActive || !account.allowsPosting)) {
    throw new Error("Nastavljeni konti niso aktivni proknjižljivi konti tega podjetja.");
  }
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  if (!accountById.get(settings.cashInTransitAccountId)?.code.startsWith("109")
    || (settings.bankAccountId && (!accountById.get(settings.bankAccountId)?.code.startsWith("110") || accountById.get(settings.bankAccountId)?.code.startsWith("109")))
    || settings.cashInTransitAccountId === settings.bankAccountId) {
    throw new Error("Nastavitvi morata določati ločena konta: Denar na poti 109… in TRR 110…, ki ni 109.");
  }
  for (const line of lines) {
    const account = accountById.get(line.accountId)!;
    if (account.requiresPartner && !line.partnerId) throw new Error("Za konto obveznosti je obvezen dobavitelj.");
    if (account.requiresCostCenter && !enota?.costCenterId) throw new Error("Enota nima nastavljenega stroškovnega mesta.");
  }
  const [entry] = await tx.insert(journalEntriesTable).values({
    companyId: movement.companyId,
    periodId: period.id,
    documentDate: movement.poslovniDatum,
    entryDate: movement.poslovniDatum,
    description: movement.opis,
    reference: `POS:BLAGAJNA:${movement.id}`,
    status: "posted",
    postedAt: new Date(),
    reversalOf: reversalOf ?? null,
    sourceType: "document",
    createdBy: movement.createdBy,
    approvedBy: movement.confirmedBy,
  }).returning({ id: journalEntriesTable.id });
  await tx.insert(journalEntryLinesTable).values(lines.map((line, index) => ({
    entryId: entry.id,
    accountId: line.accountId,
    side: line.side,
    amount: new Decimal(movement.znesek).toFixed(2),
    description: movement.opis,
    sequence: index,
    partnerId: line.partnerId ?? null,
    costCenterId: enota?.costCenterId ?? null,
    vatAmount: "0.00",
    vatDeductionPercent: "0.00",
  })));
  return entry.id;
}

router.get("/blagajniski-premiki", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const datum = parseDate(req.query.datum) ?? await getCurrentPosBusinessDate(posReq.enotaId);
  const blagajna = await resolveBlagajna(posReq, req.query.blagajnaId, res);
  if (!blagajna) return;
  const meje = await getPoslovniDanMeje(posReq.enotaId, datum);
  const rows = await db.select({
    id: blagajniskiPremikiTable.id,
    poslovniDatum: blagajniskiPremikiTable.poslovniDatum,
    datumCas: blagajniskiPremikiTable.datumCas,
    tip: blagajniskiPremikiTable.tip,
    status: blagajniskiPremikiTable.status,
    znesek: blagajniskiPremikiTable.znesek,
    opis: blagajniskiPremikiTable.opis,
    opomba: blagajniskiPremikiTable.opomba,
    scenarijPologa: blagajniskiPremikiTable.scenarijPologa,
    razlogIzjeme420: blagajniskiPremikiTable.razlogIzjeme420,
    partnerId: blagajniskiPremikiTable.partnerId,
    partnerNaziv: counterpartiesTable.name,
    prejetiRacunId: blagajniskiPremikiTable.prejetiRacunId,
    confirmedBy: blagajniskiPremikiTable.confirmedBy,
    confirmedAt: blagajniskiPremikiTable.confirmedAt,
    createdBy: blagajniskiPremikiTable.createdBy,
    stornoOdId: blagajniskiPremikiTable.stornoOdId,
    journalEntryId: blagajniskiPremikiTable.journalEntryId,
  }).from(blagajniskiPremikiTable)
    .leftJoin(counterpartiesTable, eq(counterpartiesTable.id, blagajniskiPremikiTable.partnerId))
    .where(and(
      eq(blagajniskiPremikiTable.companyId, posReq.companyId),
      eq(blagajniskiPremikiTable.enotaId, posReq.enotaId),
      eq(blagajniskiPremikiTable.blagajnaId, blagajna.id),
      gte(blagajniskiPremikiTable.datumCas, meje.odUtc),
      lt(blagajniskiPremikiTable.datumCas, meje.doUtc),
    ))
    .orderBy(desc(blagajniskiPremikiTable.datumCas));
  res.setHeader("Cache-Control", "no-store");
  res.json({ premiki: rows.map((row) => ({ ...row, znesek: Number(row.znesek) })) });
});

router.get("/blagajniski-premiki/stanje", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const datum = parseDate(req.query.datum) ?? await getCurrentPosBusinessDate(posReq.enotaId);
  const blagajna = await resolveBlagajna(posReq, req.query.blagajnaId, res);
  if (!blagajna) return;
  res.setHeader("Cache-Control", "no-store");
  res.json(await getBalance(posReq.companyId, posReq.enotaId, blagajna.id, datum));
});

router.get("/blagajniski-premiki/nastavitve", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const blagajna = await resolveBlagajna(posReq, req.query.blagajnaId, res);
  if (!blagajna) return;
  const [settings] = await db.select({ menjalniDenar: blagajniskeNastavitveTable.menjalniDenar })
    .from(blagajniskeNastavitveTable)
    .where(and(eq(blagajniskeNastavitveTable.companyId, posReq.companyId), eq(blagajniskeNastavitveTable.enotaId, posReq.enotaId), eq(blagajniskeNastavitveTable.blagajnaId, blagajna.id)))
    .limit(1);
  res.json({ menjalniDenar: Number(settings?.menjalniDenar ?? 50) });
});

router.put("/blagajniski-premiki/nastavitve", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  if (!isManager(posReq.vloga)) {
    res.status(403).json({ error: "Menjalni denar lahko nastavi vodja ali administrator." });
    return;
  }
  const blagajna = await resolveBlagajna(posReq, req.body?.blagajnaId, res);
  if (!blagajna) return;
  const amount = parseAmount(req.body?.menjalniDenar);
  if (!amount || amount.gt(10_000)) {
    res.status(400).json({ error: "Menjalni denar mora biti med 0,01 in 10.000 EUR." });
    return;
  }
  const [saved] = await db.insert(blagajniskeNastavitveTable).values({
    companyId: posReq.companyId, enotaId: posReq.enotaId, blagajnaId: blagajna.id,
    menjalniDenar: amount.toFixed(2), updatedBy: posReq.clerkUserId,
  }).onConflictDoUpdate({
    target: [blagajniskeNastavitveTable.companyId, blagajniskeNastavitveTable.enotaId, blagajniskeNastavitveTable.blagajnaId],
    set: { menjalniDenar: amount.toFixed(2), updatedBy: posReq.clerkUserId, updatedAt: new Date() },
  }).returning();
  res.json({ menjalniDenar: Number(saved.menjalniDenar) });
});

router.post("/blagajniski-premiki", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const body = req.body as Record<string, unknown>;
  if (!isMovementType(body.tip)) {
    res.status(400).json({ error: "Neveljaven tip blagajniškega premika." });
    return;
  }
  const blagajna = await resolveBlagajna(posReq, body.blagajnaId, res);
  if (!blagajna) return;
  const amount = parseAmount(body.znesek);
  const opis = typeof body.opis === "string" ? body.opis.trim() : "";
  const datum = parseDate(body.poslovniDatum) ?? await getCurrentPosBusinessDate(posReq.enotaId);
  const partnerId = typeof body.partnerId === "string" && body.partnerId ? body.partnerId : null;
  const prejetiRacunId = typeof body.prejetiRacunId === "string" && body.prejetiRacunId ? body.prejetiRacunId : null;
  const scenarijPologa = body.scenarijPologa === "A" || body.scenarijPologa === "B" ? body.scenarijPologa : null;
  const razlogIzjeme420 = typeof body.razlogIzjeme420 === "string" && body.razlogIzjeme420.trim()
    ? body.razlogIzjeme420.trim() : null;
  if (!amount || !opis) {
    res.status(400).json({ error: "Vnesite veljaven pozitiven znesek in razlog premika." });
    return;
  }
  if (body.tip === "IZPLACILO_DOBAVITELJU" && !partnerId && !prejetiRacunId) {
    res.status(400).json({ error: "Za izplačilo dobavitelju izberite dobavitelja ali prejeti račun." });
    return;
  }
  if (body.tip === "POLOG_TRR" && !scenarijPologa) {
    res.status(400).json({ error: "Pri pologu na TRR izberite scenarij A ali B." });
    return;
  }
  const relations = await assertPartnerAndInvoice(posReq.companyId, partnerId, prejetiRacunId, res);
  if (!relations) return;

  // ── Z-zaklep: prepreči premik na zaklenjen dan ────────────────────────────
  {
    const { checkZDnevniZaklep } = await import("../../lib/pos-z-helpers");
    const zLocked = await checkZDnevniZaklep(posReq.enotaId, blagajna.id, datum);
    if (zLocked) {
      res.status(409).json({
        code: "Z_ZAKLEP",
        error: `Blagajna za dan ${datum} je zaklenjena z Z-poročilom. Odklenite jo za vnos premikov.`,
      });
      return;
    }
  }

  const [movement] = await db.insert(blagajniskiPremikiTable).values({
    companyId: posReq.companyId,
    enotaId: posReq.enotaId,
    blagajnaId: blagajna.id,
    poslovniDatum: datum,
    tip: body.tip,
    znesek: amount.toFixed(2),
    opis,
    opomba: typeof body.opomba === "string" ? body.opomba.trim() || null : null,
    partnerId: relations.partnerId,
    prejetiRacunId: relations.prejetiRacunId,
    scenarijPologa,
    razlogIzjeme420,
    createdBy: posReq.clerkUserId,
  }).returning();
  res.status(201).json({ ...movement, znesek: Number(movement.znesek) });
});

router.post("/blagajniski-premiki/:id/potrdi", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  if (!isManager(posReq.vloga)) {
    res.status(403).json({ error: "Potrditev premika zahteva vodjo ali administratorja." });
    return;
  }
  const id = String(req.params.id);
  try {
    const confirmed = await db.transaction(async (tx) => {
      const [scope] = await tx.select({
        companyId: blagajniskiPremikiTable.companyId, enotaId: blagajniskiPremikiTable.enotaId,
        blagajnaId: blagajniskiPremikiTable.blagajnaId, poslovniDatum: blagajniskiPremikiTable.poslovniDatum,
      }).from(blagajniskiPremikiTable)
        .where(and(eq(blagajniskiPremikiTable.id, id), eq(blagajniskiPremikiTable.companyId, posReq.companyId), eq(blagajniskiPremikiTable.enotaId, posReq.enotaId))).limit(1);
      if (!scope) throw new Error("Premik ni najden.");
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cash-register:${scope.companyId}:${scope.enotaId}:${scope.blagajnaId}:${scope.poslovniDatum}`}))`);
      const [movement] = await tx.select().from(blagajniskiPremikiTable)
        .where(and(eq(blagajniskiPremikiTable.id, id), eq(blagajniskiPremikiTable.companyId, posReq.companyId), eq(blagajniskiPremikiTable.enotaId, posReq.enotaId)))
        .limit(1);
      if (!movement || movement.status !== "OSNUTEK") throw new Error("Premik ni najden ali ni več osnutek.");
      if (movement.createdBy === posReq.clerkUserId) throw new Error("Dvojna kontrola zahteva, da premika ne potrdi njegov pripravljavec.");
      const locked = await tx.update(blagajniskiPremikiTable)
        .set({ confirmedBy: posReq.clerkUserId, confirmedAt: new Date() })
        .where(and(eq(blagajniskiPremikiTable.id, id), eq(blagajniskiPremikiTable.status, "OSNUTEK"), isNull(blagajniskiPremikiTable.confirmedBy)))
        .returning({ id: blagajniskiPremikiTable.id });
      if (locked.length !== 1) throw new Error("Premik je medtem že v potrjevanju ali potrjen.");

      let sourceTip: Exclude<CashMovementType, "STORNO"> = movement.tip as Exclude<CashMovementType, "STORNO">;
      let reversalOf: string | null = null;
      if (movement.tip === "STORNO") {
        const [original] = await tx.select().from(blagajniskiPremikiTable)
          .where(eq(blagajniskiPremikiTable.id, movement.stornoOdId!)).limit(1);
        if (!original || original.status !== "POTRJEN" || !original.journalEntryId || original.tip === "STORNO") {
          throw new Error("Izvirnega potrjenega premika za storno ni mogoče najti.");
        }
        sourceTip = original.tip as Exclude<CashMovementType, "STORNO">;
        reversalOf = original.journalEntryId;
      }

      if (movement.tip !== "STORNO" && sourceTip === "IZPLACILO_DOBAVITELJU") {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`cash-supplier:${movement.companyId}:${movement.partnerId}:${movement.poslovniDatum}`}))`);
        const amount = new Decimal(movement.znesek);
        const [dayTotals] = await tx.select({ total: sum(blagajniskiPremikiTable.znesek) })
          .from(blagajniskiPremikiTable)
          .where(and(
            eq(blagajniskiPremikiTable.companyId, posReq.companyId),
            eq(blagajniskiPremikiTable.partnerId, movement.partnerId!),
            eq(blagajniskiPremikiTable.poslovniDatum, movement.poslovniDatum),
            eq(blagajniskiPremikiTable.tip, "IZPLACILO_DOBAVITELJU"),
            eq(blagajniskiPremikiTable.status, "POTRJEN"),
          ));
        const cumulative = new Decimal(dayTotals?.total ?? 0).plus(amount);
        if ((amount.gt(LIMIT_GOTOVINSKEGA_PLACILA) || cumulative.gt(LIMIT_GOTOVINSKEGA_PLACILA)) && !movement.razlogIzjeme420) {
          throw new Error(`Gotovinsko plačilo presega 420,00 EUR (posamezno oziroma skupaj ${cumulative.toFixed(2)} EUR). Uporabite TRR ali v osnutek vnesite dokumentiran razlog izjeme.`);
        }
      }

      if (movement.tip !== "STORNO" && (sourceTip === "POLOG_TRR" || sourceTip === "IZPLACILO_DOBAVITELJU")) {
        const balance = await getBalance(posReq.companyId, posReq.enotaId, movement.blagajnaId, movement.poslovniDatum);
        const afterCashOut = new Decimal(balance.stanje).minus(movement.znesek);
        const minimum = sourceTip === "POLOG_TRR" && movement.scenarijPologa === "A" ? new Decimal(balance.menjalniDenar) : new Decimal(0);
        if (afterCashOut.lt(minimum)) {
          throw new Error(sourceTip === "POLOG_TRR" && movement.scenarijPologa === "A"
            ? "Scenarij A lahko položi le znesek nad menjalnim denarjem, ki mora ostati v blagajni."
            : "Izplačilo ali odvod presega razpoložljivo teoretično stanje blagajne.");
        }
      }

      const entryId = await createPostedEntry(tx, {
        id: movement.id, companyId: movement.companyId, enotaId: movement.enotaId,
        poslovniDatum: movement.poslovniDatum, tip: sourceTip,
        znesek: movement.znesek, opis: movement.opis, partnerId: movement.partnerId,
        createdBy: movement.createdBy, confirmedBy: posReq.clerkUserId,
      }, reversalOf);
      const [saved] = await tx.update(blagajniskiPremikiTable).set({
        status: "POTRJEN", journalEntryId: entryId, confirmedBy: posReq.clerkUserId, confirmedAt: new Date(),
      }).where(eq(blagajniskiPremikiTable.id, movement.id)).returning();
      if (movement.tip === "STORNO") {
        await tx.update(blagajniskiPremikiTable).set({ status: "STORNIRAN" })
          .where(and(eq(blagajniskiPremikiTable.id, movement.stornoOdId!), eq(blagajniskiPremikiTable.status, "POTRJEN")));
      }
      return saved;
    });
    res.json({ ...confirmed, znesek: Number(confirmed.znesek) });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Potrditev premika ni uspela." });
  }
});

router.post("/blagajniski-premiki/:id/storno", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  if (!isManager(posReq.vloga)) {
    res.status(403).json({ error: "Storno premika zahteva vodjo ali administratorja." });
    return;
  }
  const opisStorna = typeof req.body?.opis === "string" ? req.body.opis.trim() : "";
  if (!opisStorna) {
    res.status(400).json({ error: "Za storno navedite razlog." });
    return;
  }
  try {
    const storno = await db.transaction(async (tx) => {
      const [original] = await tx.select().from(blagajniskiPremikiTable)
        .where(and(eq(blagajniskiPremikiTable.id, String(req.params.id)), eq(blagajniskiPremikiTable.companyId, posReq.companyId), eq(blagajniskiPremikiTable.enotaId, posReq.enotaId)))
        .limit(1);
      if (!original || original.status !== "POTRJEN" || !original.journalEntryId) throw new Error("Potrjen premik za storno ni najden.");
      const [created] = await tx.insert(blagajniskiPremikiTable).values({
        companyId: original.companyId, enotaId: original.enotaId, blagajnaId: original.blagajnaId,
        poslovniDatum: original.poslovniDatum, tip: "STORNO", status: "OSNUTEK",
        znesek: original.znesek, opis: `Storno: ${opisStorna}`, opomba: original.opomba,
        partnerId: original.partnerId, prejetiRacunId: original.prejetiRacunId,
        scenarijPologa: original.scenarijPologa, stornoOdId: original.id,
        createdBy: posReq.clerkUserId,
      }).returning();
      return created;
    });
    res.status(201).json({ ...storno, znesek: Number(storno.znesek) });
  } catch (error) {
    res.status(422).json({ error: error instanceof Error ? error.message : "Storno ni uspel." });
  }
});

router.get("/blagajniski-premiki/:id/dokument", async (req: Request, res: Response): Promise<void> => {
  const posReq = req as PosRequest;
  const [row] = await db.select({
    id: blagajniskiPremikiTable.id, poslovniDatum: blagajniskiPremikiTable.poslovniDatum,
    datumCas: blagajniskiPremikiTable.datumCas, tip: blagajniskiPremikiTable.tip,
    status: blagajniskiPremikiTable.status, znesek: blagajniskiPremikiTable.znesek,
    opis: blagajniskiPremikiTable.opis, opomba: blagajniskiPremikiTable.opomba,
    createdBy: blagajniskiPremikiTable.createdBy, confirmedBy: blagajniskiPremikiTable.confirmedBy,
    confirmedAt: blagajniskiPremikiTable.confirmedAt, partnerNaziv: counterpartiesTable.name,
    invoiceNumber: invoicesTable.invoiceNumber, companyName: companiesTable.naziv,
  }).from(blagajniskiPremikiTable)
    .innerJoin(companiesTable, eq(companiesTable.id, blagajniskiPremikiTable.companyId))
    .leftJoin(counterpartiesTable, eq(counterpartiesTable.id, blagajniskiPremikiTable.partnerId))
    .leftJoin(invoicesTable, eq(invoicesTable.id, blagajniskiPremikiTable.prejetiRacunId))
    .where(and(eq(blagajniskiPremikiTable.id, String(req.params.id)), eq(blagajniskiPremikiTable.companyId, posReq.companyId), eq(blagajniskiPremikiTable.enotaId, posReq.enotaId)))
    .limit(1);
  if (!row) { res.status(404).json({ error: "Dokument ni najden." }); return; }
  res.json({ ...row, znesek: Number(row.znesek) });
});

export default router;