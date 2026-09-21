/**
 * Integracijski testi za syncPosBookingForMonth — mesečni POS zbirnik.
 *
 * Pokrivamo tri kritične poti:
 *   A) Prva generacija: mesečna PRODAJA temeljnica + SŠP draft invoice ustvarjeni
 *   B) Ponovna generacija (regeneracija): zamenja obstoječe osnutke brez FK napake
 *      (invoices.linked_entry_id → journal_entries.id nima ON DELETE CASCADE)
 *   C) Brez podatkov: cleanup obstoječih osnutkov (invoice + journal entry)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";

import {
  db,
  pool,
  companiesTable,
  accountingPeriodsTable,
  accountsTable,
  costCentersTable,
  enoteTable,
  narocilaTable,
  racuniTable,
  postavkeTable,
  posBookingSettingsTable,
  journalEntriesTable,
  journalEntryLinesTable,
  invoicesTable,
  invoiceLinesTable,
  counterpartiesTable,
  artikliTable,
  zalogaGibiTable,
} from "@workspace/db";
import { syncPosBookingForDay, syncPosBookingForMonth } from "./posSyncBooking";

// Pretekli mesec (zadnji zaključeni) — mora biti < tekoči mesec
const MONTH = "2026-07";
// En dan znotraj tega meseca za POS račune (Ljubljana čas = UTC+2 julij)
const SALE_DATE = new Date("2026-07-15T10:00:00+02:00");

const RUN_ID = Math.random().toString(36).slice(2, 10).toUpperCase();

let companyId = "";
let costCenterId = "";
let enotaId = 0;
let subsidyCounterpartyId = "";

// Konto IDji
let cashAccountId = "";
let revenueService22AccountId = "";
let revenueService95AccountId = "";
let vat22AccountId = "";
let vat95AccountId = "";
let subsidyReceivableAccountId = "";
let cogsMaterialAccountId = "";
let cogsGoodsAccountId = "";
let inventoryMaterialAccountId = "";
let inventoryGoodsAccountId = "";

async function createAccount(code: string, type: "asset" | "liability" | "revenue" | "expense") {
  const [account] = await db
    .insert(accountsTable)
    .values({ companyId, code: `${code}-${RUN_ID}`, name: `Test ${code}`, type })
    .returning({ id: accountsTable.id });
  return account.id;
}

/** Ustvari POS račun z gotovino + opcijsko SŠP subvencijo v juliju 2026. */
async function createMonthlySale(opts: {
  number: string;
  skupaj: string;
  gotovina: string;
  subvencija?: string;
  davek?: string;
  datumCas?: Date;
}) {
  const [order] = await db
    .insert(narocilaTable)
    .values({ enotaId, status: "zakljuceno", skupaj: opts.skupaj })
    .returning({ id: narocilaTable.id });

  const [receipt] = await db
    .insert(racuniTable)
    .values({
      enotaId,
      narociloId: order.id,
      stevilkaRacuna: opts.number,
      skupaj: opts.skupaj,
      ddv: "2.20",
      placilnaNacin: "gotovina",
      status: "poslan",
      datumCas: opts.datumCas ?? SALE_DATE,
      znesekGotovina: opts.gotovina,
      znesekKartica: "0",
      znesekBon: "0",
      znesekBonPica: "0",
      znesekNegotovinsko: "0",
      znesekSubvencija: opts.subvencija ?? "0",
    })
    .returning({ id: racuniTable.id });

  await db.insert(postavkeTable).values({
    narociloId: order.id,
    racunId: receipt.id,
    ime: "Testni obrok",
    kolicina: 1,
    cenaKos: opts.skupaj,
    skupaj: opts.skupaj,
    davek: opts.davek ?? "22.00",
    vrstaArtikla: "storitev",
  });

  return receipt.id;
}

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({
      podjetjeDavcna: `SI_MONTHLY_${RUN_ID}`,
      naziv: `Mesečni sync test ${RUN_ID}`,
    })
    .returning({ id: companiesTable.id });
  companyId = company.id;

  await db.insert(accountingPeriodsTable).values({
    companyId,
    name: "Test 2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status: "open",
  });

  [
    cashAccountId,
    revenueService22AccountId,
    revenueService95AccountId,
    vat22AccountId,
    subsidyReceivableAccountId,
    vat95AccountId,
    cogsMaterialAccountId,
    cogsGoodsAccountId,
    inventoryMaterialAccountId,
    inventoryGoodsAccountId,
  ] =
    await Promise.all([
      createAccount("1000", "asset"),
      createAccount("7600", "revenue"),
      createAccount("7650", "revenue"),
      createAccount("2600", "liability"),
      createAccount("1650", "asset"),
      createAccount("2601", "liability"),
      createAccount("4100", "expense"),
      createAccount("4600", "expense"),
      createAccount("3100", "asset"),
      createAccount("6600", "asset"),
    ]);

  const [counterparty] = await db
    .insert(counterpartiesTable)
    .values({ companyId, type: "customer", name: `MDDSZ/ŠOS ${RUN_ID}` })
    .returning({ id: counterpartiesTable.id });
  subsidyCounterpartyId = counterparty.id;

  const [cc] = await db
    .insert(costCentersTable)
    .values({ companyId, code: "PE-TEST", name: "Test enota", isActive: true })
    .returning({ id: costCentersTable.id });
  costCenterId = cc.id;

  const [enota] = await db
    .insert(enoteTable)
    .values({ companyId, ime: "Test Enota", costCenterId })
    .returning({ id: enoteTable.id });
  enotaId = enota.id;

  // Nastavitve: mesečna frekvenca prodaje, SŠP konti
  await db.insert(posBookingSettingsTable).values({
    companyId,
    cashAccountId,
    revenueService22AccountId,
    revenueService95AccountId,
    vat22AccountId,
    vat95AccountId,
    subsidyReceivableAccountId,
    subsidyCounterpartyId,
    cogsMaterialAccountId,
    cogsGoodsAccountId,
    inventoryMaterialAccountId,
    inventoryGoodsAccountId,
    salesBookingFrequency: "monthly",
    consumptionBookingFrequency: "monthly",
  });

  // Prodaja za julij 2026: 10 € gotovina + 5 € SŠP subvencija = 15 €
  await createMonthlySale({
    number: `M-MONTHLY-001-${RUN_ID}`,
    skupaj: "15.00",
    gotovina: "10.00",
    subvencija: "5.00",
  });
  await createMonthlySale({
    number: `M-MONTHLY-002-${RUN_ID}`,
    skupaj: "8.00",
    gotovina: "8.00",
    davek: "9.50",
    datumCas: new Date("2026-07-25T10:00:00+02:00"),
  });
});

