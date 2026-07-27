/**
 * vatLedger.ts — Samodejno knjiženje DDV v vat_ledger ob potrditvi temeljnice
 *
 * Spec: ERP 3. del, naloga #133
 *
 * Vstopna točka:
 *   - createVatLedgerEntries()  → ob POST .../entries/:id/post
 *   - reverseVatLedgerEntries() → ob POST .../entries/:id/reverse
 *
 * Logika:
 *   - Za vsako vrstico temeljnice z vatCodeId ustvari vrstico v vat_ledger.
 *   - Samoobdavčitve (is_reverse_charge || is_import) generirajo par (IN + OUT).
 *   - Tax point se izračuna po pravilih ZDDV-1 (34. člen za EU pridobitve).
 *   - vat_period se izpelje iz tax_point_date.
 */

import Decimal from "decimal.js";
import { eq, inArray } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import {
  vatCodeTable,
  vatLedgerTable,
  counterpartiesTable,
  journalEntriesTable,
} from "@workspace/db";
import type { VatCodeFurs, NewVatLedger } from "@workspace/db";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VatLine {
  /** journal_entry_lines.id */
  lineId: string;
  /** FURS koda (FK na vat_code.id) */
  vatCodeId: string;
  /** Osnova (= journal_entry_lines.amount) */
  amount: string;
  /** DDV znesek */
  vatAmount: string | null;
  /** Odbitni delež v % (0-100) */
  vatDeductionPercent: string | null;
  /** Poslovni partner (FK na counterparties) */
  partnerId: string | null;
  /** Opis vrstice (za document_no fallback) */
  description: string | null;
}

export interface EntryMeta {
  id: string;
  companyId: string;
  /** Datum listine (dokumenta) */
  documentDate: string | null;
  /** Datum knjiženja */
  entryDate: string;
  /** Davčni datum (če nastavljeno) */
  taxDate: string | null;
  /** Zunanja referenca (npr. številka računa) */
  reference: string | null;
  /** Vrsta vira (manual, document, bank_import, ai_suggestion) */
  sourceType: string;
}

// ── Pomožne funkcije ──────────────────────────────────────────────────────────

/**
 * Izračuna tax_point_date po pravilih ZDDV-1.
 *
 * Pravila:
 *  - direction='OUT': datum listine (P4)
 *  - direction='IN' (redne nabave): datum prejema = documentDate
 *  - EU pridobitev blaga (EUB*): MIN(15. dan naslednjega meseca po pridobitvi, datum računa)
 *  - Vse ostale: documentDate ?? entryDate
 */
function calcTaxPoint(
  vatCode: VatCodeFurs,
  documentDate: string | null,
  entryDate: string,
): string {
  const invoiceDate = documentDate ?? entryDate;

  // EU pridobitev blaga: 34. člen ZDDV-1
  if (vatCode.code.startsWith("EUB")) {
    const invoiceDateObj = new Date(invoiceDate + "T00:00:00Z");
    // 15. dan meseca po pridobitvi
    const acqDate = new Date(entryDate + "T00:00:00Z");
    const fifteenthNextMonth = new Date(
      Date.UTC(acqDate.getUTCFullYear(), acqDate.getUTCMonth() + 1, 15),
    );
    const taxPoint =
      invoiceDateObj <= fifteenthNextMonth ? invoiceDateObj : fifteenthNextMonth;
    return taxPoint.toISOString().slice(0, 10);
  }

  return invoiceDate;
}

/**
 * Pretvori datum v DDV obdobje v obliki 'MMMM' (npr. '0707' za julij).
 * Predpostavka: mesečno poročanje. Trimesečno bo podprto v UI (#134).
 */
function vatPeriodFromDate(dateStr: string): { vatPeriod: string; vatPeriodYear: number } {
  const d = new Date(dateStr + "T00:00:00Z");
  const month = d.getUTCMonth() + 1; // 1–12
  const year = d.getUTCFullYear();
  const vatPeriod = `07${String(month).padStart(2, "0")}`;
  return { vatPeriod, vatPeriodYear: year };
}

