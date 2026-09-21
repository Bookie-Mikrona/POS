import { Router, type IRouter } from "express";
import { and, eq, gte, inArray, lte, sql, sum } from "drizzle-orm";
import { accountsTable, accountingPeriodsTable, artikliTable, counterpartiesTable, db, embalazniPrometiTable, enoteTable, journalEntriesTable, journalEntryLinesTable, posBookingSettingsTable, zalogaGibiTable, zalogeTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";
import { buildReturnablePackagingBooking } from "../../lib/returnablePackagingBooking";
import { normalizeEmbalazaBilanca } from "../../lib/embalazaBilanca";
import { ListEmbalazaBilanceResponse, ReturnEmbalazaBody, ReturnEmbalazaResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/embalaza/bilance", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const rows = await db.select({
    artikelId: artikliTable.id, artikelIme: artikliTable.ime, vrstaEmbalaze: artikliTable.vrstaEmbalaze,
    dobaviteljId: embalazniPrometiTable.dobaviteljId,
    dobaviteljIme: sql<string | null>`COALESCE(${counterpartiesTable.kratkiNaziv}, ${counterpartiesTable.name})`,
    fizicnaZaloga: sql<string>`COALESCE(${zalogeTable.kolicina}, '0')`,
    kolicina: sum(embalazniPrometiTable.kolicina),
    depozitnaVrednost: artikliTable.depozitnaVrednost,
  }).from(artikliTable).leftJoin(embalazniPrometiTable, and(
      eq(artikliTable.id, embalazniPrometiTable.artikelId),
      eq(embalazniPrometiTable.enotaId, enotaId),
    ))
    .leftJoin(counterpartiesTable, eq(counterpartiesTable.id, embalazniPrometiTable.dobaviteljId))
    .leftJoin(zalogeTable, eq(zalogeTable.artikelId, embalazniPrometiTable.artikelId))
    .where(and(eq(artikliTable.enotaId, enotaId), eq(artikliTable.povratnaEmbalaza, true)))
    .groupBy(artikliTable.id, artikliTable.ime, artikliTable.vrstaEmbalaze, embalazniPrometiTable.dobaviteljId, counterpartiesTable.kratkiNaziv, counterpartiesTable.name, zalogeTable.kolicina, artikliTable.depozitnaVrednost);
  const payload = rows.map(normalizeEmbalazaBilanca);
  res.json(ListEmbalazaBilanceResponse.parse(payload));
});

