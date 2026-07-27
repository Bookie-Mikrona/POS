import { Router, type Request, type Response, type IRouter } from "express";
import { and, eq, sql, isNull } from "drizzle-orm";
import {
  db,
  vatLedgerTable,
  vatCodeTable,
  accountingRolesTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

async function resolveAccess(
  clerkUserId: string,
  companyId: string,
  res: Response,
): Promise<{ role: "owner" | "accountant" | "viewer" } | null> {
  const [row] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(and(eq(accountingRolesTable.clerkUserId, clerkUserId), eq(accountingRolesTable.companyId, companyId)))
    .limit(1);
  if (!row) { res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" }); return null; }
  return { role: row.role };
}

/**
 * Vrne začetek in konec obdobja za dano leto in FURS kodo obdobja (MMMM).
 * Mesečno: 0701..0712 → prvi in zadnji dan meseca
 * Trimesečno: 0703=Q1, 0706=Q2, 0709=Q3, 0712=Q4
 */
function periodBounds(year: number, period: string): { from: string; to: string } | null {
  const mm = parseInt(period.slice(2), 10);
  if (isNaN(mm) || mm < 1 || mm > 12) return null;

  // Trimesečno: zadnji mesec trimesečja
  const isQuarterly = (year <= 9999) && ([3, 6, 9, 12].includes(mm));
  // Ugotovi ali gre za mesečno ali trimesečno na podlagi zapisa — oboje deluje,
  // ker vat_period direktno filtriramo po vrednosti '0703' ipd.
  // Samo vrnemo ustrezne datumske meje za prikaz.
  const endMonth = mm;
  const startMonth = isQuarterly ? mm - 2 : mm;

  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(year, endMonth, 0).getDate(); // dan 0 naslednjega = zadnji dan tega

  return {
    from: `${year}-${pad(startMonth)}-01`,
    to: `${year}-${pad(endMonth)}-${pad(lastDay)}`,
  };
}

// ─── GET /companies/:companyId/vat-ledger-report ──────────────────────────────
/**
 * §134 — KIR/KPR pregled pred oddajo FURS-u.
 *
 * Parametri:
 *   year   — štirimiestno leto (npr. 2026)
 *   period — FURS MMMM koda (npr. '0707' = julij, '0709' = Q3)
 *
 * Vrne:
 *   kirRows    — vsaka vrstica = en dokument v KIR (direction=OUT), agregirano po journal_entry_id
 *   kirTotals  — vsote po P poljih za celotno obdobje
 *   kprRows    — vsaka vrstica = en dokument v KPR (direction=IN)
 *   kprTotals  — vsote po P poljih za celotno obdobje
 *   recon      — rekonciliacija KIR/KPR vsot vs DDV-O polja (f11, f21, f22, f23, f31, f32, f41, f42)
 *   warnings   — seznam pred-oddajnih opozoril po pravilih D.4
 *   periodFrom, periodTo — datumske meje za prikaz
 */
router.get(
  "/companies/:companyId/vat-ledger-report",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { year: yearStr, period } = req.query as Record<string, string | undefined>;

    if (!yearStr || !period) {
      res.status(400).json({ error: "Parametra year in period sta obvezna (npr. year=2026&period=0707)" });
      return;
    }
    const year = parseInt(yearStr, 10);
    if (isNaN(year) || year < 2020 || year > 2099) {
      res.status(400).json({ error: "Neveljavno leto" });
      return;
    }
    if (!/^0[0-9](0[1-9]|1[0-2])$/.test(period)) {
      res.status(400).json({ error: "Neveljavna koda obdobja (pričakovano MMMM, npr. 0707)" });
      return;
    }

    const bounds = periodBounds(year, period);
    if (!bounds) {
      res.status(400).json({ error: "Neveljavno obdobje" });
      return;
    }

    // ── Pridobi vse vat_ledger vrstice za to podjetje + obdobje ───────────────
    // Omejimo na company prek journal_entries tabele (JOIN)
    // Drizzle raw SQL za kompleksno agregacijo
    type RawRow = {
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
      vatRate: string;
      reportedAt: string | null;
    };

    const rawRows = await db.execute<RawRow>(sql`
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
        vc.rate::text                      AS "vatRate",
        vl.reported_at::text               AS "reportedAt"
      FROM vat_ledger vl
      JOIN vat_code vc ON vc.id = vl.vat_code_id
      -- Three-way company lookup: vsaj ena vez mora kazati na zahtevano podjetje.
      -- NULL journal_entry_id vrstice so pooblaščene SAMO prek invoice_id ali document_id.
      -- Vrstice brez nobene company-vezave so izključene (preprečitev cross-tenant uhajanja).
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
      ORDER BY vl.posting_date, vl.document_no
    `);

    const rows = rawRows.rows;

    // ── Pomožne funkcije ──────────────────────────────────────────────────────
    const dec = (v: string | null | undefined) => parseFloat(v ?? "0") || 0;
    const fmt = (n: number) => n.toFixed(2);

    // Agregat P polj za seznam vrstic (KIR ali KPR)
    type PFields = Record<string, number>;
    function sumPField(docRows: typeof rows, fieldFn: (r: typeof rows[0]) => string | null, amountFn: (r: typeof rows[0]) => number): PFields {
      const result: PFields = {};
      for (const r of docRows) {
        const field = fieldFn(r);
        if (!field) continue;
        result[field] = (result[field] ?? 0) + amountFn(r);
      }
      return result;
    }

    // ── Zgradi KIR vrstice (direction=OUT) ────────────────────────────────────
    const outRows = rows.filter(r => r.direction === "OUT" && !r.reversedById);

    // Grupiraj po journal_entry_id (ali document_no za brez JE)
    const kirByDoc = new Map<string, typeof rows>();
    for (const r of outRows) {
      const key = r.journalEntryId ?? r.documentNo;
      if (!kirByDoc.has(key)) kirByDoc.set(key, []);
      kirByDoc.get(key)!.push(r);
    }

    const kirRows = Array.from(kirByDoc.entries()).map(([key, docRows], idx) => {
      const first = docRows[0];
      const p: PFields = {};
      for (const r of docRows) {
        if (r.kirBaseField) p[r.kirBaseField] = (p[r.kirBaseField] ?? 0) + dec(r.baseAmount);
        if (r.kirVatField)  p[r.kirVatField]  = (p[r.kirVatField]  ?? 0) + dec(r.vatAmount);
      }
      return {
        zapst: idx + 1,
        journalEntryId: first.journalEntryId,
        documentNo: first.documentNo,
        p2: first.postingDate,
        p3: first.documentNo,
        p4: first.invoiceDate,
        p5: first.partnerName ?? null,
        p6: first.partnerCountryCode?.trim() ?? null,
        p6ds: first.partnerVatId ?? null,
        p7:  fmt(p["P7"]  ?? 0),
        p8:  fmt(p["P8"]  ?? 0),
        p9:  fmt(p["P9"]  ?? 0),
        p10: fmt(p["P10"] ?? 0),
        p11: fmt(p["P11"] ?? 0),
        p12: fmt(p["P12"] ?? 0),
        p13: fmt(p["P13"] ?? 0),
        p14: fmt(p["P14"] ?? 0),
        p15: fmt(p["P15"] ?? 0),
        p16: fmt(p["P16"] ?? 0),
        p17: fmt(p["P17"] ?? 0),
        p18: fmt(p["P18"] ?? 0),
        p19: fmt(p["P19"] ?? 0),
        p20: fmt(p["P20"] ?? 0),
        p21: fmt(p["P21"] ?? 0),
        p22: fmt(p["P22"] ?? 0),
        p23: fmt(p["P23"] ?? 0),
        p24: fmt(p["P24"] ?? 0),
        p25: fmt(p["P25"] ?? 0),
        p26: fmt(p["P26"] ?? 0),
        p27: fmt(p["P27"] ?? 0),
        p28: first.remarks ?? null,
        treatment: first.treatment,
        reported: !!first.reportedAt,
      };
    });

    // KIR skupne vsote
    const kirTotals: Record<string, string> = {};
    for (const p of ["P7","P8","P9","P10","P11","P12","P13","P14","P15","P16","P17","P18","P19","P20","P21","P22","P23","P24","P25","P26","P27"]) {
      const sum = outRows.reduce((acc, r) => {
        if (r.kirBaseField === p) return acc + dec(r.baseAmount);
        if (r.kirVatField  === p) return acc + dec(r.vatAmount);
        return acc;
      }, 0);
      kirTotals[p.toLowerCase()] = fmt(sum);
    }

    // ── Zgradi KPR vrstice (direction=IN) ─────────────────────────────────────
    const inRows = rows.filter(r => r.direction === "IN" && !r.reversedById);

    const kprByDoc = new Map<string, typeof rows>();
    for (const r of inRows) {
      const key = r.journalEntryId ?? r.documentNo;
      if (!kprByDoc.has(key)) kprByDoc.set(key, []);
      kprByDoc.get(key)!.push(r);
    }

    const kprRows = Array.from(kprByDoc.entries()).map(([key, docRows], idx) => {
      const first = docRows[0];
      const p: PFields = {};
      for (const r of docRows) {
        if (r.kprBaseField) p[r.kprBaseField] = (p[r.kprBaseField] ?? 0) + dec(r.baseAmount);
        if (r.kprVatField)  p[r.kprVatField]  = (p[r.kprVatField]  ?? 0) + dec(r.vatAmount);
        // P17 = neodbitni DDV
        if (dec(r.nonDeductibleVat) > 0) {
          p["P17"] = (p["P17"] ?? 0) + dec(r.nonDeductibleVat);
        }
      }
      return {
        zapst: idx + 1,
        journalEntryId: first.journalEntryId,
        documentNo: first.documentNo,
        p2: first.postingDate,
        p3: first.documentNo,
        p4: first.receiptDate ?? first.invoiceDate,
        p5: first.invoiceDate,
        p6: first.partnerName ?? null,
        p7: first.partnerCountryCode?.trim() ?? null,
        p7ds: first.partnerVatId ?? null,
        p8:  fmt(p["P8"]  ?? 0),
        p9:  fmt(p["P9"]  ?? 0),
        p10: fmt(p["P10"] ?? 0),
        p11: fmt(p["P11"] ?? 0),
        p12: fmt(p["P12"] ?? 0),
        p13: fmt(p["P13"] ?? 0),
        p14: fmt(p["P14"] ?? 0),
        p15: fmt(p["P15"] ?? 0),
        p16: fmt(p["P16"] ?? 0),
        p17: fmt(p["P17"] ?? 0),
        p18: fmt(p["P18"] ?? 0),
        p19: fmt(p["P19"] ?? 0),
        p20: fmt(p["P20"] ?? 0),
        p21: fmt(p["P21"] ?? 0),
        p22: fmt(p["P22"] ?? 0),
        treatment: first.treatment,
        reported: !!first.reportedAt,
      };
    });

    // KPR skupne vsote
    const kprTotals: Record<string, string> = {};
    for (const p of ["P8","P9","P10","P11","P12","P13","P14","P15","P16","P17","P18","P19","P20","P21","P22"]) {
      const sum = inRows.reduce((acc, r) => {
        if (r.kprBaseField === p) return acc + dec(r.baseAmount);
        if (r.kprVatField  === p) return acc + dec(r.vatAmount);
        if (p === "P17")          return acc + dec(r.nonDeductibleVat);
        return acc;
      }, 0);
      kprTotals[p.toLowerCase()] = fmt(sum);
    }

    // ── Rekonciliacija KIR/KPR vs DDV-O polja ─────────────────────────────────
    // Vsota OUT vrstic po P polju
    const outSum = (field: string) => outRows.reduce((a, r) => {
      if (r.kirBaseField === field) return a + dec(r.baseAmount);
      if (r.kirVatField  === field) return a + dec(r.vatAmount);
      return a;
    }, 0);
    const inSum = (field: string) => inRows.reduce((a, r) => {
      if (r.kprBaseField === field) return a + dec(r.baseAmount);
      if (r.kprVatField  === field) return a + dec(r.vatAmount);
      return a;
    }, 0);
    const nonDedSum = inRows.reduce((a, r) => a + dec(r.nonDeductibleVat), 0);

    type ReconRow = { dvoField: string; label: string; kirField?: string; kprField?: string; value: string };
    const recon: ReconRow[] = [
      { dvoField: "f11",  label: "Obdavčene dobave (neto osnova)",       kirField: "P7",  value: fmt(outSum("P7")) },
      { dvoField: "f12",  label: "Oproščene dobave v EU (46. čl.)",      kirField: "P10", value: fmt(outSum("P10")) },
      { dvoField: "f13",  label: "Prodaja na daljavo",                   kirField: "P12", value: fmt(outSum("P12")) },
      { dvoField: "f15",  label: "Oproščene dobave brez pravice odbitka",kirField: "P9",  value: fmt(outSum("P9")) },
      { dvoField: "f21",  label: "Obračunani DDV 22 %",                  kirField: "P14", value: fmt(outSum("P14")) },
      { dvoField: "f22",  label: "Obračunani DDV 9,5 %",                 kirField: "P15", value: fmt(outSum("P15")) },
      { dvoField: "f22a", label: "Obračunani DDV 5 %",                   kirField: "P16", value: fmt(outSum("P16")) },
      { dvoField: "f23",  label: "DDV — pridobitve blaga EU 22 %",       kirField: "P17", value: fmt(outSum("P17")) },
      { dvoField: "f23a", label: "DDV — storitve EU 22 %",               kirField: "P18", value: fmt(outSum("P18")) },
      { dvoField: "f24",  label: "DDV — pridobitve blaga EU 9,5 %",      kirField: "P19", value: fmt(outSum("P19")) },
      { dvoField: "f25",  label: "DDV — samoobdavčitev 76.a 22 %",       kirField: "P23", value: fmt(outSum("P23")) },
      { dvoField: "f25a", label: "DDV — samoobdavčitev 76.a 9,5 %",      kirField: "P24", value: fmt(outSum("P24")) },
      { dvoField: "f26",  label: "DDV — uvoz (77. čl.)",                 kirField: "P26", value: fmt(outSum("P26")) },
      { dvoField: "f31",  label: "Vrednost nabav brez DDV",              kprField: "P8",  value: fmt(inSum("P8")) },
      { dvoField: "f32",  label: "Vrednost pridobitev EU (blago)",       kprField: "P10", value: fmt(inSum("P10")) },
      { dvoField: "f32a", label: "Vrednost storitev EU",                 kprField: "P11", value: fmt(inSum("P11")) },
      { dvoField: "f33",  label: "Oproščene nabave in pridobitve",        kprField: "P14", value: fmt(inSum("P14")) },
      { dvoField: "f41",  label: "Odbitni DDV 22 %",                     kprField: "P18", value: fmt(inSum("P18")) },
      { dvoField: "f42",  label: "Odbitni DDV 9,5 %",                    kprField: "P19", value: fmt(inSum("P19")) },
      { dvoField: "f42a", label: "Odbitni DDV 5 %",                      kprField: "P20", value: fmt(inSum("P20")) },
    ];

    // Izračunaj neto DDV obveznost
    const totalObracunan = outSum("P14") + outSum("P15") + outSum("P16") +
      outSum("P17") + outSum("P18") + outSum("P19") + outSum("P20") + outSum("P21") + outSum("P22") +
      outSum("P23") + outSum("P24") + outSum("P25") + outSum("P26");
    const totalOdbitni = inSum("P18") + inSum("P19") + inSum("P20") + inSum("P21");
    const netoDdv = totalObracunan - totalOdbitni;

    // ── Pred-oddajna opozorila (D.4) ──────────────────────────────────────────
    type Warning = {
      id: string;
      severity: "ERROR" | "WARNING";
      rule: string;
      message: string;
      documentNo: string | null;
      journalEntryId: string | null;
    };
    const warnings: Warning[] = [];

    for (const r of rows) {
      // D.4.1 — DDV ≠ osnova × stopnja (±0,02 toleranca)
      if (dec(r.vatAmount) !== 0) {
        const expected = dec(r.baseAmount) * dec(r.vatRate) / 100;
        const diff = Math.abs(dec(r.vatAmount) - expected);
        if (diff > 0.02) {
          warnings.push({
            id: r.id,
            severity: "WARNING",
            rule: "D4-1",
            message: `DDV ${r.vatAmount} ≠ osnova ${r.baseAmount} × stopnja ${r.vatRate}% = ${fmt(expected)} (razlika ${fmt(diff)})`,
            documentNo: r.documentNo,
            journalEntryId: r.journalEntryId,
          });
        }
      }

      // D.4.2 — direction=IN brez receipt_date → ERROR
      if (r.direction === "IN" && !r.receiptDate) {
        warnings.push({
          id: r.id,
          severity: "ERROR",
          rule: "D4-2",
          message: `Manjka datum prejema (P4) za dokument ${r.documentNo}`,
          documentNo: r.documentNo,
          journalEntryId: r.journalEntryId,
        });
      }

      // D.4.3 — RC dokument brez pair_id → ERROR
      if (r.isReverseCharge && !r.pairId) {
        warnings.push({
          id: r.id,
          severity: "ERROR",
          rule: "D4-3",
          message: `RC dokument ${r.documentNo} nima sparjenega para (pair_id je NULL)`,
          documentNo: r.documentNo,
          journalEntryId: r.journalEntryId,
        });
      }

      // D.4.4 — samoprijava brez correction_period / correction_amount → ERROR
      if ((r.treatment === 2 || r.treatment === 3) && (!r.correctionPeriod || !r.correctionAmount)) {
        warnings.push({
          id: r.id,
          severity: "ERROR",
          rule: "D4-4",
          message: `Samoprijava (OBRAVNAVA=${r.treatment}) brez correction_period ali correction_amount za dokument ${r.documentNo}`,
          documentNo: r.documentNo,
          journalEntryId: r.journalEntryId,
        });
      }
    }

    // Dedupliciraj opozorila po journalEntryId + rule (ne po vrstico)
    const seenWarnings = new Set<string>();
    const dedupedWarnings = warnings.filter(w => {
      const key = `${w.journalEntryId ?? w.documentNo}:${w.rule}`;
      if (seenWarnings.has(key)) return false;
      seenWarnings.add(key);
      return true;
    });

    const errCount = dedupedWarnings.filter(w => w.severity === "ERROR").length;
    const warnCount = dedupedWarnings.filter(w => w.severity === "WARNING").length;

    res.json({
      year,
      period,
      periodFrom: bounds.from,
      periodTo: bounds.to,
      kirCount: kirRows.length,
      kprCount: kprRows.length,
      kirRows,
      kirTotals,
      kprRows,
      kprTotals,
      recon,
      reconSummary: {
        totalObracunan: fmt(totalObracunan),
        totalOdbitni: fmt(totalOdbitni),
        netoDdv: fmt(netoDdv),
      },
      warnings: dedupedWarnings,
      errorCount: errCount,
      warningCount: warnCount,
      hasErrors: errCount > 0,
    });
  },
);

export default router;