/**
 * Pretvori taxId partnerja v obliko brez kode države (P6DS / P7DS).
 * Npr. 'SI12345678' → '12345678'; 'DE123456789' → '123456789'
 */
function stripCountryFromTaxId(taxId: string | null): string | null {
  if (!taxId) return null;
  // Odstrani ISO kodo države (2 črki) na začetku, če obstaja
  return taxId.replace(/^[A-Z]{2}/, "");
}

// ── Glavni executor ────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTx = PgTransaction<any, any, any>;

/**
 * Ustvari vrstice v vat_ledger za vse temeljnične vrstice z vatCodeId.
 * Pokliči ZNOTRAJ obstoječe transakcije ob POST .../entries/:id/post.
 *
 * @param tx        Drizzle transakcija (že odprta)
 * @param entry     Metapodatki temeljnice
 * @param lines     Vrstice temeljnice (samo tiste z vatCodeId)
 * @param clerkUserId  Clerk user ID
 * @param invoiceId  FK na invoices (opcijsko)
 * @param documentId FK na documents (opcijsko)
 */
export async function createVatLedgerEntries(
  tx: AnyTx,
  entry: EntryMeta,
  lines: VatLine[],
  clerkUserId: string,
  invoiceId?: string | null,
  documentId?: string | null,
): Promise<void> {
  const vatLines = lines.filter((l) => l.vatCodeId);
  if (vatLines.length === 0) return;

  // Pridobi vse DDV kode v enem koraku
  const vatCodeIds = [...new Set(vatLines.map((l) => l.vatCodeId))];
  const vatCodes = await tx
    .select()
    .from(vatCodeTable)
    .where(inArray(vatCodeTable.id, vatCodeIds));
  const vatCodeMap = new Map<string, VatCodeFurs>(vatCodes.map((vc) => [vc.id, vc]));

  // Pridobi partnerje (za snapshot)
  const partnerIds = [...new Set(vatLines.map((l) => l.partnerId).filter(Boolean))] as string[];
  const partners = partnerIds.length
    ? await tx
        .select({
          id: counterpartiesTable.id,
          name: counterpartiesTable.name,
          taxId: counterpartiesTable.taxId,
          country: counterpartiesTable.country,
        })
        .from(counterpartiesTable)
        .where(inArray(counterpartiesTable.id, partnerIds))
    : [];
  const partnerMap = new Map(partners.map((p) => [p.id, p]));

  const postingDate = entry.entryDate;
  const documentNo = entry.reference ?? `JE-${entry.id.slice(0, 8)}`;

  for (const line of vatLines) {
    const vatCode = vatCodeMap.get(line.vatCodeId);
    if (!vatCode) continue;

    const baseAmount = new Decimal(line.amount);
    const vatAmountRaw = new Decimal(line.vatAmount ?? "0");
    const deductionPct = new Decimal(line.vatDeductionPercent ?? "100");

    // Oproščene kode (rate = 0 in brez vatField) nimajo DDV → vat_amount = 0
    const hasVat = Number(vatCode.rate) > 0;
    const vatAmount = hasVat ? vatAmountRaw : new Decimal(0);

    // Odbitni delež: deductibleVat + nonDeductibleVat = vatAmount
    const deductibleVat = vatAmount.mul(deductionPct).div(100).toDecimalPlaces(2);
    const nonDeductibleVat = vatAmount.sub(deductibleVat).toDecimalPlaces(2);

    const taxPointDate = calcTaxPoint(vatCode, entry.documentDate, entry.entryDate);
    const { vatPeriod, vatPeriodYear } = vatPeriodFromDate(taxPointDate);

    const partner = line.partnerId ? partnerMap.get(line.partnerId) : null;
    const partnerCountryCode = partner?.country?.slice(0, 2) ?? null;
    const partnerVatId = stripCountryFromTaxId(partner?.taxId ?? null);
    const partnerName = partner?.name ?? null;

    // Validacija: dobave v EU (SEU-B) zahtevajo partner_vat_id
    if (vatCode.code === "SEU-B" && !partnerVatId) {
      throw new Error(
        `Dobava blaga v EU (${vatCode.code}) zahteva ID za DDV partnerja. ` +
        `Vnesite ga pri poslovnem partnerju pred potrditvijo.`,
      );
    }

    const receiptDate =
      vatCode.direction === "IN" ? (entry.documentDate ?? entry.entryDate) : null;

    const invoiceDate = entry.documentDate ?? entry.entryDate;
    const serviceDate = entry.documentDate ?? entry.entryDate;

    // ── Reverse charge: dve vrstici (IN + OUT) ───────────────────────────────
    if (vatCode.isReverseCharge || vatCode.isImport) {
      // Vrstica IN (KPR — nabava in odbitek)
      const inRow: NewVatLedger = {
        journalEntryId: entry.id,
        invoiceId: invoiceId ?? null,
        documentId: documentId ?? null,
        partnerId: line.partnerId ?? null,
        partnerCountryCode,
        partnerVatId,
        partnerName,
        vatCodeId: vatCode.id,
        direction: "IN",
        pairId: null, // nastavimo po vstavitvi OUT vrstice
        assetType: "NONE",
        invoiceDate,
        serviceDate,
        receiptDate,
        postingDate,
        taxPointDate,
        vatPeriod,
        vatPeriodYear,
        baseAmount: baseAmount.toFixed(2),
        vatAmount: deductibleVat.toFixed(2),
        nonDeductibleVat: nonDeductibleVat.toFixed(2),
        deductionPercent: deductionPct.toFixed(2),
        documentNo,
        treatment: 1,
        createdBy: clerkUserId,
      };

      // Vrstica OUT (KIR — obračunani DDV pri samoobdavčitvi)
      const outRow: NewVatLedger = {
        journalEntryId: entry.id,
        invoiceId: invoiceId ?? null,
        documentId: documentId ?? null,
        partnerId: line.partnerId ?? null,
        partnerCountryCode,
        partnerVatId,
        partnerName,
        vatCodeId: vatCode.id,
        direction: "OUT",
        pairId: null, // bo nastavljen na IN.id
        assetType: "NONE",
        invoiceDate,
        serviceDate,
        receiptDate: null,
        postingDate,
        taxPointDate,
        vatPeriod,
        vatPeriodYear,
        // Za OUT stran pri RC: osnova je enaka, DDV = obračunani
        baseAmount: baseAmount.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        nonDeductibleVat: "0.00",
        deductionPercent: "100.00",
        documentNo,
        treatment: 1,
        createdBy: clerkUserId,
      };

      // Vstavi najprej IN, ker OUT kaže na IN s pair_id
      const [inInserted] = await tx
        .insert(vatLedgerTable)
        .values(inRow)
        .returning({ id: vatLedgerTable.id });

      outRow.pairId = inInserted.id;
      const [outInserted] = await tx
        .insert(vatLedgerTable)
        .values(outRow)
        .returning({ id: vatLedgerTable.id });

      // Nastavi pair_id na IN vrstico (kaže na OUT)
      await tx
        .update(vatLedgerTable)
        .set({ pairId: outInserted.id })
        .where(eq(vatLedgerTable.id, inInserted.id));
    } else {
      // ── Navadna (ne-RC) vrstica ──────────────────────────────────────────
      const row: NewVatLedger = {
        journalEntryId: entry.id,
        invoiceId: invoiceId ?? null,
        documentId: documentId ?? null,
        partnerId: line.partnerId ?? null,
        partnerCountryCode,
        partnerVatId,
        partnerName,
        vatCodeId: vatCode.id,
        direction: vatCode.direction as "IN" | "OUT",
        assetType: "NONE",
        invoiceDate,
        serviceDate,
        receiptDate,
        postingDate,
        taxPointDate,
        vatPeriod,
        vatPeriodYear,
        baseAmount: baseAmount.toFixed(2),
        vatAmount: vatCode.direction === "IN" ? deductibleVat.toFixed(2) : vatAmount.toFixed(2),
        nonDeductibleVat: vatCode.direction === "IN" ? nonDeductibleVat.toFixed(2) : "0.00",
        deductionPercent: deductionPct.toFixed(2),
        documentNo,
        treatment: 1,
        createdBy: clerkUserId,
      };

      await tx.insert(vatLedgerTable).values(row);
    }
  }
}