router.post("/embalaza/vracilo", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const parsed = ReturnEmbalazaBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const artikelId = parsed.data.artikelId, dobaviteljId = parsed.data.dobaviteljId ?? null;
  const quantity = parsed.data.kolicina;
  const operationKey = parsed.data.operationKey;
  if (!Number.isInteger(artikelId) || !Number.isFinite(quantity) || quantity <= 0) {
    res.status(400).json({ error: "Artikel in pozitivna količina sta obvezna" }); return;
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationKey)) {
    res.status(400).json({ error: "Operation key mora biti veljaven UUID" }); return;
  }
  const [article] = await db.select({ id: artikliTable.id, enotaId: artikliTable.enotaId, povratna: artikliTable.povratnaEmbalaza, depozit: artikliTable.depozitnaVrednost })
    .from(artikliTable).where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)));
  if (!article) { res.status(404).json({ error: "Artikel ni najden v tej enoti" }); return; }
  if (!article.povratna) { res.status(400).json({ error: "Artikel ni povratna embalaža" }); return; }
  if (dobaviteljId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(dobaviteljId)) {
    res.status(400).json({ error: "Dobavitelj mora biti veljaven UUID" }); return;
  }
  if (dobaviteljId) {
    const [supplier] = await db.select({ id: counterpartiesTable.id }).from(counterpartiesTable)
      .innerJoin(enoteTable, eq(enoteTable.companyId, counterpartiesTable.companyId))
      .where(and(eq(counterpartiesTable.id, dobaviteljId), eq(enoteTable.id, enotaId), sql`${counterpartiesTable.type} IN ('supplier','both')`));
    if (!supplier) { res.status(403).json({ error: "Dobavitelj ni dostopen tej enoti" }); return; }
  }
  const [unit] = await db.select({ companyId: enoteTable.companyId }).from(enoteTable).where(eq(enoteTable.id, enotaId));
  const [settings] = unit ? await db.select({
    packaging: posBookingSettingsTable.returnablePackagingAccountId,
    payables: posBookingSettingsTable.payablesAccountId,
  }).from(posBookingSettingsTable).where(eq(posBookingSettingsTable.companyId, unit.companyId)).limit(1) : [];
  if (!settings?.packaging) { res.status(400).json({ error: "Konto zaloge povratne embalaže (3107000) ni nastavljen" }); return; }
  if (!settings.payables) { res.status(400).json({ error: "Konto obveznosti do dobaviteljev (220) ni nastavljen" }); return; }
  const accountIds = [settings.packaging, settings.payables];
  const accountRows = await db.select({ id: accountsTable.id, code: accountsTable.code, isActive: accountsTable.isActive, allowsPosting: accountsTable.allowsPosting })
    .from(accountsTable).where(and(eq(accountsTable.companyId, unit!.companyId), inArray(accountsTable.id, accountIds)));
  const packagingAccount = accountRows.find(a => a.id === settings.packaging);
  const payablesAccount = accountRows.find(a => a.id === settings.payables);
  if (!packagingAccount || !packagingAccount.isActive || !packagingAccount.allowsPosting || packagingAccount.code !== "3107000")
    { res.status(400).json({ error: "Konto zaloge povratne embalaže mora biti aktivni, proknjižljivi konto 3107000 podjetja" }); return; }
  if (!payablesAccount || !payablesAccount.isActive || !payablesAccount.allowsPosting || !payablesAccount.code.startsWith("220"))
    { res.status(400).json({ error: "Konto obveznosti mora biti aktiven, proknjižljiv konto 220 podjetja" }); return; }
  if (!dobaviteljId) { res.status(400).json({ error: "Dobavitelj je obvezen za vračilo embalaže" }); return; }
  const result = await db.transaction(async tx => {
    const [existing] = await tx.select({
      id: embalazniPrometiTable.id, artikelId: embalazniPrometiTable.artikelId,
      dobaviteljId: embalazniPrometiTable.dobaviteljId, kolicina: embalazniPrometiTable.kolicina,
      journalEntryId: embalazniPrometiTable.journalEntryId, opomba: embalazniPrometiTable.opomba,
    }).from(embalazniPrometiTable).where(and(eq(embalazniPrometiTable.enotaId, enotaId), eq(embalazniPrometiTable.operationKey, operationKey))).limit(1);
    if (existing) {
      if (existing.artikelId !== artikelId || existing.dobaviteljId !== dobaviteljId || Number(existing.kolicina) !== -quantity
        || (existing.opomba ?? null) !== (parsed.data.opomba ?? null)) {
        throw Object.assign(new Error("Operation key je že uporabljen za drugačen zahtevek"), { status: 409 });
      }
      return { ...existing, reference: `POS:EMBALAZA:VRACILO:${existing.id}` };
    }
    await tx.execute(sql`SELECT id FROM artikli WHERE id = ${artikelId} AND enota_id = ${enotaId} FOR UPDATE`);
    const [balance] = await tx.select({ total: sum(embalazniPrometiTable.kolicina) }).from(embalazniPrometiTable)
      .where(and(eq(embalazniPrometiTable.enotaId, enotaId), eq(embalazniPrometiTable.artikelId, artikelId),
        dobaviteljId == null ? sql`${embalazniPrometiTable.dobaviteljId} IS NULL` : eq(embalazniPrometiTable.dobaviteljId, dobaviteljId)));
    if (Number(balance?.total ?? 0) < quantity) throw Object.assign(new Error("Presežen razpoložljivi saldo embalaže"), { status: 409 });
    const [movement] = await tx.insert(embalazniPrometiTable).values({
      enotaId, artikelId, dobaviteljId, kolicina: String(-quantity), depozitnaVrednost: article.depozit,
      vrsta: "vracilo", opomba: parsed.data.opomba ?? null, actorSnapshot: (req as any).clerkUserId ?? null, operationKey,
    }).returning({ id: embalazniPrometiTable.id });
    const [period] = await tx.select({ id: accountingPeriodsTable.id }).from(accountingPeriodsTable)
      .where(and(eq(accountingPeriodsTable.companyId, unit!.companyId), eq(accountingPeriodsTable.status, "open"),
        lte(accountingPeriodsTable.startDate, new Date().toISOString().slice(0, 10)),
        gte(accountingPeriodsTable.endDate, new Date().toISOString().slice(0, 10)))).limit(1);
    if (!period) throw Object.assign(new Error("Za vračilo embalaže ni odprtega računovodskega obdobja"), { status: 400 });
    const [entry] = await tx.insert(journalEntriesTable).values({
      companyId: unit!.companyId, periodId: period.id, entryDate: new Date().toISOString().slice(0, 10),
      documentDate: new Date().toISOString().slice(0, 10), description: "Vračilo povratne embalaže",
      reference: `POS:EMBALAZA:VRACILO:${movement.id}`, status: "draft", sourceType: "document",
      createdBy: (req as any).clerkUserId ?? "pos",
    }).returning({ id: journalEntriesTable.id });
    const bookingLines = buildReturnablePackagingBooking({
      packagingAccountId: settings.packaging!, payablesAccountId: settings.payables!,
      supplierId: dobaviteljId!, quantity, deposit: Number(article.depozit ?? 0),
    });
    await tx.insert(journalEntryLinesTable).values(bookingLines.map((line, sequence) => ({
      entryId: entry.id, ...line, description: "Vračilo povratne embalaže", sequence,
    })));
    await tx.update(embalazniPrometiTable).set({ journalEntryId: entry.id }).where(eq(embalazniPrometiTable.id, movement.id));
    await tx.insert(zalogaGibiTable).values({
      artikelId, tip: "embalazna_vracilo", kolicina: String(-quantity), cenaKos: article.depozit,
      vrednost: String(-quantity * Number(article.depozit ?? 0)), referencaId: movement.id,
      actorSnapshot: (req as any).clerkUserId ?? null, sourceSnapshot: "embalazni_promet",
    });
    await recomputeZaloge([artikelId], tx);
    return { ...movement, journalEntryId: entry.id, reference: `POS:EMBALAZA:VRACILO:${movement.id}` };
  }).catch(error => { if ((error as any).status) throw error; throw error; });
  res.status(201).json(ReturnEmbalazaResponse.parse({ ...result, kolicina: -quantity }));
});

export default router;