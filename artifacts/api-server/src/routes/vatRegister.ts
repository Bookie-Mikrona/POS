import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, gte, lte, asc, sql, inArray } from "drizzle-orm";
import {
  db,
  invoicesTable,
  invoiceLinesTable,
  vatCodesTable,
  counterpartiesTable,
  accountingPeriodsTable,
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
    .where(
      and(
        eq(accountingRolesTable.clerkUserId, clerkUserId),
        eq(accountingRolesTable.companyId, companyId),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" });
    return null;
  }
  return { role: row.role };
}

// ─── GET /companies/:companyId/vat-register ───────────────────────────────────
/**
 * Knjiga izdanih računov (IR) ali prejetih računov (PR).
 * Vsak vrstični vnos vsebuje davčno osnovo in DDV po DDV kodi.
 *
 * Logika VAT base/amount:
 *   1. Če ima vrstica vat_base / vat_amount → uporabi direktno (nova metoda)
 *   2. Sicer izračunaj iz quantity × unit_price × vat_rate (legacy)
 */
router.get(
  "/companies/:companyId/vat-register",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { periodId, type, dateFrom, dateTo } = req.query as Record<string, string | undefined>;

    if (!periodId) {
      res.status(400).json({ error: "Parametr periodId je obvezen" });
      return;
    }

    const [period] = await db
      .select({ id: accountingPeriodsTable.id, name: accountingPeriodsTable.name })
      .from(accountingPeriodsTable)
      .where(and(eq(accountingPeriodsTable.id, periodId), eq(accountingPeriodsTable.companyId, companyId)))
      .limit(1);

    if (!period) {
      res.status(400).json({ error: "Obdobje ni najdeno ali ne pripada temu podjetju" });
      return;
    }

    // Pridobi vse knjižene račune za obdobje
    const conditions: ReturnType<typeof eq>[] = [
      eq(invoicesTable.companyId, companyId),
      eq(invoicesTable.periodId, periodId),
      sql`${invoicesTable.status} IN ('posted', 'paid')`,
    ];
    if (type) conditions.push(eq(invoicesTable.type, type as any));
    if (dateFrom) conditions.push(gte(invoicesTable.invoiceDate, dateFrom));
    if (dateTo) conditions.push(lte(invoicesTable.invoiceDate, dateTo));

    const invoices = await db
      .select({
        id: invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        invoiceDate: invoicesTable.invoiceDate,
        type: invoicesTable.type,
        counterpartyId: invoicesTable.counterpartyId,
        counterpartyName: counterpartiesTable.name,
        counterpartyTaxId: counterpartiesTable.taxId,
      })
      .from(invoicesTable)
      .innerJoin(counterpartiesTable, eq(counterpartiesTable.id, invoicesTable.counterpartyId))
      .where(and(...conditions))
      .orderBy(asc(invoicesTable.invoiceDate), asc(invoicesTable.invoiceNumber));

    if (invoices.length === 0) {
      res.json({
        periodId: period.id,
        periodName: period.name,
        dateFrom: dateFrom ?? null,
        dateTo: dateTo ?? null,
        entries: [],
        totalVatBase: "0.00",
        totalVatAmount: "0.00",
        totalGross: "0.00",
      });
      return;
    }

    const invoiceIds = invoices.map((i) => i.id);

    // Pridobi vse vrstice s sumami po DDV kodi za vsak račun
    const lineRows = await db
      .select({
        invoiceId: invoiceLinesTable.invoiceId,
        vatCodeId: invoiceLinesTable.vatCodeId,
        vatRate: invoiceLinesTable.vatRate,
        // Skupaj po DDV kodi na račun
        vatBase: sql<string>`
          COALESCE(
            SUM(${invoiceLinesTable.vatBase}::numeric),
            SUM(${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric)
          )
        `,
        vatAmount: sql<string>`
          COALESCE(
            SUM(${invoiceLinesTable.vatAmount}::numeric),
            SUM(${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric * ${invoiceLinesTable.vatRate}::numeric / 100)
          )
        `,
      })
      .from(invoiceLinesTable)
      .where(inArray(invoiceLinesTable.invoiceId, invoiceIds))
      .groupBy(
        invoiceLinesTable.invoiceId,
        invoiceLinesTable.vatCodeId,
        invoiceLinesTable.vatRate,
      )
      .orderBy(asc(invoiceLinesTable.vatRate));

    // Pridobi DDV kode
    const vatCodeIds = [...new Set(lineRows.map((r) => r.vatCodeId).filter(Boolean))] as string[];
    const vatCodes = vatCodeIds.length
      ? await db.select({ id: vatCodesTable.id, code: vatCodesTable.code, name: vatCodesTable.name })
          .from(vatCodesTable).where(inArray(vatCodesTable.id, vatCodeIds))
      : [];
    const vatCodeMap = new Map(vatCodes.map((c) => [c.id, c]));

    // Grupiraj vrstice po računu
    type LineGroup = {
      vatCodeId: string | null;
      vatCode: string | null;
      vatRate: string;
      vatBase: number;
      vatAmount: number;
    };
    const linesByInvoice = new Map<string, LineGroup[]>();
    for (const l of lineRows) {
      const vc = l.vatCodeId ? vatCodeMap.get(l.vatCodeId) : null;
      const group: LineGroup = {
        vatCodeId: l.vatCodeId ?? null,
        vatCode: vc?.code ?? null,
        vatRate: l.vatRate,
        vatBase: parseFloat(l.vatBase ?? "0"),
        vatAmount: parseFloat(l.vatAmount ?? "0"),
      };
      const existing = linesByInvoice.get(l.invoiceId) ?? [];
      existing.push(group);
      linesByInvoice.set(l.invoiceId, existing);
    }

    // Sestavi entries — eden na račun (z seštevki za register, ali po vrsticah za razčlenitev)
    let totalVatBase = 0;
    let totalVatAmount = 0;
    let totalGross = 0;

    const entries = invoices.map((inv) => {
      const lines = linesByInvoice.get(inv.id) ?? [];
      const vatBase = lines.reduce((s, l) => s + l.vatBase, 0);
      const vatAmount = lines.reduce((s, l) => s + l.vatAmount, 0);
      const gross = vatBase + vatAmount;

      // Prevladujoča DDV koda (z največjo osnovo)
      const dominant = lines.reduce((a, b) => (b.vatBase > a.vatBase ? b : a), lines[0] ?? { vatCodeId: null, vatCode: null, vatRate: "0.00" });

      totalVatBase += vatBase;
      totalVatAmount += vatAmount;
      totalGross += gross;

      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate,
        invoiceType: inv.type,
        counterpartyId: inv.counterpartyId,
        counterpartyName: inv.counterpartyName,
        counterpartyTaxId: inv.counterpartyTaxId ?? null,
        vatCodeId: dominant?.vatCodeId ?? null,
        vatCode: dominant?.vatCode ?? null,
        vatRate: dominant?.vatRate ?? "0.00",
        vatBase: vatBase.toFixed(2),
        vatAmount: vatAmount.toFixed(2),
        grossAmount: gross.toFixed(2),
      };
    });

    res.json({
      periodId: period.id,
      periodName: period.name,
      dateFrom: dateFrom ?? null,
      dateTo: dateTo ?? null,
      entries,
      totalVatBase: totalVatBase.toFixed(2),
      totalVatAmount: totalVatAmount.toFixed(2),
      totalGross: totalGross.toFixed(2),
    });
  },
);

