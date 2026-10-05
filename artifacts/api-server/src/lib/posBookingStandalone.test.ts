import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  db, companiesTable, companyModulesTable, accountsTable, accountingPeriodsTable,
  enoteTable, narocilaTable, racuniTable, postavkeTable, posBookingSettingsTable,
  journalEntriesTable, posBookingDraftsTable, posBookingDraftLinesTable, auditLogTable,
} from "@workspace/db";
import { syncPosBookingForDay, syncPosBookingForMonth } from "./posSyncBooking";
import { transferPosDrafts } from "./posDraftTransfer";

const DATE = "2026-09-28";
let companyId = "";

beforeEach(async () => {
  const tag = crypto.randomUUID().slice(0, 8);
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `POS_EXT_${tag}`, naziv: `Standalone POS ${tag}`,
  }).returning({ id: companiesTable.id });
  companyId = company.id;
  await db.insert(companyModulesTable).values({
    companyId, module: "pos", enabledBy: "test", enabledAt: new Date("2026-01-01T00:00:00Z"),
  });
  const [unit] = await db.insert(enoteTable).values({ companyId, ime: "Test POS" }).returning({ id: enoteTable.id });
  const [cash, revenue, vat] = await db.insert(accountsTable).values([
    { companyId, code: "1000", name: "Gotovina", type: "asset" },
    { companyId, code: "7600", name: "Prihodki", type: "revenue" },
    { companyId, code: "2600", name: "DDV", type: "liability" },
  ]).returning({ id: accountsTable.id });
  await db.insert(posBookingSettingsTable).values({
    companyId, cashAccountId: cash.id, revenueAccountId: revenue.id,
    revenueService22AccountId: revenue.id, vat22AccountId: vat.id, salesBookingFrequency: "daily",
  });
  const [order] = await db.insert(narocilaTable).values({
    enotaId: unit.id, status: "zakljuceno", skupaj: "12.20",
  }).returning({ id: narocilaTable.id });
  const [receipt] = await db.insert(racuniTable).values({
    enotaId: unit.id, narociloId: order.id, stevilkaRacuna: `TEST-${tag}`,
    skupaj: "12.20", ddv: "2.20", placilnaNacin: "gotovina", status: "poslan",
    datumCas: new Date(`${DATE}T12:00:00+02:00`),
    znesekGotovina: "12.20", znesekKartica: "0", znesekBon: "0", znesekBonPica: "0", znesekNegotovinsko: "0",
  }).returning({ id: racuniTable.id });
  await db.insert(postavkeTable).values({
    narociloId: order.id, racunId: receipt.id, ime: "Testna storitev",
    kolicina: 1, cenaKos: "12.20", skupaj: "12.20", davek: "22.00", vrstaArtikla: "storitev",
  });
});

