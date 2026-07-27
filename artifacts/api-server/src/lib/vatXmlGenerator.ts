/**
 * FURS KIR/KPR XML generator — shema DDV_KIR_KPR_1.xsd (verzija 1.3, 22. 7. 2024)
 *
 * Namespace: http://edavki.durs.si/Documents/Schemas/DDV_KIR_KPR_1.xsd
 *
 * Logika:
 *   - Prebere vat_ledger vrstice za podjetje + obdobje (enako kot vatLedgerReport)
 *   - Agregira po dokumentu (journal_entry_id → ena KIR/KPR vrstica)
 *   - Polni P polja iz vat_code mappingov (kir_base_field, kir_vat_field, ...)
 *   - Renumerira ZAPST od 1 znotraj vsake liste
 *   - Vrne XML string in statistike
 *
 * Spec: ERP 3. del, razdelki B–E.
 */

import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

// ─── Tipi ──────────────────────────────────────────────────────────────────

export interface XmlGenResult {
  xml: string;
  kirCount: number;
  kprCount: number;
  hasKir: boolean;
  hasKpr: boolean;
}

interface RawVatRow extends Record<string, unknown> {
  id: string;
  journalEntryId: string | null;
  direction: string;
  documentNo: string;
  postingDate: string;
  invoiceDate: string;
  receiptDate: string | null;
  partnerName: string | null;
  partnerCountryCode: string | null;
  partnerVatId: string | null;
  baseAmount: string;
  vatAmount: string;
  nonDeductibleVat: string;
  deductionPercent: string;
  kirBaseField: string | null;
  kirVatField: string | null;
  kprBaseField: string | null;
  kprVatField: string | null;
  isReverseCharge: boolean;
  pairId: string | null;
  reversedById: string | null;
  remarks: string | null;
  treatment: number;
  correctionPeriod: string | null;
  correctionAmount: string | null;
  vatCodeCode: string;
  assetType: string;
}

interface DocGroup {
  groupKey: string;          // documentNo nebo journalEntryId
  direction: "IN" | "OUT";
  documentNo: string;
  postingDate: string;       // P2
  invoiceDate: string;       // KIR P4 / KPR P5
  receiptDate: string | null; // KPR P4
  partnerName: string | null;
  partnerCountryCode: string | null;
  partnerVatId: string | null;
  treatment: number;
  correctionPeriod: string | null;
  correctionAmount: string | null;
  remarks: string | null;
  p: Record<string, number>; // P7..P27 (KIR) ali P8..P22 (KPR)
}

// ─── Pomožniki ─────────────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fmtAmt(n: number): string {
  return n.toFixed(2);
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  // Vrne YYYY-MM-DD (včasih pride kot ISO datetime ali samo date string)
  return String(d).slice(0, 10);
}

// Agregira znesek na P polje tega dokumenta
function addToField(group: DocGroup, field: string | null | undefined, amount: number) {
  if (!field || Math.abs(amount) < 0.005) return;
  group.p[field] = (group.p[field] ?? 0) + amount;
}

// ─── Glavni generator ──────────────────────────────────────────────────────

/**
 * Generira KIR/KPR XML za FURS.
 *
 * @param companyId  UUID podjetja
 * @param taxPayerId 8-mestna davčna številka zavezanca (brez SI)
 * @param year       Leto (npr. 2026)
 * @param period     FURS koda obdobja (npr. '0707', '0709')
 * @param periodFrom YYYY-MM-DD začetek
 * @param periodTo   YYYY-MM-DD konec
 * @param options    Neobvezna polja glave (odbdelez, vracilo, nacin, ...)
 */