// ─── GET /companies/:companyId/vat-return ────────────────────────────────────
/**
 * DDV-O obračun: izstopni DDV (issued) vs. vstopni DDV (received), grupirano po DDV kodi.
 * netVat = outputVat - inputVat (pozitivno = obveznost, negativno = terjatev)
 */
router.get(
  "/companies/:companyId/vat-return",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { periodId } = req.query as Record<string, string | undefined>;
    if (!periodId) {
      res.status(400).json({ error: "Parametr periodId je obvezen" });
      return;
    }

    const [period] = await db
      .select({ id: accountingPeriodsTable.id, name: accountingPeriodsTable.name })
      .from(accountingPeriodsTable)
      .where(and(eq(accountingPeriodsTable.id, periodId), eq(accountingPeriodsTable.companyId, companyId)))
      .limit(1);
    if (!period) {
      res.status(400).json({ error: "Obdobje ni najdeno" });
      return;
    }

    // Pridobi vse knjižene račune tega obdobja
    const invoices = await db
      .select({ id: invoicesTable.id, type: invoicesTable.type })
      .from(invoicesTable)
      .where(
        and(
          eq(invoicesTable.companyId, companyId),
          eq(invoicesTable.periodId, periodId),
          sql`${invoicesTable.status} IN ('posted', 'paid')`,
        ),
      );

    if (invoices.length === 0) {
      const emptyRow = { vatRate: "0.00", outputBase: "0.00", outputVat: "0.00", inputBase: "0.00", inputVat: "0.00", netVat: "0.00" };
      res.json({ periodId: period.id, periodName: period.name, rows: [], totals: emptyRow });
      return;
    }

    const issuedIds = invoices.filter((i) => i.type === "issued").map((i) => i.id);
    const receivedIds = invoices.filter((i) => i.type === "received").map((i) => i.id);

    // Helper — pridobi seštevke po DDV kodi za podmnožico računov
    async function getSums(ids: string[]) {
      if (ids.length === 0) return [];
      return db
        .select({
          vatCodeId: invoiceLinesTable.vatCodeId,
          vatRate: invoiceLinesTable.vatRate,
          vatBase: sql<string>`
            COALESCE(
              SUM(${invoiceLinesTable.vatBase}::numeric),
              SUM(${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric)
            )
          `,
          vatAmount: sql<string>`
            COALESCE(
              SUM(${invoiceLinesTable.vatAmount}::numeric),
              SUM(${invoiceLinesTable.quantity}::numeric * ${invoiceLinesTable.unitPrice}::numeric * ${invoiceLinesTable.vatRate}::numeric / 100)
            )
          `,
        })
        .from(invoiceLinesTable)
        .where(inArray(invoiceLinesTable.invoiceId, ids))
        .groupBy(invoiceLinesTable.vatCodeId, invoiceLinesTable.vatRate)
        .orderBy(asc(invoiceLinesTable.vatRate));
    }

    const [outputSums, inputSums] = await Promise.all([
      getSums(issuedIds),
      getSums(receivedIds),
    ]);

    // Pridobi DDV kode
    const allVcIds = [
      ...new Set([
        ...outputSums.map((r) => r.vatCodeId),
        ...inputSums.map((r) => r.vatCodeId),
      ].filter(Boolean) as string[]),
    ];
    const vatCodes = allVcIds.length
      ? await db.select({ id: vatCodesTable.id, code: vatCodesTable.code, name: vatCodesTable.name })
          .from(vatCodesTable).where(inArray(vatCodesTable.id, allVcIds))
      : [];
    const vatCodeMap = new Map(vatCodes.map((c) => [c.id, c]));

    // Zberi vse unikatne rate ključe: vatRate#vatCodeId (ali vatRate#null)
    type RowKey = string;
    const keyOf = (r: { vatCodeId: string | null; vatRate: string }): RowKey =>
      `${r.vatRate}#${r.vatCodeId ?? ""}`;

    const rowMap = new Map<RowKey, {
      vatCodeId: string | null;
      vatRate: string;
      outputBase: number;
      outputVat: number;
      inputBase: number;
      inputVat: number;
    }>();

    for (const r of outputSums) {
      const k = keyOf(r);
      const existing = rowMap.get(k) ?? { vatCodeId: r.vatCodeId ?? null, vatRate: r.vatRate, outputBase: 0, outputVat: 0, inputBase: 0, inputVat: 0 };
      existing.outputBase += parseFloat(r.vatBase ?? "0");
      existing.outputVat += parseFloat(r.vatAmount ?? "0");
      rowMap.set(k, existing);
    }
    for (const r of inputSums) {
      const k = keyOf(r);
      const existing = rowMap.get(k) ?? { vatCodeId: r.vatCodeId ?? null, vatRate: r.vatRate, outputBase: 0, outputVat: 0, inputBase: 0, inputVat: 0 };
      existing.inputBase += parseFloat(r.vatBase ?? "0");
      existing.inputVat += parseFloat(r.vatAmount ?? "0");
      rowMap.set(k, existing);
    }

    const fmt = (n: number) => n.toFixed(2);
    const rows = [...rowMap.values()]
      .sort((a, b) => parseFloat(b.vatRate) - parseFloat(a.vatRate))
      .map((r) => {
        const vc = r.vatCodeId ? vatCodeMap.get(r.vatCodeId) : null;
        return {
          vatCodeId: r.vatCodeId,
          vatCode: vc?.code ?? null,
          vatCodeName: vc?.name ?? null,
          vatRate: r.vatRate,
          outputBase: fmt(r.outputBase),
          outputVat: fmt(r.outputVat),
          inputBase: fmt(r.inputBase),
          inputVat: fmt(r.inputVat),
          netVat: fmt(r.outputVat - r.inputVat),
        };
      });

    const totOutputBase = rows.reduce((s, r) => s + parseFloat(r.outputBase), 0);
    const totOutputVat = rows.reduce((s, r) => s + parseFloat(r.outputVat), 0);
    const totInputBase = rows.reduce((s, r) => s + parseFloat(r.inputBase), 0);
    const totInputVat = rows.reduce((s, r) => s + parseFloat(r.inputVat), 0);

    const totals = {
      vatCodeId: null,
      vatCode: null,
      vatCodeName: "SKUPAJ",
      vatRate: "-",
      outputBase: fmt(totOutputBase),
      outputVat: fmt(totOutputVat),
      inputBase: fmt(totInputBase),
      inputVat: fmt(totInputVat),
      netVat: fmt(totOutputVat - totInputVat),
    };

    res.json({ periodId: period.id, periodName: period.name, rows, totals });
  },
);

export default router;
