import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import Decimal from "decimal.js";

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
  posCategoryRevenueAccountsTable,
  journalEntriesTable,
  journalEntryLinesTable,
  posReceiptBookingSourcesTable,
  artikliTable,
  counterpartiesTable,
  prejemniceTable,
  prejemnicePostavkeTable,
  zacetneZalogeTable,
  zacetneZalogePostavkeTable,
  invoicesTable,
  invoiceLinesTable,
  vatCodeTable,
  vatLedgerTable,
  auditLogTable,
} from "@workspace/db";
import { bookZacetnaZaloga, syncPosBookingForDay } from "./posSyncBooking";
import {
  getPosReceiptBookingPreview,
  lockPosReceiptForEdit,
  savePosReceiptBookingDraft,
} from "./posReceiptBooking";
import { isReceiptBookedTo109 } from "../routes/invoices";
import { deleteDraftJournalEntry } from "./journalEntryDeletion";

const DATE = "2026-08-19";
const RUN_ID = Math.random().toString(36).slice(2, 10).toUpperCase();
const STALE_NO_COST_CENTER_REF = `POS:PRODAJA:${DATE}:STARO:E`;

let companyId = "";
let periodId = "";
let costCenters: Array<{ id: string; code: string }> = [];
let enotaIds: number[] = [];
let receiptIds: number[] = [];
let payablesAccountId = "";
let nabavaObracunAccountId = "";
let supplierAId = "";
let supplierBId = "";
let defaultRevenueAccountId = "";
let defaultVatAccountId = "";
const openingArtikelIds: number[] = [];
const openingZalogaIds: number[] = [];

async function createAccount(code: string, type: "asset" | "liability" | "revenue") {
  const [account] = await db
    .insert(accountsTable)
    .values({ companyId, code: `${code}-${RUN_ID}`, name: `Test konto ${code}`, type })
    .returning({ id: accountsTable.id });
  return account.id;
}

async function createSale(
  enotaId: number,
  number: string,
  amount: string,
  kategorijaId: number | null = null,
) {
  const gross = new Decimal(amount);
  const net = gross.div("1.22").toDecimalPlaces(2);
  const [order] = await db
    .insert(narocilaTable)
    .values({ enotaId, status: "zakljuceno", skupaj: amount })
    .returning({ id: narocilaTable.id });

  const [receipt] = await db
    .insert(racuniTable)
    .values({
      enotaId,
      narociloId: order.id,
      stevilkaRacuna: number,
      skupaj: amount,
      osnova: net.toFixed(2),
      ddv: gross.minus(net).toFixed(2),
      placilnaNacin: "gotovina",
      status: "poslan",
      datumCas: new Date(`${DATE}T10:00:00+02:00`),
      znesekGotovina: amount,
      znesekKartica: "0",
      znesekBon: "0",
      znesekBonPica: "0",
      znesekNegotovinsko: "0",
    })
    .returning({ id: racuniTable.id });

  await db.insert(postavkeTable).values({
    narociloId: order.id,
    racunId: receipt.id,
    kategorijaId,
    ime: "Testna pijača",
    kolicina: 1,
    cenaKos: amount,
    skupaj: amount,
    davek: "22.00",
    vrstaArtikla: "storitev",
  });
}

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({
      podjetjeDavcna: `SI_SYNC_UNIT_${RUN_ID}`,
      naziv: `POS enote sync ${RUN_ID}`,
    })
    .returning({ id: companiesTable.id });
  companyId = company.id;

  const [period] = await db
    .insert(accountingPeriodsTable)
    .values({
      companyId,
      name: "Test 2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      status: "open",
    })
    .returning({ id: accountingPeriodsTable.id });
  periodId = period.id;

  const [
    cashAccountId,
    revenueAccountId,
    vatAccountId,
    openingBalanceAccountId,
    inventoryMaterialAccountId,
    inventoryGoodsAccountId,
    createdPayablesAccountId,
    createdNabavaObracunAccountId,
  ] = await Promise.all([
    createAccount("1000", "asset"),
    createAccount("7600", "revenue"),
    createAccount("2600", "liability"),
    createAccount("9900", "liability"),
    createAccount("3100", "asset"),
    createAccount("6600", "asset"),
    createAccount("2200", "liability"),
    createAccount("1090", "asset"),
  ]);
  payablesAccountId = createdPayablesAccountId;
  nabavaObracunAccountId = createdNabavaObracunAccountId;
  defaultRevenueAccountId = revenueAccountId;
  defaultVatAccountId = vatAccountId;
  await db.insert(posBookingSettingsTable).values({
    companyId,
    cashAccountId,
    revenueService22AccountId: revenueAccountId,
    vat22AccountId: vatAccountId,
    kirArAccountId: cashAccountId,
    openingBalanceAccountId,
    inventoryMaterialAccountId,
    inventoryGoodsAccountId,
    payablesAccountId,
    nabavaObracunAccountId,
  });

  costCenters = await db
    .insert(costCentersTable)
    .values([
      { companyId, code: "PE-KRIZISCE", name: "Bife Križišče", isActive: true },
      { companyId, code: "PE-JADRAN", name: "Bife Jadran", isActive: true },
      { companyId, code: "PE-NAPRAVA", name: "Bife Naprava", isActive: true },
    ])
    .returning({ id: costCentersTable.id, code: costCentersTable.code });

  const byCode = new Map(costCenters.map(center => [center.code, center.id]));
  const createdEnote = await db
    .insert(enoteTable)
    .values([
      { companyId, ime: "Križišče", costCenterId: byCode.get("PE-KRIZISCE")! },
      { companyId, ime: "Jadran", costCenterId: byCode.get("PE-JADRAN")! },
      { companyId, ime: "Naprava", costCenterId: byCode.get("PE-NAPRAVA")! },
      { companyId, ime: "Brez SM", costCenterId: null },
      { companyId, ime: "Neveljaven SM", costCenterId: "00000000-0000-0000-0000-000000000001" },
    ])
    .returning({ id: enoteTable.id });
  enotaIds = createdEnote.map(enota => enota.id);

  await Promise.all([
    createSale(enotaIds[0], "TEST-KRIZISCE", "12.20"),
    createSale(enotaIds[1], "TEST-JADRAN", "24.40"),
    createSale(enotaIds[2], "TEST-NAPRAVA", "36.60"),
    createSale(enotaIds[3], "TEST-BREZ-SM", "48.80"),
    createSale(enotaIds[4], "TEST-NEVELJAVEN-SM", "61.00"),
  ]);

  const openingArtikli = await db
    .insert(artikliTable)
    .values([
      { enotaId: enotaIds[0], ime: `ZZ Križišče ${RUN_ID}`, cena: "1.00", nabavniArtikel: true, vrstaArtikla: "material" },
      { enotaId: enotaIds[1], ime: `ZZ Jadran ${RUN_ID}`, cena: "1.00", nabavniArtikel: true, vrstaArtikla: "blago" },
      { enotaId: enotaIds[3], ime: `ZZ Brez SM ${RUN_ID}`, cena: "1.00", nabavniArtikel: true, vrstaArtikla: "material" },
    ])
    .returning({ id: artikliTable.id });
  openingArtikelIds.push(...openingArtikli.map(artikel => artikel.id));

  const openingZaloge = await db
    .insert(zacetneZalogeTable)
    .values([
      { enotaId: enotaIds[0], leto: 2026, datum: new Date(`${DATE}T12:00:00Z`) },
      { enotaId: enotaIds[1], leto: 2026, datum: new Date(`${DATE}T12:00:00Z`) },
      { enotaId: enotaIds[3], leto: 2026, datum: new Date(`${DATE}T12:00:00Z`) },
    ])
    .returning({ id: zacetneZalogeTable.id });
  openingZalogaIds.push(...openingZaloge.map(zaloga => zaloga.id));

  await db.insert(zacetneZalogePostavkeTable).values([
    { zacetnaZalogaId: openingZaloge[0].id, artikelId: openingArtikli[0].id, kolicina: "10", cenaKos: "2.00" },
    { zacetnaZalogaId: openingZaloge[1].id, artikelId: openingArtikli[1].id, kolicina: "5", cenaKos: "8.00" },
    { zacetnaZalogaId: openingZaloge[2].id, artikelId: openingArtikli[2].id, kolicina: "3", cenaKos: "3.00" },
  ]);

  const suppliers = await db
    .insert(counterpartiesTable)
    .values([
      { companyId, type: "supplier", name: `Dobavitelj A ${RUN_ID}` },
      { companyId, type: "supplier", name: `Dobavitelj B ${RUN_ID}` },
    ])
    .returning({ id: counterpartiesTable.id });
  supplierAId = suppliers[0].id;
  supplierBId = suppliers[1].id;

  const receipts = await db
    .insert(prejemniceTable)
    .values([
      { enotaId: enotaIds[0], dobaviteljId: supplierAId, datum: new Date(`${DATE}T12:00:00Z`) },
      { enotaId: enotaIds[0], dobaviteljId: supplierBId, datum: new Date(`${DATE}T12:00:00Z`) },
      { enotaId: enotaIds[1], dobaviteljId: supplierAId, datum: new Date(`${DATE}T12:00:00Z`) },
    ])
    .returning({ id: prejemniceTable.id });
  receiptIds = receipts.map(receipt => receipt.id);
  await db.insert(prejemnicePostavkeTable).values([
    { prejemnicaId: receipts[0].id, artikelId: openingArtikelIds[0], kolicina: "5", cenaKos: "2", skupaj: "10" },
    { prejemnicaId: receipts[1].id, artikelId: openingArtikelIds[0], kolicina: "10", cenaKos: "2", skupaj: "20" },
    { prejemnicaId: receipts[2].id, artikelId: openingArtikelIds[1], kolicina: "3", cenaKos: "10", skupaj: "30" },
  ]);

  await db.insert(journalEntriesTable).values(
    [
      {
        companyId,
        periodId,
        entryDate: DATE,
        documentDate: DATE,
        description: "Stara zbirna POS temeljnica",
        reference: `POS:PRODAJA:${DATE}`,
        status: "draft",
        sourceType: "document",
        createdBy: "pos-sync",
      },
      {
        companyId,
        periodId,
        entryDate: DATE,
        documentDate: DATE,
        description: "Zastarel osnutek enote brez SM",
        reference: `${STALE_NO_COST_CENTER_REF}${enotaIds[3]}`,
        status: "draft",
        sourceType: "document",
        createdBy: "pos-sync",
      },
    ],
  );
});

