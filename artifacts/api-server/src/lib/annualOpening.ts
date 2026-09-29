import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

type Executor = Pick<typeof db, "execute">;
type Period = { id: string; start_date: string; end_date: string; status: string };
type AccountBalance = {
  id: string; code: string; name: string; type: string; company_id: string;
  is_active: boolean; allows_posting: boolean; requires_partner: boolean; requires_cost_center: boolean;
  cost_center_policy: string | null; requires_project: boolean; net: string;
};
type InvoiceBalance = {
  account_id: string; code: string; source_type: string; linked_entry_id: string | null;
  historical_evidence: boolean; invalid_evidence: boolean;
  gross: string | null; paid: string; historical_closed: string;
};

export function isReservedOpeningReference(reference: string | null | undefined): boolean {
  return !!reference && (/^OTV-\d{4}-/.test(reference)
    || /^BOOKIE-OLD\/K2\/\d{4}\/00\//.test(reference));
}

export function moneyCents(amount: string | number): number {
  const value = String(amount);
  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) throw new Error(`Neveljaven denarni znesek: ${value}`);
  const negative = value.startsWith("-");
  const [whole, decimals = ""] = value.replace("-", "").split(".");
  const result = Number(whole) * 100 + Number(decimals.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("Znesek presega dovoljeni obseg");
  return negative ? -result : result;
}

export type OpeningLine = { accountId: string; code: string; name: string; side: "debit" | "credit"; amount: string };
export type OpeningReconciliation = {
  code: string; generalLedger: string; openItems: string; difference: string;
  evidenceComplete: boolean; matched: boolean;
};
export type AnnualOpeningSnapshot = {
  sourcePeriodId: string; destinationPeriodId: string; year: string; date: string;
  reference: string; lines: OpeningLine[]; debit: string; credit: string;
  reconciliation: OpeningReconciliation[]; reconciled: boolean;
};

const format = (cents: number) => (cents / 100).toFixed(2);

/**
 * One year's posted closing balances already include that year's opening.
 * Never sum prior years on top. Open-item evidence is read independently:
 * invoices are not copied into the next year.
 */
export async function loadAnnualOpening(
  companyId: string,
  destinationPeriodId: string,
  executor: Executor = db,
): Promise<AnnualOpeningSnapshot> {
  const destResult = await executor.execute(sql`
    SELECT id, start_date::text, end_date::text, status
    FROM accounting_periods WHERE company_id=${companyId} AND id=${destinationPeriodId}
  `);
  const [destination] = destResult.rows as Period[];
  if (!destination) throw new Error("Ciljno obdobje ne obstaja v tem podjetju");
  const year = destination.start_date.slice(0, 4);
  const previousYear = String(Number(year) - 1);
  if (destination.start_date !== `${year}-01-01` || destination.end_date !== `${year}-12-31`
    || destination.status !== "open") {
    throw new Error("Otvoritev zahteva odprto celoletno ciljno obdobje (1. 1.–31. 12.)");
  }
  const sourceResult = await executor.execute(sql`
    SELECT id, start_date::text, end_date::text, status
    FROM accounting_periods
    WHERE company_id=${companyId} AND end_date=${`${previousYear}-12-31`}
      AND start_date=${`${previousYear}-01-01`}
  `);
  const [source] = sourceResult.rows as Period[];
  if (!source || source.status !== "locked") {
    throw new Error("Prejšnje celoletno računovodsko obdobje mora biti zaklenjeno");
  }
  const balanceResult = await executor.execute(sql`
    SELECT a.id, a.code, a.name, a.type, a.company_id, a.is_active,
           a.allows_posting, a.requires_partner, a.requires_cost_center, a.cost_center_policy,
           a.requires_project,
           SUM(CASE WHEN l.side='debit' THEN l.amount ELSE -l.amount END)::numeric(18,2)::text net
    FROM journal_entry_lines l
    JOIN journal_entries e ON e.id=l.entry_id
    JOIN accounts a ON a.id=l.account_id
    WHERE e.company_id=${companyId} AND e.period_id=${source.id} AND e.status IN ('posted','reversed')
    GROUP BY a.id
    HAVING SUM(CASE WHEN l.side='debit' THEN l.amount ELSE -l.amount END) <> 0
    ORDER BY a.code, a.id
  `);
  const balances = balanceResult.rows as AccountBalance[];
  if (balances.length === 0) throw new Error("V prejšnjem letu ni knjiženih bilančnih saldov");
  if (balances.some((row) => !["asset", "liability", "equity"].includes(row.type)
    || row.company_id !== companyId || !row.is_active || !row.allows_posting
    || (row.requires_partner && !/^(120|220)/.test(row.code))
    || row.requires_cost_center || row.cost_center_policy === "required" || row.requires_project)) {
    throw new Error("Pred otvoritvijo uredite ne-zaključene prihodke/odhodke ali neknjižljive bilančne konte");
  }
  const lines: OpeningLine[] = balances.map((row) => {
    const net = moneyCents(row.net);
    return {
      accountId: row.id, code: row.code, name: row.name,
      side: net > 0 ? "debit" : "credit",
      amount: format(Math.abs(net)),
    };
  });
  const debit = lines.reduce((sum, line) => sum + (line.side === "debit" ? moneyCents(line.amount) : 0), 0);
  const credit = lines.reduce((sum, line) => sum + (line.side === "credit" ? moneyCents(line.amount) : 0), 0);
  if (debit !== credit || debit === 0) throw new Error("Saldi zaključenega leta niso uravnoteženi");

  // Same gross/posted-allocation basis as /open-items, restricted to the closing date.
  const invoiceResult = await executor.execute(sql`
    SELECT i.ar_ap_account_id account_id, a.code, i.source_type, i.linked_entry_id,
      EXISTS(SELECT 1 FROM bookie_old_ar_settlements s
        WHERE s.company_id=${companyId} AND s.invoice_id=i.id) historical_evidence,
      EXISTS(
        SELECT 1 FROM bookie_old_ar_settlements s
        CROSS JOIN LATERAL jsonb_array_elements(s.evidence) e(item)
        WHERE s.company_id=${companyId} AND s.invoice_id=i.id
          AND e.item->>'recordedDate' !~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$'
      ) invalid_evidence,
      COALESCE((
        SELECT SUM(COALESCE(
          il.vat_base::numeric + il.vat_amount::numeric,
          il.quantity::numeric * il.unit_price::numeric * (1 + il.vat_rate::numeric / 100)
        ))::numeric(18,2)
        FROM invoice_lines il WHERE il.invoice_id=i.id
      ), i.historical_gross)::numeric(18,2)::text gross,
      COALESCE((
        SELECT SUM(pa.allocated_amount) FROM payment_allocations pa
        JOIN payments p ON p.id=pa.payment_id
        WHERE pa.invoice_id=i.id AND p.status='posted'
          AND p.company_id=${companyId} AND p.payment_date<=${source.end_date}
      ),0)::numeric(18,2)::text paid,
      COALESCE((
        SELECT SUM((e.item->>'amount')::numeric)
        FROM bookie_old_ar_settlements s
        CROSS JOIN LATERAL jsonb_array_elements(s.evidence) e(item)
        WHERE s.invoice_id=i.id AND s.company_id=${companyId}
          AND e.item->>'recordedDate' ~ '^[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}$'
          AND make_date(
            split_part(e.item->>'recordedDate','/',3)::int,
            split_part(e.item->>'recordedDate','/',1)::int,
            split_part(e.item->>'recordedDate','/',2)::int
          )<=${source.end_date}::date
      ),0)::numeric(18,2)::text historical_closed
    FROM invoices i JOIN accounts a ON a.id=i.ar_ap_account_id AND a.company_id=${companyId}
    WHERE i.company_id=${companyId} AND i.invoice_date<=${source.end_date}
      AND i.status IN ('posted','paid') AND (a.code LIKE '120%' OR a.code LIKE '220%')
  `);
  const invoiceRows = invoiceResult.rows as InvoiceBalance[];
  const totals = new Map<string, { code: string; cents: number; complete: boolean }>();
  for (const row of invoiceRows) {
    const current = totals.get(row.account_id) ?? { code: row.code, cents: 0, complete: true };
    // Imported legacy payables have no invoice-level closing evidence in this
    // system; an accidental numeric match must not certify them as reconciled.
    if (row.invalid_evidence || (row.source_type === "bookie-old"
      && (row.code.startsWith("220") || (!row.linked_entry_id && !row.historical_evidence)))) {
      current.complete = false;
    }
    if (row.gross == null) current.complete = false;
    else current.cents += Math.max(0, moneyCents(row.gross) - moneyCents(row.paid) - moneyCents(row.historical_closed));
    totals.set(row.account_id, current);
  }
  const accountIds = new Set([
    ...balances.filter((row) => /^12[0-9]|^22[0-9]/.test(row.code)).map((row) => row.id),
    ...totals.keys(),
  ]);
  const reconciliation = [...accountIds].map((accountId) => {
    const balance = balances.find((row) => row.id === accountId);
    const items = totals.get(accountId);
    const net = balance ? moneyCents(balance.net) : 0;
    const open = items?.cents ?? 0;
    // 120: debit receivables; 220: credit payables. Keep reverse-sign items visible.
    const normalized = (balance?.code ?? items!.code).startsWith("220") ? -open : open;
    const difference = net - normalized;
    const evidenceComplete = items?.complete ?? net === 0;
    return {
      code: balance?.code ?? items!.code,
      generalLedger: format(net),
      openItems: format(normalized),
      difference: format(difference),
      evidenceComplete,
      matched: difference === 0 && evidenceComplete,
    };
  }).sort((a, b) => a.code.localeCompare(b.code));
  return {
    sourcePeriodId: source.id, destinationPeriodId, year, date: destination.start_date,
    reference: `OTV-${year}-01`, lines, debit: format(debit), credit: format(credit),
    reconciliation, reconciled: reconciliation.every((row) => row.matched),
  };
}

/** Exact match, not a reference-only exemption: changing any line revokes the exemption. */
export function matchesAnnualOpening(
  entry: { reference: string | null; entryDate: string; periodId: string; sourceType?: string },
  lines: {
    accountId: string; side: string; amount: string; partnerId?: string | null;
    costCenterId?: string | null; projectId?: string | null; departmentId?: string | null;
    vatCodeId?: string | null; companyVatCodeId?: string | null; vatAmount?: string | null;
  }[],
  snapshot: AnnualOpeningSnapshot,
): boolean {
  if (entry.reference !== snapshot.reference || entry.entryDate !== snapshot.date
    || entry.periodId !== snapshot.destinationPeriodId || (entry.sourceType && entry.sourceType !== "manual")
    || lines.length !== snapshot.lines.length) return false;
  const expected = new Map(snapshot.lines.map((line) => [line.accountId, line]));
  return lines.every((line) => {
    const source = expected.get(line.accountId);
    if (!source || line.side !== source.side || moneyCents(line.amount) !== moneyCents(source.amount)
      || line.partnerId || line.costCenterId || line.projectId || line.departmentId
      || line.vatCodeId || line.companyVatCodeId
      || (line.vatAmount != null && moneyCents(line.vatAmount) !== 0)) return false;
    expected.delete(line.accountId);
    return true;
  }) && expected.size === 0;
}