afterAll(async () => {
  if (!companyId) return;

  await db.transaction(async (tx) => {
  await tx.execute(sql`SET LOCAL app.allow_stock_movement_cleanup = 'on'`);
  // Zberi invoice IDs pred brisanjem
  const invoices = await tx
    .select({ id: invoicesTable.id })
    .from(invoicesTable)
    .where(eq(invoicesTable.companyId, companyId));
  const invoiceIds = invoices.map(inv => inv.id);

  // Brisanje v varnem vrstnem redu (FK od otroka k staršu)
  if (invoiceIds.length > 0) {
    await tx.delete(invoiceLinesTable).where(inArray(invoiceLinesTable.invoiceId, invoiceIds));
    await tx.delete(invoicesTable).where(inArray(invoicesTable.id, invoiceIds));
  }

  const entries = await tx
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.companyId, companyId));
  if (entries.length > 0) {
    await tx.delete(journalEntryLinesTable)
      .where(inArray(journalEntryLinesTable.entryId, entries.map(e => e.id)));
    await tx.delete(journalEntriesTable)
      .where(inArray(journalEntriesTable.id, entries.map(e => e.id)));
  }

  const receipts = await tx
    .select({ id: racuniTable.id })
    .from(racuniTable)
    .where(eq(racuniTable.enotaId, enotaId));
  if (receipts.length > 0) {
    // Vrstni red: postavke → racuni → narocila (FK racuni.narocilo_id → narocila.id)
    await tx.delete(postavkeTable)
      .where(inArray(postavkeTable.racunId, receipts.map(r => r.id)));
    await tx.delete(racuniTable)
      .where(inArray(racuniTable.id, receipts.map(r => r.id)));
    await tx.delete(narocilaTable).where(eq(narocilaTable.enotaId, enotaId));
  }

  await tx.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  await tx.delete(posBookingSettingsTable).where(eq(posBookingSettingsTable.companyId, companyId));
  await tx.delete(counterpartiesTable).where(eq(counterpartiesTable.companyId, companyId));
  await tx.delete(costCentersTable).where(eq(costCentersTable.companyId, companyId));
  await tx.delete(accountsTable).where(eq(accountsTable.companyId, companyId));
  await tx.delete(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, companyId));
  await tx.delete(companiesTable).where(eq(companiesTable.id, companyId));
  });
  await pool.end();
});