afterEach(async () => {
  if (!companyId) return;
  await db.delete(auditLogTable).where(eq(auditLogTable.companyId, companyId));
  // Fiskalni/integritetni triggerji preprečujejo navaden cascade na računih.
  await db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
    await tx.execute(sql`DELETE FROM postavke WHERE racun_id IN (SELECT r.id FROM racuni r JOIN enote e ON e.id=r.enota_id WHERE e.company_id=${companyId})`);
    await tx.execute(sql`DELETE FROM racuni WHERE enota_id IN (SELECT id FROM enote WHERE company_id=${companyId})`);
  });
  await db.delete(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
  await db.delete(posBookingDraftsTable).where(eq(posBookingDraftsTable.companyId, companyId));
  // Navadni cascade za lastni izolirani tenant; nikoli poslovni podatki.
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

async function archive() {
  return db.select().from(posBookingDraftsTable).where(eq(posBookingDraftsTable.companyId, companyId));
}
async function ledger() {
  return db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
}
async function enableErp(status: "open" | "locked" = "open") {
  await db.insert(companyModulesTable).values({
    companyId, module: "erp", enabledBy: "test", enabledAt: new Date("2026-10-01T08:00:00Z"),
  });
  await db.insert(accountingPeriodsTable).values({
    companyId, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", status,
  });
}

describe("Samostojni POS in poznejša glavna knjiga", () => {
  it("ustvari uravnoteženo POS temeljnico brez obdobja in brez GK", async () => {
    const result = await syncPosBookingForDay(companyId, DATE);
    expect(result.created.some(ref => ref.startsWith("POS:PRODAJA"))).toBe(true);
    expect(result.skipped.some(row => row.reason.includes("obdobja"))).toBe(false);
    const drafts = await archive();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].periodId).toBeNull();
    expect(await ledger()).toHaveLength(0);
    const periods = await db.select().from(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, companyId));
    expect(periods).toHaveLength(0);
    const lines = await db.select().from(posBookingDraftLinesTable).where(eq(posBookingDraftLinesTable.entryId, drafts[0].id));
    expect(lines.reduce((sum, line) => sum + Number(line.amount) * (line.side === "debit" ? 1 : -1), 0)).toBeCloseTo(0);
  });

  it("tudi mesečni zbirnik brez obdobja ostane v POS arhivu", async () => {
    await db.update(posBookingSettingsTable).set({ salesBookingFrequency: "monthly" })
      .where(eq(posBookingSettingsTable.companyId, companyId));
    const result = await syncPosBookingForMonth(companyId, "2026-09");
    expect(result.created.some(ref => ref.startsWith("POS:PRODAJA:2026-09:"))).toBe(true);
    expect(await archive()).toHaveLength(1);
    expect(await ledger()).toHaveLength(0);
  });

  it("poznejši vklop ERP in ponovni sync zgodovine pustita GK prazno", async () => {
    await syncPosBookingForDay(companyId, DATE);
    await enableErp();
    expect(await ledger()).toHaveLength(0);
    await syncPosBookingForDay(companyId, DATE);
    await syncPosBookingForMonth(companyId, "2026-09");
    expect(await ledger()).toHaveLength(0);
    expect(await archive()).toHaveLength(1);
  });

  it("tudi vklop ERP na isti poslovni dan ne prenese obstoječega POS osnutka", async () => {
    await syncPosBookingForDay(companyId, DATE);
    await enableErp();
    await db.update(companyModulesTable).set({ enabledAt: new Date(`${DATE}T18:00:00+02:00`) })
      .where(and(eq(companyModulesTable.companyId, companyId), eq(companyModulesTable.module, "erp")));
    await syncPosBookingForDay(companyId, DATE);
    expect(await ledger()).toHaveLength(0);
    expect(await archive()).toHaveLength(1);
  });

  it("izrecen prenos ustvari samo GK osnutek; replay po regeneraciji ne podvoji", async () => {
    await syncPosBookingForDay(companyId, DATE);
    await enableErp();
    const [source] = await archive();
    const first = await transferPosDrafts(companyId, [source.id], "test-actor");
    expect(first.created).toHaveLength(1);
    expect(await archive()).toHaveLength(1);
    const [entry] = await ledger();
    expect(entry.status).toBe("draft");
    expect(entry.postedAt).toBeNull();
    expect(entry.createdBy).toBe("test-actor");
    await syncPosBookingForDay(companyId, DATE);
    const [updatedSource] = await archive();
    const replay = await transferPosDrafts(companyId, [updatedSource.id], "test-actor");
    expect(replay.created).toHaveLength(0);
    expect(replay.alreadyTransferred).toEqual(first.created);
    expect(await ledger()).toHaveLength(1);
    const logs = await db.select().from(auditLogTable).where(and(
      eq(auditLogTable.companyId, companyId), eq(auditLogTable.entityId, entry.id),
    ));
    expect(logs).toHaveLength(1);
  });

  it("izrecen prenos brez ERP ali v zaklenjeno obdobje ne ustvari GK", async () => {
    await syncPosBookingForDay(companyId, DATE);
    const [source] = await archive();
    await expect(transferPosDrafts(companyId, [source.id], "test")).rejects.toThrow("nima vključene");
    await enableErp("locked");
    await expect(transferPosDrafts(companyId, [source.id], "test")).rejects.toThrow("ni odprtega obdobja");
    expect(await ledger()).toHaveLength(0);
    expect(await archive()).toHaveLength(1);
  });

  it("zavrne izbor iz drugega podjetja", async () => {
    await enableErp();
    await expect(transferPosDrafts(companyId, [crypto.randomUUID()], "test")).rejects.toThrow("aktivnem podjetju");
    expect(await ledger()).toHaveLength(0);
  });
});