afterAll(async () => {
  if (!companyId) return;

  // DDV evidence in SŠP invoice so FK vezani na račun/temeljnico, zato jih
  // pri čiščenju testnega podjetja odstranimo pred povezanimi dokumenti.
  const invoices = await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(eq(invoicesTable.companyId, companyId));
  const invoiceIds = invoices.map(invoice => invoice.id);
  if (invoiceIds.length > 0) {
    await db.delete(vatLedgerTable).where(inArray(vatLedgerTable.invoiceId, invoiceIds));
  }
  await db.delete(invoicesTable).where(eq(invoicesTable.companyId, companyId));
  const entries = await db
    .select({ id: journalEntriesTable.id })
    .from(journalEntriesTable)
    .where(eq(journalEntriesTable.companyId, companyId));
  const entryIds = entries.map(entry => entry.id);
  if (entryIds.length > 0) {
    await db.delete(journalEntryLinesTable).where(inArray(journalEntryLinesTable.entryId, entryIds));
    await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.id, entryIds));
  }

  const goodsReceipts = await db
    .select({ id: prejemniceTable.id })
    .from(prejemniceTable)
    .where(inArray(prejemniceTable.enotaId, enotaIds));
  const goodsReceiptIds = goodsReceipts.map(receipt => receipt.id);
  if (goodsReceiptIds.length > 0) {
    await db.delete(prejemnicePostavkeTable)
      .where(inArray(prejemnicePostavkeTable.prejemnicaId, goodsReceiptIds));
    await db.delete(prejemniceTable).where(inArray(prejemniceTable.id, goodsReceiptIds));
  }
  await db.delete(counterpartiesTable).where(eq(counterpartiesTable.companyId, companyId));
  if (openingZalogaIds.length > 0) {
    await db.delete(zacetneZalogePostavkeTable)
      .where(inArray(zacetneZalogePostavkeTable.zacetnaZalogaId, openingZalogaIds));
    await db.delete(zacetneZalogeTable).where(inArray(zacetneZalogeTable.id, openingZalogaIds));
  }
  if (openingArtikelIds.length > 0) {
    await db.delete(artikliTable).where(inArray(artikliTable.id, openingArtikelIds));
  }

  const receipts = await db
    .select({ id: racuniTable.id })
    .from(racuniTable)
    .where(inArray(racuniTable.enotaId, enotaIds));
  const receiptIds = receipts.map(receipt => receipt.id);
  if (receiptIds.length > 0) {
    await db.delete(postavkeTable).where(inArray(postavkeTable.racunId, receiptIds));
    await db.delete(racuniTable).where(inArray(racuniTable.id, receiptIds));
  }
  if (enotaIds.length > 0) {
    await db.delete(narocilaTable).where(inArray(narocilaTable.enotaId, enotaIds));
    await db.delete(enoteTable).where(inArray(enoteTable.id, enotaIds));
  }

  await db.delete(posBookingSettingsTable).where(eq(posBookingSettingsTable.companyId, companyId));
  await db.delete(posCategoryRevenueAccountsTable)
    .where(eq(posCategoryRevenueAccountsTable.companyId, companyId));
  await db.delete(costCentersTable).where(eq(costCentersTable.companyId, companyId));
  await db.delete(accountsTable).where(eq(accountsTable.companyId, companyId));
  await db.delete(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("POS temeljnice po enoti", () => {
  it("razdeli dnevne prihodke po POS kategoriji in DDV ohrani agregiran", async () => {
    const kategorijaId = 424242;
    const kategorijskiKontoId = await createAccount("7610", "revenue");
    await db.insert(posCategoryRevenueAccountsTable).values({
      companyId,
      categoryId: kategorijaId,
      accountId: kategorijskiKontoId,
    });
    await createSale(enotaIds[0], "TEST-KATEGORIJA", "12.20", kategorijaId);
    await createSale(enotaIds[0], "TEST-KATEGORIJA-MATRIKA", "12.20", kategorijaId + 1);

    // Trije računi po 12,20 € pri 22 %: vsak ima 10,00 € osnove in 2,20 € DDV.
    // Osnovni račun brez kategorije in nepreslikana kategorija uporabita matriko.
    const receipts = await db
      .select({
        number: racuniTable.stevilkaRacuna,
        gross: racuniTable.skupaj,
        net: racuniTable.osnova,
        vat: racuniTable.ddv,
      })
      .from(racuniTable)
      .where(eq(racuniTable.enotaId, enotaIds[0]));
    expect(receipts).toHaveLength(3);
    expect(receipts).toEqual(expect.arrayContaining(
      ["TEST-KRIZISCE", "TEST-KATEGORIJA", "TEST-KATEGORIJA-MATRIKA"].map(number => ({
        number,
        gross: "12.20",
        net: "10.00",
        vat: "2.20",
      })),
    ));

    await syncPosBookingForDay(companyId, DATE);

    const [entry] = await db
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.reference, `POS:PRODAJA:${DATE}:E${enotaIds[0]}`),
      ))
      .limit(1);
    const lines = await db
      .select({
        accountId: journalEntryLinesTable.accountId,
        side: journalEntryLinesTable.side,
        amount: journalEntryLinesTable.amount,
        description: journalEntryLinesTable.description,
      })
      .from(journalEntryLinesTable)
      .where(eq(journalEntryLinesTable.entryId, entry.id));

    expect(lines).toContainEqual(expect.objectContaining({
      accountId: kategorijskiKontoId,
      side: "credit",
      amount: "10.00",
      description: `Prihodki kategorije ${kategorijaId}`,
    }));
    const matrixFallbackLine = lines.find((line) => line.accountId === defaultRevenueAccountId);
    expect(matrixFallbackLine).toEqual(expect.objectContaining({
      side: "credit",
      amount: "20.00",
    }));
    expect(matrixFallbackLine?.description).toContain(`Prihodki kategorije ${kategorijaId + 1}`);
    // DDV vseh kategorij ostane ena kreditna vrstica na kontu DDV, ne prihodkov.
    expect(lines.filter((line) => line.description?.startsWith("Izhodni DDV"))).toEqual([
      expect.objectContaining({
        accountId: defaultVatAccountId,
        side: "credit",
        amount: "6.60",
      }),
    ]);
    expect(lines.filter((line) => line.side === "debit")).toEqual([
      expect.objectContaining({ amount: "36.60" }),
    ]);
    expect(lines).toHaveLength(4);
    const creditTotal = lines
      .filter(line => line.side === "credit")
      .reduce((total, line) => total.plus(line.amount), new Decimal(0));
    expect(creditTotal.toFixed(2)).toBe("36.60");
  });

  it("ustvari ločene prodajne temeljnice tudi brez SM in ohrani SM pri označenih enotah", async () => {
    const result = await syncPosBookingForDay(companyId, DATE);
    const expectedRefs = enotaIds.slice(0, 5)
      .map(enotaId => `POS:PRODAJA:${DATE}:E${enotaId}`)
      .sort();

    expect(result.created.filter(ref => ref.startsWith(`POS:PRODAJA:${DATE}:`)).sort()).toEqual(expectedRefs);
    expect(result.skipped.some(({ reason }) => reason.includes("nima veljavnega stroškovnega mesta"))).toBe(false);

    const entries = await db
      .select({ id: journalEntriesTable.id, reference: journalEntriesTable.reference })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.companyId, companyId));
    const salesEntries = entries.filter(entry => expectedRefs.includes(entry.reference ?? ""));
    expect(salesEntries).toHaveLength(5);
    expect(entries).not.toContainEqual(
      expect.objectContaining({ reference: `POS:PRODAJA:${DATE}` }),
    );
    expect(entries).not.toContainEqual(
      expect.objectContaining({ reference: `${STALE_NO_COST_CENTER_REF}${enotaIds[3]}` }),
    );

    const lines = await db
      .select({
        entryId: journalEntryLinesTable.entryId,
        costCenterId: journalEntryLinesTable.costCenterId,
      })
      .from(journalEntryLinesTable)
      .where(inArray(journalEntryLinesTable.entryId, salesEntries.map(entry => entry.id)));

    const entryCostCenters = new Map<string, Set<string | null>>();
    for (const line of lines) {
      const centers = entryCostCenters.get(line.entryId) ?? new Set<string | null>();
      centers.add(line.costCenterId);
      entryCostCenters.set(line.entryId, centers);
    }
    expect(entryCostCenters.size).toBe(5);
    for (const centerIds of entryCostCenters.values()) {
      expect(centerIds.size).toBe(1);
       expect([...centerIds][0] === null || Boolean([...centerIds][0])).toBe(true);
    }
    expect(
      new Set([...entryCostCenters.values()].map(centerIds => [...centerIds][0])),
    ).toEqual(new Set([...costCenters.map(center => center.id), null]));
  });

  it("opozori na manjkajoče dimenzije dejanskih vrstic in ohrani osnutke", async () => {
    await db.update(accountsTable).set({
      requiresPartner: true, requiresCostCenter: true, requiresProject: true,
    }).where(eq(accountsTable.id, defaultRevenueAccountId));
    try {
      const result = await syncPosBookingForDay(companyId, DATE);
      const warnings = result.skipped.filter((item) => item.reason.includes("zahteva"));
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings.some((item) => item.reason.includes("partnerja, stroškovno mesto, projekt"))).toBe(true);
      expect(warnings.some((item) => item.reason.includes("zahteva partnerja, projekt"))).toBe(true);
      for (const warning of warnings) {
        expect(result.created).toContain(warning.ref);
        expect(warning.reason).toContain("Osnutek je ustvarjen");
      }
    } finally {
      await db.update(accountsTable).set({
        requiresPartner: false, requiresCostCenter: false, requiresProject: false,
      }).where(eq(accountsTable.id, defaultRevenueAccountId));
    }
  });

  it("ponovni sync nadomesti osnutke iste enote namesto podvajanja", async () => {
    const result = await syncPosBookingForDay(companyId, DATE);

    const entries = await db
      .select({ reference: journalEntriesTable.reference })
      .from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.status, "draft"),
      ));
    const salesRefs = entries
      .map(entry => entry.reference)
      .filter((reference): reference is string => reference?.startsWith(`POS:PRODAJA:${DATE}:`) ?? false);

    expect(salesRefs.sort()).toEqual(
      enotaIds.slice(0, 5).map(enotaId => `POS:PRODAJA:${DATE}:E${enotaId}`).sort(),
    );

    const receiptRefs = entries
      .map(entry => entry.reference)
      .filter((reference): reference is string => reference?.startsWith(`POS:PREJEMNICA:${DATE}:`) ?? false);
    expect(receiptRefs).toEqual([]);
    expect(result.skipped.some(item => item.ref.startsWith(`POS:PREJEMNICA:${DATE}:`))).toBe(false);
  });

  it("DB zaklep dovoli urejanje ob osnutku in zavrne po potrditvi knjižbe", async () => {
    const [receipt] = await db.select({ id: prejemniceTable.id })
      .from(prejemniceTable)
      .where(eq(prejemniceTable.enotaId, enotaIds[0]))
      .limit(1);
    expect(receipt).toBeTruthy();
    const [entry] = await db.insert(journalEntriesTable).values({
      companyId,
      periodId,
      entryDate: DATE,
      documentDate: DATE,
      description: "Test zaklepa urejanja prejemnice",
      reference: `POS:NABAVA:${receipt.id}`,
      status: "draft",
      sourceType: "document",
      createdBy: "pos-receipt-booking",
    }).returning({ id: journalEntriesTable.id });

    await expect(db.transaction(tx =>
      lockPosReceiptForEdit(tx, companyId, enotaIds[0], receipt.id),
    )).resolves.toBeUndefined();

    await db.update(journalEntriesTable)
      .set({ status: "posted" })
      .where(eq(journalEntriesTable.id, entry.id));
    await expect(db.transaction(tx =>
      lockPosReceiptForEdit(tx, companyId, enotaIds[0], receipt.id),
    )).rejects.toMatchObject({ code: "RECEIPT_BOOKING_POSTED" });
  });

  it("posamična izdelava osnutka ne izbriše skupnega osnutka ali povezave sorodne prejemnice", async () => {
    const [shared] = await db.insert(journalEntriesTable).values({
      companyId,
      periodId,
      entryDate: DATE,
      documentDate: DATE,
      description: "Skupni starejši osnutek prejemnic",
      reference: `LEGACY:SHARED:PREJEMNICE:${RUN_ID}`,
      status: "draft",
      sourceType: "document",
      createdBy: "pos-sync",
    }).returning({ id: journalEntriesTable.id });
    await db.insert(posReceiptBookingSourcesTable).values([
      { prejemnicaId: receiptIds[0], journalEntryId: shared.id, netAmount: "10.00" },
      { prejemnicaId: receiptIds[1], journalEntryId: shared.id, netAmount: "20.00" },
    ]);

    const preview = await getPosReceiptBookingPreview(companyId, enotaIds[0], receiptIds[1]);
    expect(preview?.blockingErrors).toContainEqual(expect.objectContaining({
      code: "LEGACY_SHARED_DRAFT",
    }));
    await expect(savePosReceiptBookingDraft(
      companyId,
      enotaIds[1],
      receiptIds[1],
      preview!.previewHash,
    )).resolves.toBeNull();
    const result = await savePosReceiptBookingDraft(
      companyId,
      enotaIds[0],
      receiptIds[1],
      preview!.previewHash,
    );
    expect(result?.blockingErrors).toContainEqual(expect.objectContaining({
      code: "LEGACY_SHARED_DRAFT",
    }));
    expect(await db.select().from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, shared.id))).toHaveLength(1);
    expect(await db.select().from(posReceiptBookingSourcesTable)
      .where(eq(posReceiptBookingSourcesTable.journalEntryId, shared.id))).toHaveLength(2);
  });

  it("ne izbriše ročno ustvarjenega nepovezanega osnutka z enako poslovno referenco", async () => {
    const [receipt] = await db.insert(prejemniceTable).values({
      enotaId: enotaIds[0],
      dobaviteljId: supplierAId,
      datum: new Date(`${DATE}T12:00:00Z`),
    }).returning({ id: prejemniceTable.id });
    const [manual] = await db.insert(journalEntriesTable).values({
      companyId,
      periodId,
      entryDate: DATE,
      documentDate: DATE,
      description: "Ročni osnutek z rezervirano referenco",
      reference: `POS:NABAVA:${receipt.id}`,
      status: "draft",
      sourceType: "document",
      createdBy: "manual",
    }).returning({ id: journalEntriesTable.id });
    await db.insert(journalEntryLinesTable).values({
      entryId: manual.id,
      accountId: nabavaObracunAccountId,
      side: "credit",
      amount: "123.45",
      description: "NE SPREMINJAJ",
      sequence: 0,
    });

    const preview = await getPosReceiptBookingPreview(companyId, enotaIds[0], receipt.id);
    expect(preview?.blockingErrors).not.toContainEqual(expect.objectContaining({ code: "LEGACY_SHARED_DRAFT" }));
    const result = await savePosReceiptBookingDraft(companyId, enotaIds[0], receipt.id, preview!.previewHash);
    expect(result?.blockingErrors).not.toContainEqual(expect.objectContaining({ code: "LEGACY_SHARED_DRAFT" }));
    expect(await db.select({
      reference: journalEntriesTable.reference,
      createdBy: journalEntriesTable.createdBy,
      status: journalEntriesTable.status,
    }).from(journalEntriesTable).where(eq(journalEntriesTable.id, manual.id))).toEqual([{
      reference: `POS:NABAVA:${receipt.id}`,
      createdBy: "manual",
      status: "draft",
    }]);
    expect(await db.select({
      amount: journalEntryLinesTable.amount,
      description: journalEntryLinesTable.description,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, manual.id)))
      .toEqual([{ amount: "123.45", description: "NE SPREMINJAJ" }]);
  });

  it("ne izbriše povezanega osnutka napačnega izvora z enako POS:NABAVA referenco", async () => {
    const [receipt] = await db.insert(prejemniceTable).values({
      enotaId: enotaIds[0],
      dobaviteljId: supplierAId,
      datum: new Date(`${DATE}T12:00:00Z`),
    }).returning({ id: prejemniceTable.id });
    const [foreign] = await db.insert(journalEntriesTable).values({
      companyId,
      periodId,
      entryDate: DATE,
      documentDate: DATE,
      description: "Osnutek drugega generatorja",
      reference: `POS:NABAVA:${receipt.id}`,
      status: "draft",
      sourceType: "document",
      createdBy: "pos-sync",
    }).returning({ id: journalEntriesTable.id });
    await db.insert(journalEntryLinesTable).values({
      entryId: foreign.id,
      accountId: nabavaObracunAccountId,
      side: "credit",
      amount: "234.56",
      description: "TUJI OSNUTEK",
      sequence: 0,
    });
    await db.insert(posReceiptBookingSourcesTable).values({
      prejemnicaId: receipt.id,
      journalEntryId: foreign.id,
      netAmount: "234.56",
    });

    const preview = await getPosReceiptBookingPreview(companyId, enotaIds[0], receipt.id);
    expect(preview?.blockingErrors).toContainEqual(expect.objectContaining({ code: "LEGACY_SHARED_DRAFT" }));
    const result = await savePosReceiptBookingDraft(companyId, enotaIds[0], receipt.id, preview!.previewHash);
    expect(result?.blockingErrors).toContainEqual(expect.objectContaining({ code: "LEGACY_SHARED_DRAFT" }));
    expect(await db.select({
      reference: journalEntriesTable.reference,
      createdBy: journalEntriesTable.createdBy,
      status: journalEntriesTable.status,
    }).from(journalEntriesTable).where(eq(journalEntriesTable.id, foreign.id))).toEqual([{
      reference: `POS:NABAVA:${receipt.id}`,
      createdBy: "pos-sync",
      status: "draft",
    }]);
    expect(await db.select({
      amount: journalEntryLinesTable.amount,
      description: journalEntryLinesTable.description,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, foreign.id)))
      .toEqual([{ amount: "234.56", description: "TUJI OSNUTEK" }]);
  });

  it("prepozna potrjeno posamično POS:NABAVA knjižbo kot veljavno zaprtje konta 109", async () => {
    const [entry] = await db.insert(journalEntriesTable).values({
      companyId,
      periodId,
      entryDate: DATE,
      documentDate: DATE,
      description: "Posamična knjižba prejemnice",
      reference: `POS:NABAVA:${receiptIds[2]}`,
      status: "posted",
      sourceType: "document",
      createdBy: "pos-receipt-booking",
    }).returning({ id: journalEntriesTable.id });
    await db.insert(journalEntryLinesTable).values({
      entryId: entry.id,
      accountId: nabavaObracunAccountId,
      side: "credit",
      amount: "30.00",
      description: "Obračun nabave",
      sequence: 0,
    });
    await db.insert(posReceiptBookingSourcesTable).values({
      prejemnicaId: receiptIds[2],
      journalEntryId: entry.id,
      netAmount: "30.00",
    });

    await expect(isReceiptBookedTo109(
      companyId,
      receiptIds[2],
      new Date(`${DATE}T12:00:00Z`),
      enotaIds[1],
      nabavaObracunAccountId,
      "30.00",
    )).resolves.toBe(true);
    await expect(isReceiptBookedTo109(
      "00000000-0000-4000-8000-000000000000",
      receiptIds[2],
      new Date(`${DATE}T12:00:00Z`),
      enotaIds[1],
      nabavaObracunAccountId,
      "30.00",
    )).resolves.toBe(false);
  });

  it("loči temeljnice tudi, kadar dve enoti uporabljata isto stroškovno mesto", async () => {
    const [sharedEnota] = await db
      .insert(enoteTable)
      .values({
        companyId,
        ime: "Drugo Križišče",
        costCenterId: costCenters[0].id,
      })
      .returning({ id: enoteTable.id });
    enotaIds.push(sharedEnota.id);
    await createSale(sharedEnota.id, "TEST-SKUPNI-SM", "73.20");

    const result = await syncPosBookingForDay(companyId, DATE);
    const kriziščeRefs = result.created.filter(reference =>
      reference === `POS:PRODAJA:${DATE}:E${enotaIds[0]}`
      || reference === `POS:PRODAJA:${DATE}:E${sharedEnota.id}`,
    );

    expect(kriziščeRefs).toHaveLength(2);
    expect(new Set(kriziščeRefs).size).toBe(2);
    expect(kriziščeRefs).toContain(`POS:PRODAJA:${DATE}:E${enotaIds[0]}`);
    expect(kriziščeRefs).toContain(`POS:PRODAJA:${DATE}:E${sharedEnota.id}`);
  });

  it("ob preimenovanju SM nadomesti prejšnje osnutke iste enote", async () => {
    const previousCode = costCenters[0].code;
    const nextCode = "PE-KRIZISCE-NOVO";
    const stableRef = `POS:PRODAJA:${DATE}:E${enotaIds[0]}`;
    const legacyRef = `POS:PRODAJA:${DATE}:${previousCode}:E${enotaIds[0]}`;
    await db.insert(journalEntriesTable).values({
      companyId,
      periodId,
      entryDate: DATE,
      documentDate: DATE,
      description: "Legacy SM referenca",
      reference: legacyRef,
      status: "draft",
      sourceType: "document",
      createdBy: "pos-sync",
    });
    await db
      .update(costCentersTable)
      .set({ code: nextCode })
      .where(eq(costCentersTable.id, costCenters[0].id));
    costCenters[0].code = nextCode;

    await syncPosBookingForDay(companyId, DATE);

    const entries = await db
      .select({ reference: journalEntriesTable.reference })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.companyId, companyId));
    const salesRefs = entries
      .map(entry => entry.reference)
      .filter((reference): reference is string => reference?.startsWith(`POS:PRODAJA:${DATE}:`) ?? false);

    expect(salesRefs).not.toContain(legacyRef);
    expect(salesRefs).toContain(stableRef);
    expect(salesRefs).toContain(`POS:PRODAJA:${DATE}:E${enotaIds[5]}`);
  });

  it("ustvari ločene otvoritvene temeljnice tudi brez SM in ne prepisuje drugih enot", async () => {
    const result = await syncPosBookingForDay(companyId, DATE);
    const expectedRefs = [
      `POS:ZZ:2026:E${enotaIds[0]}`,
      `POS:ZZ:2026:E${enotaIds[1]}`,
      `POS:ZZ:2026:E${enotaIds[3]}`,
    ].sort();

    expect(result.created.filter(ref => ref.startsWith("POS:ZZ:2026:")).sort()).toEqual(expectedRefs);

    const entries = await db
      .select({ id: journalEntriesTable.id, reference: journalEntriesTable.reference })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.companyId, companyId));
    const openingEntries = entries.filter(entry => expectedRefs.includes(entry.reference ?? ""));
    expect(openingEntries).toHaveLength(3);
    expect(entries).not.toContainEqual(expect.objectContaining({ reference: "POS:ZZ:2026" }));

    const lines = await db
      .select({
        entryId: journalEntryLinesTable.entryId,
        costCenterId: journalEntryLinesTable.costCenterId,
      })
      .from(journalEntryLinesTable)
      .where(inArray(journalEntryLinesTable.entryId, openingEntries.map(entry => entry.id)));
    const costCentersByEntry = new Map<string, Set<string | null>>();
    for (const line of lines) {
      const centers = costCentersByEntry.get(line.entryId) ?? new Set<string | null>();
      centers.add(line.costCenterId);
      costCentersByEntry.set(line.entryId, centers);
    }
    expect(costCentersByEntry.size).toBe(3);
    expect(new Set([...costCentersByEntry.values()].map(centers => [...centers][0]))).toEqual(
      new Set([costCenters[0].id, costCenters[1].id, null]),
    );
    for (const centers of costCentersByEntry.values()) {
      expect(centers.size).toBe(1);
      expect([...centers][0] === null || Boolean([...centers][0])).toBe(true);
    }

    await syncPosBookingForDay(companyId, DATE);
    const repeatedEntries = await db
      .select({ reference: journalEntriesTable.reference })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.companyId, companyId));
    expect(
      repeatedEntries
        .map(entry => entry.reference)
        .filter((reference): reference is string => reference != null && expectedRefs.includes(reference))
        .sort(),
    ).toEqual(expectedRefs);
  });

  it("pusti KIR zbiren na ravni podjetja", async () => {
    await syncPosBookingForDay(companyId, DATE);

    const kirInvoices = await db
      .select({ invoiceNumber: invoicesTable.invoiceNumber })
      .from(invoicesTable)
      .where(and(
        eq(invoicesTable.companyId, companyId),
        eq(invoicesTable.invoiceDate, DATE),
        eq(invoicesTable.createdBy, "pos-sync"),
        eq(invoicesTable.type, "issued"),
      ));

    expect(kirInvoices).toContainEqual({ invoiceNumber: `POS-B2C-${DATE}` });
    expect(kirInvoices.filter(invoice => invoice.invoiceNumber === `POS-B2C-${DATE}`)).toHaveLength(1);
    expect(kirInvoices.some(invoice => invoice.invoiceNumber.startsWith(`POS-B2C-${DATE}:`))).toBe(false);
  });

  it("po odstranitvi SM ohrani otvoritveno temeljnico z NULL in počisti le ob izbrisu zaloge", async () => {
    const [cleanupEnota] = await db
      .insert(enoteTable)
      .values({
        companyId,
        ime: "Čiščenje otvoritve",
        costCenterId: costCenters[2].id,
      })
      .returning({ id: enoteTable.id });
    enotaIds.push(cleanupEnota.id);

    const [cleanupArtikel] = await db
      .insert(artikliTable)
      .values({
        enotaId: cleanupEnota.id,
        ime: `ZZ čiščenje ${RUN_ID}`,
        cena: "1.00",
        nabavniArtikel: true,
        vrstaArtikla: "material",
      })
      .returning({ id: artikliTable.id });
    openingArtikelIds.push(cleanupArtikel.id);

    const [cleanupZaloga] = await db
      .insert(zacetneZalogeTable)
      .values({ enotaId: cleanupEnota.id, leto: 2026, datum: new Date(`${DATE}T12:00:00Z`) })
      .returning({ id: zacetneZalogeTable.id });
    openingZalogaIds.push(cleanupZaloga.id);
    await db.insert(zacetneZalogePostavkeTable).values({
      zacetnaZalogaId: cleanupZaloga.id,
      artikelId: cleanupArtikel.id,
      kolicina: "4",
      cenaKos: "5.00",
    });

    const ref = `POS:ZZ:2026:E${cleanupEnota.id}`;
    await syncPosBookingForDay(companyId, DATE);
    expect(
      await db
        .select({ reference: journalEntriesTable.reference })
        .from(journalEntriesTable)
        .where(eq(journalEntriesTable.reference, ref)),
    ).toHaveLength(1);

    await db
      .update(enoteTable)
      .set({ costCenterId: null })
      .where(eq(enoteTable.id, cleanupEnota.id));
    const noSmSync = await syncPosBookingForDay(companyId, DATE);
    expect(noSmSync.created).toContain(ref);
    const [noSmEntry] = await db
      .select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.reference, ref));
    expect(noSmEntry).toBeTruthy();
    expect(
      await db
        .select({ costCenterId: journalEntryLinesTable.costCenterId })
        .from(journalEntryLinesTable)
        .where(eq(journalEntryLinesTable.entryId, noSmEntry.id)),
    ).toEqual(expect.arrayContaining([{ costCenterId: null }]));

    await db
      .update(enoteTable)
      .set({ costCenterId: costCenters[2].id })
      .where(eq(enoteTable.id, cleanupEnota.id));
    expect(
      await bookZacetnaZaloga(companyId, cleanupEnota.id, 2026, DATE, [
        { vrstaArtikla: "material", kolicina: 4, cenaKos: 5 },
        { vrstaArtikla: "material", kolicina: 3, cenaKos: 900, drobniInventar: true },
      ]),
    ).toMatchObject({ created: ref, skipped: null });
    const openingLines = await db
      .select({ side: journalEntryLinesTable.side, amount: journalEntryLinesTable.amount })
      .from(journalEntryLinesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
      .where(eq(journalEntriesTable.reference, ref));
    expect(openingLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ side: "debit", amount: "20.00" }),
      expect.objectContaining({ side: "credit", amount: "20.00" }),
    ]));
    expect(openingLines).toHaveLength(2);

    await db.delete(zacetneZalogePostavkeTable)
      .where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, cleanupZaloga.id));
    await db.delete(zacetneZalogeTable).where(eq(zacetneZalogeTable.id, cleanupZaloga.id));
    await db
      .update(enoteTable)
      .set({ costCenterId: null })
      .where(eq(enoteTable.id, cleanupEnota.id));
    expect(
      await bookZacetnaZaloga(companyId, cleanupEnota.id, 2026, DATE, []),
    ).toMatchObject({
      created: null,
      skipped: null,
    });
    expect(
      await db
        .select({ reference: journalEntriesTable.reference })
        .from(journalEntriesTable)
        .where(eq(journalEntriesTable.reference, ref)),
    ).toHaveLength(0);
  });

  it("ne podvoji potrjene stare zbirne temeljnice prejemnic s temeljnicami po enotah", async () => {
    await db
      .delete(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.status, "draft"),
        like(journalEntriesTable.reference, `POS:PREJEMNICA:${DATE}:%:E%`),
      ));
    await db.insert(journalEntriesTable).values([
      {
        companyId,
        periodId,
        entryDate: DATE,
        documentDate: DATE,
        description: "Osnutek temeljnice prejemnic po enoti",
        reference: `POS:PREJEMNICA:${DATE}:E${enotaIds[0]}`,
        status: "draft",
        sourceType: "document",
        createdBy: "pos-sync",
      },
      {
        companyId,
        periodId,
        entryDate: DATE,
        documentDate: DATE,
        description: "Potrjena stara zbirna temeljnica prejemnic",
        reference: `POS:PREJEMNICA:${DATE}`,
        status: "posted",
        sourceType: "document",
        createdBy: "pos-sync",
      },
    ]);

    const result = await syncPosBookingForDay(companyId, DATE);
    expect(result.skipped).toContainEqual(expect.objectContaining({
      ref: `POS:PREJEMNICA:${DATE}:E${enotaIds[0]}`,
      reason: "Potrjena zbirna temeljnica prejemnic je ohranjena; novi osnutki se ustvarjajo po posamezni prejemnici",
    }));
    expect(
      await db
        .select({ reference: journalEntriesTable.reference })
        .from(journalEntriesTable)
        .where(and(
          eq(journalEntriesTable.companyId, companyId),
          eq(journalEntriesTable.status, "draft"),
          eq(journalEntriesTable.reference, `POS:PREJEMNICA:${DATE}:E${enotaIds[0]}`),
        )),
    ).toEqual([{ reference: `POS:PREJEMNICA:${DATE}:E${enotaIds[0]}` }]);
    expect(
      await db
        .select({ status: journalEntriesTable.status })
        .from(journalEntriesTable)
        .where(and(
          eq(journalEntriesTable.companyId, companyId),
          eq(journalEntriesTable.reference, `POS:PREJEMNICA:${DATE}`),
        )),
    ).toEqual([{ status: "posted" }]);
  });

  it("običajni dnevni sync ohrani starejši zbirni osnutek prejemnic", async () => {
    const legacyDate = "2026-08-20";
    const reference = `POS:PREJEMNICA:${legacyDate}`;
    const [legacy] = await db.insert(journalEntriesTable).values({
      companyId,
      periodId,
      entryDate: legacyDate,
      documentDate: legacyDate,
      description: "Starejši zbirni osnutek prejemnic",
      reference,
      status: "draft",
      sourceType: "document",
      createdBy: "pos-sync",
    }).returning({ id: journalEntriesTable.id });

    await syncPosBookingForDay(companyId, legacyDate);

    expect(await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, legacy.id))).toEqual([{ id: legacy.id }]);
  });

  it("knjiži SŠP subvencijo na terjatev s partnerjem in pripravi eno odprto postavko", async () => {
    const [center] = await db.insert(costCentersTable)
      .values({ companyId, code: "PE-SSP", name: "Študentski boni", isActive: true })
      .returning({ id: costCentersTable.id, code: costCentersTable.code });
    costCenters.push(center);
    const [enota] = await db.insert(enoteTable)
      .values({ companyId, ime: "Študentski boni", costCenterId: center.id })
      .returning({ id: enoteTable.id });
    enotaIds.push(enota.id);
    const subsidyAccountId = await createAccount("1650", "asset");
    const [subsidyPartner] = await db.insert(counterpartiesTable)
      .values({ companyId, type: "customer", name: `MDDSZ/ŠOS ${RUN_ID}` })
      .returning({ id: counterpartiesTable.id });
    await db.update(posBookingSettingsTable)
      .set({ subsidyReceivableAccountId: subsidyAccountId, subsidyCounterpartyId: subsidyPartner.id })
      .where(eq(posBookingSettingsTable.companyId, companyId));

    const [order] = await db.insert(narocilaTable)
      .values({ enotaId: enota.id, status: "zakljuceno", skupaj: "12.20" })
      .returning({ id: narocilaTable.id });
    const [receipt] = await db.insert(racuniTable).values({
      enotaId: enota.id,
      narociloId: order.id,
      stevilkaRacuna: `TEST-SSP-${RUN_ID}`,
      skupaj: "12.20",
      ddv: "2.20",
      osnova: "10.00",
      placilnaNacin: "gotovina",
      status: "poslan",
      datumCas: new Date(`${DATE}T12:00:00+02:00`),
      znesekGotovina: "7.20",
      znesekKartica: "0.00",
      znesekBon: "0.00",
      znesekBonPica: "0.00",
      znesekSubvencija: "5.00",
      sspReferenca: "NFC-SSP-TEST",
      znesekNegotovinsko: "0.00",
    }).returning({ id: racuniTable.id });
    await db.insert(postavkeTable).values({
      narociloId: order.id,
      racunId: receipt.id,
      ime: "Študentski obrok",
      kolicina: 1,
      cenaKos: "12.20",
      skupaj: "12.20",
      davek: "22.00",
      vrstaArtikla: "storitev",
    });

    await syncPosBookingForDay(companyId, DATE);
    const reference = `POS:PRODAJA:${DATE}:E${enota.id}`;
    const [entry] = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable).where(eq(journalEntriesTable.reference, reference));
    const lines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
      partnerId: journalEntryLinesTable.partnerId,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, entry.id));
    expect(lines).toContainEqual({
      accountId: subsidyAccountId,
      side: "debit",
      amount: "5.00",
      partnerId: subsidyPartner.id,
    });

    const [invoice] = await db.select({
      status: invoicesTable.status,
      counterpartyId: invoicesTable.counterpartyId,
      linkedEntryId: invoicesTable.linkedEntryId,
    }).from(invoicesTable).where(and(
      eq(invoicesTable.companyId, companyId),
      eq(invoicesTable.invoiceNumber, `POS-SSP-${DATE}-E${enota.id}`),
    ));
    expect(invoice).toEqual({
      status: "draft",
      counterpartyId: subsidyPartner.id,
      linkedEntryId: entry.id,
    });
  });

  it("darilni boni knjiži na 230 ločeno od bona za pico in brez prihodka ali DDV ob izdaji", async () => {
    const [center] = await db.insert(costCentersTable)
      .values({ companyId, code: "PE-BON", name: "Darilni boni", isActive: true })
      .returning({ id: costCentersTable.id, code: costCentersTable.code });
    costCenters.push(center);
    const [enota] = await db.insert(enoteTable)
      .values({ companyId, ime: "Boni", costCenterId: center.id })
      .returning({ id: enoteTable.id });
    enotaIds.push(enota.id);

    const advancePaymentsAccountId = await createAccount("2300", "liability");
    const pizzaVoucherAccountId = await createAccount("1200", "asset");
    await db.update(posBookingSettingsTable)
      .set({ advancePaymentsAccountId, voucherAccountId: pizzaVoucherAccountId })
      .where(eq(posBookingSettingsTable.companyId, companyId));

    const [issueOrder] = await db.insert(narocilaTable)
      .values({ enotaId: enota.id, status: "zakljuceno", skupaj: "30.00" })
      .returning({ id: narocilaTable.id });
    const [issueReceipt] = await db.insert(racuniTable).values({
      enotaId: enota.id,
      narociloId: issueOrder.id,
      stevilkaRacuna: `TEST-BON-IZDAJA-${RUN_ID}`,
      skupaj: "30.00",
      ddv: "0.00",
      osnova: "30.00",
      placilnaNacin: "gotovina",
      status: "poslan",
      datumCas: new Date(`${DATE}T11:00:00+02:00`),
      znesekGotovina: "30.00",
      znesekKartica: "0.00",
      znesekBon: "0.00",
      znesekBonPica: "0.00",
      znesekNegotovinsko: "0.00",
      jeDarilniBonIzdaja: true,
    }).returning({ id: racuniTable.id });
    await db.insert(postavkeTable).values({
      narociloId: issueOrder.id,
      racunId: issueReceipt.id,
      ime: "Darilni bon",
      kolicina: 1,
      cenaKos: "30.00",
      skupaj: "30.00",
      davek: "0.00",
      vrstaArtikla: "storitev",
    });

    const [redeemOrder] = await db.insert(narocilaTable)
      .values({ enotaId: enota.id, status: "zakljuceno", skupaj: "12.20" })
      .returning({ id: narocilaTable.id });
    const [redeemReceipt] = await db.insert(racuniTable).values({
      enotaId: enota.id,
      narociloId: redeemOrder.id,
      stevilkaRacuna: `TEST-BON-UNOVCITEV-${RUN_ID}`,
      skupaj: "12.20",
      ddv: "2.20",
      osnova: "10.00",
      placilnaNacin: "bon",
      status: "poslan",
      datumCas: new Date(`${DATE}T12:00:00+02:00`),
      znesekGotovina: "0.00",
      znesekKartica: "0.00",
      znesekBon: "10.00",
      znesekBonPica: "2.20",
      znesekNegotovinsko: "0.00",
    }).returning({ id: racuniTable.id });
    await db.insert(postavkeTable).values({
      narociloId: redeemOrder.id,
      racunId: redeemReceipt.id,
      ime: "Obdavčena storitev",
      kolicina: 1,
      cenaKos: "12.20",
      skupaj: "12.20",
      davek: "22.00",
      vrstaArtikla: "storitev",
    });

    const result = await syncPosBookingForDay(companyId, DATE);
    const ref = `POS:PRODAJA:${DATE}:E${enota.id}`;
    expect(result.created).toContain(ref);
    const [entry] = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(eq(journalEntriesTable.reference, ref));
    const lines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, entry.id));

    expect(lines).toContainEqual(expect.objectContaining({
      accountId: advancePaymentsAccountId, side: "credit", amount: "30.00",
    }));
    expect(lines).toContainEqual(expect.objectContaining({
      accountId: advancePaymentsAccountId, side: "debit", amount: "10.00",
    }));
    expect(lines).toContainEqual(expect.objectContaining({
      accountId: pizzaVoucherAccountId, side: "debit", amount: "2.20",
    }));

    // Izdaja darilnega bona je predplačilo: tudi KIR je ne sme pretvoriti v
    // 0-% prihodek. Edina KIR vrstica tega dodatnega prometa je unovčitev 22 %.
    const kirInvoices = await db.select({ id: invoicesTable.id, invoiceNumber: invoicesTable.invoiceNumber })
      .from(invoicesTable)
      .where(and(
        eq(invoicesTable.companyId, companyId),
        eq(invoicesTable.invoiceDate, DATE),
        eq(invoicesTable.createdBy, "pos-sync"),
        eq(invoicesTable.type, "issued"),
      ));
    const kirLines = await db.select({ vatRate: invoiceLinesTable.vatRate })
      .from(invoiceLinesTable)
      .where(inArray(
        invoiceLinesTable.invoiceId,
        kirInvoices
          .filter(invoice => !invoice.invoiceNumber.startsWith("POS-SSP-"))
          .map(invoice => invoice.id),
      ));
    expect(kirLines.some(line => Number(line.vatRate) === 0)).toBe(false);
  });

  it("knjiži 5 % na eksplicitne prihodkovne in DDV konte v T1, T4 ter A-računu/KIR", async () => {
    const [center] = await db.insert(costCentersTable)
      .values({ companyId, code: "PE-DDV5", name: "DDV 5 %", isActive: true })
      .returning({ id: costCentersTable.id, code: costCentersTable.code });
    costCenters.push(center);
    const [enota] = await db.insert(enoteTable)
      .values({ companyId, ime: "Matrika DDV 5 %", costCenterId: center.id })
      .returning({ id: enoteTable.id });
    enotaIds.push(enota.id);

    const [
      material5AccountId,
      goods5AccountId,
      service5AccountId,
      vat5AccountId,
      ownUseAccountId,
    ] = await Promise.all([
      createAccount("7650", "revenue"),
      createAccount("7660", "revenue"),
      createAccount("7605", "revenue"),
      createAccount("2605", "liability"),
      createAccount("4890", "asset"),
    ]);
    const [vat5Code] = await db.select({ id: vatCodeTable.id }).from(vatCodeTable)
      .where(and(eq(vatCodeTable.code, "S5"), eq(vatCodeTable.direction, "OUT")))
      .limit(1);
    expect(vat5Code).toBeTruthy();
    await db.update(posBookingSettingsTable).set({
      revenueMaterial5AccountId: material5AccountId,
      revenueGoods5AccountId: goods5AccountId,
      revenueService5AccountId: service5AccountId,
      vat5AccountId,
      vat5VatCodeId: vat5Code!.id,
      lastnaPorabaAccountId: ownUseAccountId,
    }).where(eq(posBookingSettingsTable.companyId, companyId));

    const [customer] = await db.insert(counterpartiesTable)
      .values({ companyId, type: "customer", name: `Kupec DDV 5 % ${RUN_ID}`, taxId: "12345678" })
      .returning({ id: counterpartiesTable.id });

    async function createFivePercentReceipt(
      number: string,
      vrstaArtikla: "material" | "blago" | "storitev",
      placilnaNacin: "gotovina" | "lastna_poraba" | "negotovinsko",
      kupecCpId?: string,
    ) {
      const [order] = await db.insert(narocilaTable)
        .values({ enotaId: enota.id, status: "zakljuceno", skupaj: "105.00" })
        .returning({ id: narocilaTable.id });
      const [receipt] = await db.insert(racuniTable).values({
        enotaId: enota.id,
        narociloId: order.id,
        stevilkaRacuna: number,
        skupaj: "105.00",
        ddv: "5.00",
        osnova: "100.00",
        placilnaNacin,
        status: "poslan",
        datumCas: new Date(`${DATE}T14:00:00+02:00`),
        kupecCpId: kupecCpId ?? null,
        kupecDavcnaStevilka: kupecCpId ? "12345678" : null,
        kupecNaziv: kupecCpId ? `Kupec DDV 5 % ${RUN_ID}` : null,
        znesekGotovina: placilnaNacin === "gotovina" ? "105.00" : "0.00",
        znesekKartica: "0.00",
        znesekBon: "0.00",
        znesekBonPica: "0.00",
        znesekNegotovinsko: placilnaNacin === "negotovinsko" ? "105.00" : "0.00",
      }).returning({ id: racuniTable.id });
      await db.insert(postavkeTable).values({
        narociloId: order.id,
        racunId: receipt.id,
        ime: `5 % ${vrstaArtikla}`,
        kolicina: 1,
        cenaKos: "105.00",
        skupaj: "105.00",
        davek: "5.00",
        vrstaArtikla,
      });
    }

    await Promise.all([
      createFivePercentReceipt(`DDV5-MATERIAL-${RUN_ID}`, "material", "gotovina"),
      createFivePercentReceipt(`DDV5-BLAGO-${RUN_ID}`, "blago", "gotovina"),
      createFivePercentReceipt(`DDV5-STORITEV-${RUN_ID}`, "storitev", "gotovina"),
      createFivePercentReceipt(`DDV5-T4-${RUN_ID}`, "material", "lastna_poraba"),
      createFivePercentReceipt(`DDV5-AR-${RUN_ID}`, "storitev", "negotovinsko", customer.id),
    ]);

    const result = await syncPosBookingForDay(companyId, DATE);
    const t1Ref = `POS:PRODAJA:${DATE}:E${enota.id}`;
    const t4Ref = `POS:LASTREPR:${DATE}:E${enota.id}`;
    const arRef = `POS:AR:DDV5-AR-${RUN_ID}`;
    expect(result.created).toEqual(expect.arrayContaining([t1Ref, t4Ref]));

    const entries = await db.select({ id: journalEntriesTable.id, reference: journalEntriesTable.reference })
      .from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.companyId, companyId), inArray(journalEntriesTable.reference, [t1Ref, t4Ref, arRef])));
    const lines = await db.select({
      entryId: journalEntryLinesTable.entryId,
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
      vatCodeId: journalEntryLinesTable.vatCodeId,
    }).from(journalEntryLinesTable).where(inArray(journalEntryLinesTable.entryId, entries.map(entry => entry.id)));
    const linesFor = (reference: string) => lines.filter(line => line.entryId === entries.find(entry => entry.reference === reference)?.id);

    expect(linesFor(t1Ref)).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: material5AccountId, side: "credit", amount: "100.00", vatCodeId: vat5Code!.id }),
      expect.objectContaining({ accountId: goods5AccountId, side: "credit", amount: "100.00", vatCodeId: vat5Code!.id }),
      expect.objectContaining({ accountId: service5AccountId, side: "credit", amount: "100.00", vatCodeId: vat5Code!.id }),
      expect.objectContaining({ accountId: vat5AccountId, side: "credit", amount: "15.00", vatCodeId: null }),
    ]));
    expect(linesFor(t4Ref)).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: material5AccountId, side: "credit", amount: "100.00", vatCodeId: vat5Code!.id }),
      expect.objectContaining({ accountId: vat5AccountId, side: "credit", amount: "5.00", vatCodeId: null }),
    ]));
    expect(linesFor(arRef)).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: service5AccountId, side: "credit", amount: "100.00", vatCodeId: vat5Code!.id }),
      expect.objectContaining({ accountId: vat5AccountId, side: "credit", amount: "5.00", vatCodeId: null }),
    ]));

    const [arInvoice] = await db.select({ id: invoicesTable.id })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.companyId, companyId), eq(invoicesTable.invoiceNumber, `POS-DDV5-AR-${RUN_ID}`)));
    const kirLines = await db.select({
      accountId: invoiceLinesTable.accountId,
      vatRate: invoiceLinesTable.vatRate,
      vatBase: invoiceLinesTable.vatBase,
      vatAmount: invoiceLinesTable.vatAmount,
    }).from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, arInvoice!.id));
    expect(kirLines).toContainEqual(expect.objectContaining({
      accountId: service5AccountId,
      vatRate: "5.00",
      vatBase: "100.00",
      vatAmount: "5.00",
    }));
  });

  it("izbriše osnutek, njegove vrstice in POS povezavo ter ohrani audit", async () => {
    const [receipt] = await db.insert(prejemniceTable).values({
      enotaId: enotaIds[0],
      dobaviteljId: supplierAId,
      datum: new Date(`${DATE}T12:00:00Z`),
      status: "confirmed",
    }).returning({ id: prejemniceTable.id });
    const [entry] = await db.insert(journalEntriesTable).values({
      companyId,
      periodId,
      entryDate: DATE,
      documentDate: DATE,
      description: "Osnutek za brisanje",
      reference: `DELETE-${RUN_ID}`,
      status: "draft",
      sourceType: "document",
      createdBy: "pos-receipt-booking",
    }).returning({ id: journalEntriesTable.id });
    await db.insert(journalEntryLinesTable).values({
      entryId: entry.id,
      accountId: nabavaObracunAccountId,
      side: "debit",
      amount: "10.00",
      sequence: 0,
    });
    await db.insert(posReceiptBookingSourcesTable).values({
      prejemnicaId: receipt.id,
      journalEntryId: entry.id,
      netAmount: "10.00",
    });

    await expect(deleteDraftJournalEntry(companyId, entry.id, "test-user")).resolves.toEqual(
      expect.objectContaining({ id: entry.id, status: "draft" }),
    );
    expect(await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, entry.id))).toHaveLength(0);
    expect(await db.select().from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, entry.id))).toHaveLength(0);
    expect(await db.select().from(posReceiptBookingSourcesTable).where(eq(posReceiptBookingSourcesTable.journalEntryId, entry.id))).toHaveLength(0);
    expect(await db.select().from(auditLogTable).where(and(
      eq(auditLogTable.entityId, entry.id),
      eq(auditLogTable.action, "delete_draft"),
    ))).toHaveLength(1);
  });

  it("ne dovoli brisanja knjižene temeljnice", async () => {
    const [entry] = await db.insert(journalEntriesTable).values({
      companyId,
      periodId,
      entryDate: DATE,
      documentDate: DATE,
      description: "Knjižena temeljnica",
      reference: `POSTED-DELETE-${RUN_ID}`,
      status: "posted",
      sourceType: "manual",
      createdBy: "test-user",
    }).returning({ id: journalEntriesTable.id });

    await expect(deleteDraftJournalEntry(companyId, entry.id, "test-user")).rejects.toMatchObject({
      code: "NOT_DELETABLE",
    });
    expect(await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, entry.id))).toHaveLength(1);
  });
});