export async function generateKirKprXml(
  companyId: string,
  taxPayerId: string,
  year: number,
  period: string,
  periodFrom: string,
  periodTo: string,
  options: {
    odbdelez?: boolean;
    vracilo?: boolean;
    nacin?: 1 | 2 | 3;
    inspos?: boolean;
    opomba?: string;
    tujec1?: string;  // ISO 3166, za davčno zastopanje tujcev
    tujec2?: string;  // davčna številka tujca brez kode
  } = {}
): Promise<XmlGenResult> {

  // ── 1. Preberi vat_ledger vrstice za to podjetje/obdobje ─────────────────
  const rawRows = await db.execute<RawVatRow>(sql`
    SELECT
      vl.id                              AS "id",
      vl.journal_entry_id                AS "journalEntryId",
      vl.direction                       AS "direction",
      vl.document_no                     AS "documentNo",
      vl.posting_date                    AS "postingDate",
      vl.invoice_date                    AS "invoiceDate",
      vl.receipt_date                    AS "receiptDate",
      vl.partner_name                    AS "partnerName",
      vl.partner_country_code            AS "partnerCountryCode",
      vl.partner_vat_id                  AS "partnerVatId",
      vl.base_amount::text               AS "baseAmount",
      vl.vat_amount::text                AS "vatAmount",
      vl.non_deductible_vat::text        AS "nonDeductibleVat",
      vl.deduction_percent::text         AS "deductionPercent",
      vc.kir_base_field                  AS "kirBaseField",
      vc.kir_vat_field                   AS "kirVatField",
      vc.kpr_base_field                  AS "kprBaseField",
      vc.kpr_vat_field                   AS "kprVatField",
      vc.is_reverse_charge               AS "isReverseCharge",
      vl.pair_id                         AS "pairId",
      vl.reversed_by_id                  AS "reversedById",
      vl.remarks                         AS "remarks",
      vl.treatment                       AS "treatment",
      vl.correction_period               AS "correctionPeriod",
      vl.correction_amount::text         AS "correctionAmount",
      vc.code                            AS "vatCodeCode",
      vl.asset_type                      AS "assetType"
    FROM vat_ledger vl
    JOIN vat_code vc ON vc.id = vl.vat_code_id
    LEFT JOIN journal_entries je ON je.id = vl.journal_entry_id
    LEFT JOIN invoices         iv ON iv.id = vl.invoice_id
    LEFT JOIN documents        dc ON dc.id = vl.document_id
    WHERE vl.vat_period_year = ${year}
      AND vl.vat_period = ${period}
      AND (
        je.company_id = ${companyId}
        OR iv.company_id = ${companyId}
        OR dc.company_id = ${companyId}
      )
      -- Izključi stornirane vrstice
      AND vl.reversed_by_id IS NULL
    ORDER BY vl.posting_date, vl.document_no, vl.direction
  `);

  const rows = rawRows.rows;

  // ── 2. Agregiraj po dokumentu + smeri → DocGroup ──────────────────────────
  const kirGroups = new Map<string, DocGroup>();
  const kprGroups = new Map<string, DocGroup>();

  for (const r of rows) {
    const dec = (v: string) => parseFloat(v) || 0;
    const baseAmt = dec(r.baseAmount);
    const vatAmt  = dec(r.vatAmount);
    const nonDed  = dec(r.nonDeductibleVat);
    const dedPct  = dec(r.deductionPercent) / 100; // 0–1

    // Ključ za grupiranje: journal_entry_id (ali documentNo kot fallback)
    const groupKey = r.journalEntryId ?? r.documentNo;

    const getOrCreate = (map: Map<string, DocGroup>): DocGroup => {
      if (!map.has(groupKey)) {
        map.set(groupKey, {
          groupKey,
          direction: r.direction as "IN" | "OUT",
          documentNo: r.documentNo,
          postingDate: r.postingDate,
          invoiceDate: r.invoiceDate,
          receiptDate: r.receiptDate,
          partnerName: r.partnerName,
          partnerCountryCode: r.partnerCountryCode,
          partnerVatId: r.partnerVatId,
          treatment: r.treatment,
          correctionPeriod: r.correctionPeriod,
          correctionAmount: r.correctionAmount,
          remarks: r.remarks,
          p: {},
        });
      }
      return map.get(groupKey)!;
    };

    if (r.direction === "OUT") {
      const g = getOrCreate(kirGroups);
      addToField(g, r.kirBaseField, baseAmt);
      addToField(g, r.kirVatField, vatAmt);

      // Neodbitni DDV → ni v KIR
      // Opomba / MRN → P28
      if (r.remarks && !g.remarks) g.remarks = r.remarks;

    } else {
      // direction === "IN"
      const g = getOrCreate(kprGroups);

      // Osnova
      addToField(g, r.kprBaseField, baseAmt);

      // Odbitni DDV (po odbitnem deležu)
      const deductibleVat = vatAmt * dedPct;
      addToField(g, r.kprVatField, deductibleVat);

      // Neodbitni DDV → P17
      const nonDeductibleTotal = vatAmt - deductibleVat + nonDed;
      if (nonDeductibleTotal > 0.005) {
        addToField(g, "P17", nonDeductibleTotal);
      }

      // Asset type → informativna polja P12/P13/P15/P16
      if (r.assetType === "REALESTATE") {
        if (r.kprBaseField === "P8" || r.kprBaseField === "P9") {
          addToField(g, "P12", baseAmt); // KPR P12 = obdavčene nabave nepremičnin
        } else if (r.kprBaseField === "P14") {
          addToField(g, "P15", baseAmt); // KPR P15 = oproščene nabave nepremičnin
        }
      } else if (r.assetType === "OTHER_FA") {
        if (r.kprBaseField === "P8" || r.kprBaseField === "P9") {
          addToField(g, "P13", baseAmt);
        } else if (r.kprBaseField === "P14") {
          addToField(g, "P16", baseAmt);
        }
      }

      if (r.remarks && !g.remarks) g.remarks = r.remarks;
    }
  }

  const kirList = Array.from(kirGroups.values());
  const kprList = Array.from(kprGroups.values());
  const hasKir = kirList.length > 0;
  const hasKpr = kprList.length > 0;

  // ── 3. Sestavi XML ──────────────────────────────────────────────────────
  const NS = "http://edavki.durs.si/Documents/Schemas/DDV_KIR_KPR_1.xsd";

  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<DDV_KIR_KPR xmlns="${NS}">`);

  // ── Glava ──────────────────────────────────────────────────────────────
  lines.push(`  <Glava>`);
  lines.push(`    <TaxPayerID>${esc(taxPayerId)}</TaxPayerID>`);
  if (options.tujec1) lines.push(`    <TUJEC1>${esc(options.tujec1)}</TUJEC1>`);
  if (options.tujec2) lines.push(`    <TUJEC2>${esc(options.tujec2)}</TUJEC2>`);
  lines.push(`    <OBDOBJE_OD>${periodFrom}</OBDOBJE_OD>`);
  lines.push(`    <OBDOBJE_DO>${periodTo}</OBDOBJE_DO>`);
  lines.push(`    <KIR>${hasKir}</KIR>`);
  lines.push(`    <KPR>${hasKpr}</KPR>`);
  lines.push(`    <VRACILO>${options.vracilo ?? false}</VRACILO>`);
  lines.push(`    <ODBDELEZ>${options.odbdelez ?? false}</ODBDELEZ>`);
  if (options.nacin != null) {
    lines.push(`    <NACIN>${options.nacin}</NACIN>`);
  }
  if (options.inspos) lines.push(`    <INSPOS>true</INSPOS>`);
  if (options.opomba) lines.push(`    <OPOMBA>${esc(options.opomba)}</OPOMBA>`);
  lines.push(`  </Glava>`);

  // ── Lista_KIR ──────────────────────────────────────────────────────────
  if (hasKir) {
    lines.push(`  <Lista_KIR>`);
    kirList.forEach((g, idx) => {
      lines.push(`    <KIR>`);
      lines.push(`      <ZAPST>${idx + 1}</ZAPST>`);
      lines.push(`      <OBDOBJE>${period}</OBDOBJE>`);
      lines.push(`      <P2>${fmtDate(g.postingDate)}</P2>`);
      lines.push(`      <P3>${esc(g.documentNo)}</P3>`);
      lines.push(`      <P4>${fmtDate(g.invoiceDate)}</P4>`);
      if (g.partnerName) lines.push(`      <P5>${esc(g.partnerName)}</P5>`);
      if (g.partnerCountryCode) lines.push(`      <P6>${esc(g.partnerCountryCode)}</P6>`);
      if (g.partnerVatId) lines.push(`      <P6DS>${esc(g.partnerVatId)}</P6DS>`);
      // P7–P27 — samo tiste z vrednostjo ≠ 0
      for (const field of ["P7","P8","P9","P10","P11","P12","P13",
                            "P14","P15","P16","P17","P18","P19","P20",
                            "P21","P22","P23","P24","P25","P26","P27"]) {
        const v = g.p[field];
        if (v != null && Math.abs(v) >= 0.005) {
          lines.push(`      <${field}>${fmtAmt(v)}</${field}>`);
        }
      }
      if (g.remarks) lines.push(`      <P28>${esc(g.remarks.slice(0, 250))}</P28>`);
      lines.push(`      <OBRAVNAVA>${g.treatment}</OBRAVNAVA>`);
      if (g.treatment === 2 || g.treatment === 3) {
        if (g.correctionPeriod) lines.push(`      <OBDOBJE88>${esc(g.correctionPeriod)}</OBDOBJE88>`);
        if (g.correctionAmount) lines.push(`      <DAVEK88>${fmtAmt(parseFloat(g.correctionAmount))}</DAVEK88>`);
      }
      lines.push(`    </KIR>`);
    });
    lines.push(`  </Lista_KIR>`);
  }

  // ── Lista_KPR ──────────────────────────────────────────────────────────
  if (hasKpr) {
    lines.push(`  <Lista_KPR>`);
    kprList.forEach((g, idx) => {
      lines.push(`    <KPR>`);
      lines.push(`      <ZAPST>${idx + 1}</ZAPST>`);
      lines.push(`      <OBDOBJE>${period}</OBDOBJE>`);
      lines.push(`      <P2>${fmtDate(g.postingDate)}</P2>`);
      lines.push(`      <P3>${esc(g.documentNo)}</P3>`); // dobaviteljeva številka
      lines.push(`      <P4>${fmtDate(g.receiptDate ?? g.postingDate)}</P4>`); // datum prejema
      lines.push(`      <P5>${fmtDate(g.invoiceDate)}</P5>`); // datum listine
      if (g.partnerName) lines.push(`      <P6>${esc(g.partnerName)}</P6>`);
      if (g.partnerCountryCode) lines.push(`      <P7>${esc(g.partnerCountryCode)}</P7>`);
      if (g.partnerVatId) lines.push(`      <P7DS>${esc(g.partnerVatId)}</P7DS>`);
      // P8–P21
      for (const field of ["P8","P9","P10","P11","P12","P13",
                            "P14","P15","P16","P17","P18","P19","P20","P21"]) {
        const v = g.p[field];
        if (v != null && Math.abs(v) >= 0.005) {
          lines.push(`      <${field}>${fmtAmt(v)}</${field}>`);
        }
      }
      if (g.remarks) lines.push(`      <P22>${esc(g.remarks.slice(0, 250))}</P22>`);
      lines.push(`      <OBRAVNAVA>${g.treatment}</OBRAVNAVA>`);
      if (g.treatment === 2 || g.treatment === 3) {
        if (g.correctionPeriod) lines.push(`      <OBDOBJE88>${esc(g.correctionPeriod)}</OBDOBJE88>`);
        if (g.correctionAmount) lines.push(`      <DAVEK88>${fmtAmt(parseFloat(g.correctionAmount))}</DAVEK88>`);
      }
      lines.push(`    </KPR>`);
    });
    lines.push(`  </Lista_KPR>`);
  }

  lines.push(`</DDV_KIR_KPR>`);

  return {
    xml: lines.join("\n"),
    kirCount: kirList.length,
    kprCount: kprList.length,
    hasKir,
    hasKpr,
  };
}