describe("syncPosBookingForMonth — mesečni POS zbirnik", () => {
  const prodajaRef = () => `POS:PRODAJA:${MONTH}:E${enotaId}`;

  it("A) prva generacija: ustvari PRODAJA temeljnico in SŠP draft invoice", async () => {
    const result = await syncPosBookingForMonth(companyId, MONTH);
    expect(result.created).toContain(prodajaRef());
    expect(result.skipped.filter(s => s.ref === prodajaRef())).toHaveLength(0);

    // Preverimo journal entry
    const [entry] = await db
      .select({ id: journalEntriesTable.id, status: journalEntriesTable.status })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.reference, prodajaRef()));
    expect(entry).toBeTruthy();
    expect(entry.status).toBe("draft");

    // Preverimo vrstice — debet gotovina + debet SŠP terjatev + kredit prihodki + kredit DDV
    const lines = await db
      .select({
        accountId: journalEntryLinesTable.accountId,
        side: journalEntryLinesTable.side,
        amount: journalEntryLinesTable.amount,
        partnerId: journalEntryLinesTable.partnerId,
        costCenterId: journalEntryLinesTable.costCenterId,
      })
      .from(journalEntryLinesTable)
      .where(eq(journalEntryLinesTable.entryId, entry.id));

    const debits = lines.filter(l => l.side === "debit");
    const credits = lines.filter(l => l.side === "credit");

    // Gotovina 10 € + 8 € + SŠP 5 € = 23 € skupni debet.
    expect(debits).toContainEqual(expect.objectContaining({ accountId: cashAccountId, amount: "18.00" }));
    expect(debits).toContainEqual(expect.objectContaining({ accountId: subsidyReceivableAccountId, amount: "5.00", partnerId: subsidyCounterpartyId }));

    // Kredit: prihodki (neto) + DDV 22 % + DDV 9,5 %.
    const totalCredit = credits.reduce((sum, l) => sum + parseFloat(l.amount), 0);
    expect(totalCredit).toBeCloseTo(23.0, 1);
    expect(credits.some(l => l.accountId === vat22AccountId)).toBe(true);
    expect(credits.some(l => l.accountId === vat95AccountId)).toBe(true);
    expect(debits.reduce((sum, l) => sum + parseFloat(l.amount), 0)).toBeCloseTo(totalCredit, 2);
    expect(new Set(lines.map(line => line.costCenterId))).toEqual(new Set([costCenterId]));

    // Preverimo SŠP draft invoice
    const sspNumber = `POS-SSP-${MONTH}-E${enotaId}`;
    const [invoice] = await db
      .select({ id: invoicesTable.id, status: invoicesTable.status, linkedEntryId: invoicesTable.linkedEntryId })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.invoiceNumber, sspNumber)));
    expect(invoice).toBeTruthy();
    expect(invoice.status).toBe("draft");
    expect(invoice.linkedEntryId).toBe(entry.id);

    // Preverimo invoice vrstice (kaskadiran cascade ob brisanju invoice)
    const invLines = await db
      .select({ unitPrice: invoiceLinesTable.unitPrice })
      .from(invoiceLinesTable)
      .where(eq(invoiceLinesTable.invoiceId, invoice.id));
    expect(invLines).toHaveLength(1);
    expect(parseFloat(invLines[0].unitPrice)).toBeCloseTo(5.0, 2);
  });

  it("B) ponovna generacija: nadomesti osnutke brez FK napake (linked_entry_id)", async () => {
    // Drugi klic — za isti mesec, istega podjetja, iste enote.
    // Pred popravkom bi ta klic vrnil FK napako (23503), ker deleteExistingMonthlyDraft
    // briše journal entry medtem ko invoice.linked_entry_id še kaže nanj.
    await expect(syncPosBookingForMonth(companyId, MONTH)).resolves.not.toThrow();

    const result = await syncPosBookingForMonth(companyId, MONTH);
    expect(result.created).toContain(prodajaRef());

    // Samo EN journal entry osnutek za ta ref (brez podvajanja)
    const entries = await db
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.status, "draft"),
        like(journalEntriesTable.reference, `POS:PRODAJA:${MONTH}:%`),
      ));
    expect(entries).toHaveLength(1);

    // Samo EN SŠP invoice osnutek (ne podvoji)
    const sspNumber = `POS-SSP-${MONTH}-E${enotaId}`;
    const invoices = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.invoiceNumber, sspNumber)));
    expect(invoices).toHaveLength(1);

    // linked_entry_id mora kazati na NOVI journal entry (ne stari, ki je bil izbrisan)
    const [invoice] = invoices;
    expect(invoice.id).toBeTruthy();
    const [linked] = await db
      .select({ id: invoicesTable.linkedEntryId })
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoice.id));
    expect(linked.id).toBe(entries[0].id);
  });

  it("C) brez podatkov: cleanup obstoječe osnutke (invoice + journal entry) brez napake", async () => {
    // Označimo vse račune za ta mesec kot stornirane, da ni nobene prodaje
    const receipts = await db
      .select({ id: racuniTable.id })
      .from(racuniTable)
      .where(eq(racuniTable.enotaId, enotaId));
    await Promise.all(
      receipts.map(r =>
        db.update(racuniTable).set({ status: "storniran" }).where(eq(racuniTable.id, r.id)),
      ),
    );

    const result = await syncPosBookingForMonth(companyId, MONTH);
    // Ni ustvarjeno (brez podatkov)
    expect(result.created.filter(r => r.startsWith("POS:PRODAJA"))).toHaveLength(0);

    // Journal entry osnutek je bil izbrisan
    const entries = await db
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.companyId, companyId),
        like(journalEntriesTable.reference, `POS:PRODAJA:${MONTH}:%`),
      ));
    expect(entries).toHaveLength(0);

    // SŠP invoice osnutek je bil izbrisan skupaj (brez FK napake)
    const sspNumber = `POS-SSP-${MONTH}-E${enotaId}`;
    const invoices = await db
      .select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.invoiceNumber, sspNumber)));
    expect(invoices).toHaveLength(0);

    // Tudi obstoječi PORABA osnutek mora biti odstranjen, ko v mesecu ni gibanj.
    await db.insert(journalEntriesTable).values({
      companyId,
      periodId: (await db.select({ id: accountingPeriodsTable.id })
        .from(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, companyId)).limit(1))[0].id,
      entryDate: `${MONTH}-31`,
      documentDate: `${MONTH}-31`,
      description: "Prazni mesečni PORABA osnutek",
      reference: `POS:PORABA:${MONTH}:E${enotaId}`,
      status: "draft",
      sourceType: "document",
      createdBy: "pos-sync",
    });
    await syncPosBookingForMonth(companyId, MONTH);
    expect(await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.reference, `POS:PORABA:${MONTH}:E${enotaId}`))).toHaveLength(0);

    // Ponastavimo račune nazaj za morebiten ponovni zagon testov
    await Promise.all(
      receipts.map(r =>
        db.update(racuniTable).set({ status: "poslan" }).where(eq(racuniTable.id, r.id)),
      ),
    );
  });

  it("D) brez SM ustvari mesečno temeljnico z NULL stroškovnim mestom in stabilno referenco enote", async () => {
    await db
      .update(enoteTable)
      .set({ costCenterId: null })
      .where(eq(enoteTable.id, enotaId));

    const result = await syncPosBookingForMonth(companyId, MONTH);
    expect(result.created).toContain(prodajaRef());
    expect(result.skipped.some(({ reason }) => reason.includes("nima veljavnega stroškovnega mesta"))).toBe(false);

    const [entry] = await db
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.reference, prodajaRef()));
    expect(entry).toBeTruthy();
    expect(
      await db
        .select({ costCenterId: journalEntryLinesTable.costCenterId })
        .from(journalEntryLinesTable)
        .where(eq(journalEntryLinesTable.entryId, entry.id)),
    ).toEqual(expect.arrayContaining([{ costCenterId: null }]));

    await db
      .update(enoteTable)
      .set({ costCenterId })
      .where(eq(enoteTable.id, enotaId));
  });

  it("E) PORABA sešteje gibanja po vrsti artikla in ustvari uravnotežene vrstice", async () => {
    const [material] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Mesečni material ${RUN_ID}`,
      cena: "4.00",
      nabavniArtikel: true,
      vrstaArtikla: "material",
    }).returning({ id: artikliTable.id });
    const [goods] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Mesečno blago ${RUN_ID}`,
      cena: "5.00",
      nabavniArtikel: true,
      vrstaArtikla: "blago",
    }).returning({ id: artikliTable.id });

    await db.insert(zalogaGibiTable).values([
      {
        artikelId: material.id,
        tip: "poraba",
        kolicina: "-2",
        cenaKos: "4",
        vrednost: "-8",
        ustvarjeno: new Date("2026-07-05T10:00:00Z"),
        sourceSnapshot: "test_monthly_booking_fixture",
      },
      {
        artikelId: material.id,
        tip: "poraba",
        kolicina: "-3",
        cenaKos: "4",
        vrednost: "-12",
        ustvarjeno: new Date("2026-07-20T10:00:00Z"),
        sourceSnapshot: "test_monthly_booking_fixture",
      },
      {
        artikelId: goods.id,
        tip: "poraba",
        kolicina: "-3",
        cenaKos: "5",
        vrednost: "-15",
        ustvarjeno: new Date("2026-07-12T10:00:00Z"),
        sourceSnapshot: "test_monthly_booking_fixture",
      },
    ]);

    const result = await syncPosBookingForMonth(companyId, MONTH);
    const porabaRef = `POS:PORABA:${MONTH}:E${enotaId}`;
    expect(result.created).toContain(porabaRef);

    const [entry] = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.reference, porabaRef));
    const lines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable)
      .where(eq(journalEntryLinesTable.entryId, entry.id));

    expect(lines).toContainEqual(expect.objectContaining({
      accountId: cogsMaterialAccountId, side: "debit", amount: "20.00",
    }));
    expect(lines).toContainEqual(expect.objectContaining({
      accountId: inventoryMaterialAccountId, side: "credit", amount: "20.00",
    }));
    expect(lines).toContainEqual(expect.objectContaining({
      accountId: cogsGoodsAccountId, side: "debit", amount: "15.00",
    }));
    expect(lines).toContainEqual(expect.objectContaining({
      accountId: inventoryGoodsAccountId, side: "credit", amount: "15.00",
    }));
    expect(lines.filter(line => line.side === "debit")
      .reduce((sum, line) => sum + parseFloat(line.amount), 0))
      .toBeCloseTo(lines.filter(line => line.side === "credit")
        .reduce((sum, line) => sum + parseFloat(line.amount), 0), 2);
  });

  it("F) dnevna temeljnica prepreči mesečni zbirnik istega modula", async () => {
    const dailyRef = `POS:PRODAJA:2026-07-15:E${enotaId}`;
    await db.insert(journalEntriesTable).values({
      companyId,
      periodId: (await db.select({ id: accountingPeriodsTable.id })
        .from(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, companyId)).limit(1))[0].id,
      entryDate: "2026-07-15",
      documentDate: "2026-07-15",
      description: "Dnevna varovalna temeljnica",
      reference: dailyRef,
      status: "draft",
      sourceType: "document",
      createdBy: "pos-sync",
    });

    const result = await syncPosBookingForMonth(companyId, MONTH);
    expect(result.skipped).toContainEqual(expect.objectContaining({
      ref: `POS:PRODAJA:${MONTH}:E${enotaId}`,
    }));
    expect(result.skipped.find(item => item.ref === `POS:PRODAJA:${MONTH}:E${enotaId}`)?.reason)
      .toContain("dnevna temeljnica");

    await db.delete(journalEntriesTable).where(eq(journalEntriesTable.reference, dailyRef));
  });

  it("G) potrjena mesečna temeljnica prepreči dnevni zbirnik", async () => {
    const monthlyRef = `POS:PRODAJA:${MONTH}:E${enotaId}`;
    const [monthly] = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.reference, monthlyRef));
    expect(monthly).toBeTruthy();

    await db.update(posBookingSettingsTable)
      .set({ salesBookingFrequency: "daily" })
      .where(eq(posBookingSettingsTable.companyId, companyId));
    await db.update(journalEntriesTable)
      .set({ status: "posted" })
      .where(eq(journalEntriesTable.id, monthly.id));

    const result = await syncPosBookingForDay(companyId, "2026-07-31");
    expect(result.skipped).toContainEqual(expect.objectContaining({
      ref: `POS:PRODAJA:2026-07-31:E${enotaId}`,
    }));
    expect(result.skipped.find(item => item.ref === `POS:PRODAJA:2026-07-31:E${enotaId}`)?.reason)
      .toContain("Mesečna temeljnica prodaje");

    await db.update(journalEntriesTable)
      .set({ status: "draft" })
      .where(eq(journalEntriesTable.id, monthly.id));
    await db.update(posBookingSettingsTable)
      .set({ salesBookingFrequency: "monthly" })
      .where(eq(posBookingSettingsTable.companyId, companyId));
  });

  it("H) sočasna mesečna klica ostaneta idempotentni", async () => {
    await Promise.all([
      syncPosBookingForMonth(companyId, MONTH),
      syncPosBookingForMonth(companyId, MONTH),
    ]);
    const entries = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(eq(journalEntriesTable.reference, `POS:PRODAJA:${MONTH}:E${enotaId}`));
    expect(entries).toHaveLength(1);
  });
});