/**
 * Stornira vat_ledger vrstice originalnega vnosa.
 * Pokliči ZNOTRAJ obstoječe transakcije ob POST .../entries/:id/reverse.
 *
 * Logika:
 * - Kopira vse vrstice originalnega vnosa z negiranimi zneski (base_amount, vat_amount).
 * - Nastavi reversed_by_id na id storno vrstice.
 * - Originalne vrstice dobijo reversed_by_id = nova vrstica.
 * - Nepotrjene vrstice (reported_at IS NULL) se smejo stornirati.
 *
 * @param tx              Drizzle transakcija
 * @param originalEntryId ID originalnega journal_entry
 * @param reversalEntryId ID storno journal_entry
 * @param clerkUserId     Clerk user ID
 * @param postingDate     Datum storno knjiženja (entry_date storno temeljnice)
 */
export async function reverseVatLedgerEntries(
  tx: AnyTx,
  originalEntryId: string,
  reversalEntryId: string,
  clerkUserId: string,
  postingDate: string,
): Promise<void> {
  // Pridobi originalne vat_ledger vrstice
  const originals = await tx
    .select()
    .from(vatLedgerTable)
    .where(eq(vatLedgerTable.journalEntryId, originalEntryId));

  if (originals.length === 0) return;

  // Preverimo da nobena ni oddana (reported_at IS NOT NULL)
  const reported = originals.filter((r) => r.reportedAt != null);
  if (reported.length > 0) {
    throw new Error(
      `${reported.length} DDV vrstic je že vključenih v oddano evidenco ` +
      `(obdobje: ${reported[0].reportedPeriod}). Storiranje ni dovoljeno.`,
    );
  }

  // Vstavi storno vrstice (negativni zneski)
  for (const orig of originals) {
    const storno: NewVatLedger = {
      journalEntryId: reversalEntryId,
      invoiceId: orig.invoiceId,
      documentId: orig.documentId,
      partnerId: orig.partnerId,
      partnerCountryCode: orig.partnerCountryCode,
      partnerVatId: orig.partnerVatId,
      partnerName: orig.partnerName,
      vatCodeId: orig.vatCodeId,
      direction: orig.direction as "IN" | "OUT",
      assetType: (orig.assetType ?? "NONE") as "NONE" | "REALESTATE" | "OTHER_FA",
      invoiceDate: orig.invoiceDate,
      serviceDate: orig.serviceDate,
      receiptDate: orig.receiptDate,
      postingDate,
      taxPointDate: orig.taxPointDate,
      vatPeriod: orig.vatPeriod,
      vatPeriodYear: orig.vatPeriodYear,
      // Negirani zneski = storno
      baseAmount: new Decimal(orig.baseAmount).negated().toFixed(2),
      vatAmount: new Decimal(orig.vatAmount ?? "0").negated().toFixed(2),
      nonDeductibleVat: new Decimal(orig.nonDeductibleVat ?? "0").negated().toFixed(2),
      deductionPercent: orig.deductionPercent ?? "100.00",
      documentNo: `STORNO:${orig.documentNo}`,
      mrn: orig.mrn,
      remarks: `Storno vrstice ${orig.id}`,
      treatment: 1,
      createdBy: clerkUserId,
    };

    const [inserted] = await tx
      .insert(vatLedgerTable)
      .values(storno)
      .returning({ id: vatLedgerTable.id });

    // Označi originalno vrstico z reversed_by_id
    await tx
      .update(vatLedgerTable)
      .set({ reversedById: inserted.id })
      .where(eq(vatLedgerTable.id, orig.id));
  }
}
