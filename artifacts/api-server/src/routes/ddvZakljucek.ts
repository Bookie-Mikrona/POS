/**
 * DDV zaključek — zaključna temeljnica DDV obveznosti/terjatve
 *
 * GET  /companies/:companyId/ddv-zakljucek-settings  — nastavitve (neto konti)
 * PUT  /companies/:companyId/ddv-zakljucek-settings  — shrani nastavitve
 * POST /companies/:companyId/ddv-zakljucek-osnutek   — generiraj/predogled zaključne temeljnice
 */

import { Router, type Request, type Response, type IRouter } from "express";
import { and, eq, gte, lte, or, like, sql } from "drizzle-orm";
import Decimal from "decimal.js";
import {
  db,
  ddvZakljucekSettingsTable,
  accountsTable,
  journalEntriesTable,
  journalEntryLinesTable,
  accountingPeriodsTable,
  accountingRolesTable,
  auditLogTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function resolveOwnerOrAccountant(
  clerkUserId: string,
  companyId: string,
  res: Response,
): Promise<boolean> {
  const [row] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(and(eq(accountingRolesTable.clerkUserId, clerkUserId), eq(accountingRolesTable.companyId, companyId)))
    .limit(1);
  if (!row) { res.status(403).json({ error: "Dostop ni dovoljen" }); return false; }
  if (row.role === "viewer") { res.status(403).json({ error: "Samo lastnik ali računovodja" }); return false; }
  return true;
}

// ─── Period bounds (enaka logika kot vatLedgerReport.ts) ─────────────────────

function periodBounds(year: number, period: string): { from: string; to: string } | null {
  const mm = parseInt(period.slice(2), 10);
  if (isNaN(mm) || mm < 1 || mm > 12) return null;
  const isQuarterly = [3, 6, 9, 12].includes(mm);
  const endMonth = mm;
  const startMonth = isQuarterly ? mm - 2 : mm;
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastDay = new Date(year, endMonth, 0).getDate();
  return { from: `${year}-${pad(startMonth)}-01`, to: `${year}-${pad(endMonth)}-${pad(lastDay)}` };
}

// ─── Pridobi ali ustvari konto po kodi ───────────────────────────────────────

async function getOrCreateAccount(
  companyId: string,
  code: string,
  name: string,
  type: "asset" | "liability" | "equity" | "revenue" | "expense",
): Promise<string> {
  const [existing] = await db
    .select({ id: accountsTable.id })
    .from(accountsTable)
    .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.code, code)))
    .limit(1);
  if (existing) return existing.id;

  // Poišči starša (koda brez zadnje cifre)
  const parentCode = code.slice(0, -1);
  let parentId: string | null = null;
  if (parentCode.length > 0) {
    const [parent] = await db
      .select({ id: accountsTable.id })
      .from(accountsTable)
      .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.code, parentCode)))
      .limit(1);
    parentId = parent?.id ?? null;
  }

  const [created] = await db
    .insert(accountsTable)
    .values({ companyId, code, name, type, parentId, isActive: true, allowsPosting: true })
    .returning({ id: accountsTable.id });
  return created.id;
}

// ─── UUID ali null ────────────────────────────────────────────────────────────

function uuidOrNull(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

// ─── GET /companies/:companyId/ddv-zakljucek-settings ────────────────────────

router.get(
  "/companies/:companyId/ddv-zakljucek-settings",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    // Preveri dostop
    const [roleRow] = await db
      .select({ role: accountingRolesTable.role })
      .from(accountingRolesTable)
      .where(and(eq(accountingRolesTable.clerkUserId, authReq.clerkUserId), eq(accountingRolesTable.companyId, companyId)))
      .limit(1);
    if (!roleRow) { res.status(403).json({ error: "Dostop ni dovoljen" }); return; }

    const [row] = await db
      .select()
      .from(ddvZakljucekSettingsTable)
      .where(eq(ddvZakljucekSettingsTable.companyId, companyId))
      .limit(1);

    res.json(row ?? null);
  },
);

// ─── PUT /companies/:companyId/ddv-zakljucek-settings ────────────────────────

router.put(
  "/companies/:companyId/ddv-zakljucek-settings",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    if (!await resolveOwnerOrAccountant(authReq.clerkUserId, companyId, res)) return;

    const netoObveznostAccountId = uuidOrNull(req.body.netoObveznostAccountId);
    const netoTerjatevAccountId = uuidOrNull(req.body.netoTerjatevAccountId);

    // Preveri, da sta konti veljavni in v istem podjetju
    for (const accId of [netoObveznostAccountId, netoTerjatevAccountId]) {
      if (!accId) continue;
      const [acc] = await db
        .select({ id: accountsTable.id })
        .from(accountsTable)
        .where(and(eq(accountsTable.id, accId), eq(accountsTable.companyId, companyId)))
        .limit(1);
      if (!acc) { res.status(400).json({ error: `Konto ${accId} ne obstaja ali ne pripada temu podjetju` }); return; }
    }

    const [upserted] = await db
      .insert(ddvZakljucekSettingsTable)
      .values({ companyId, netoObveznostAccountId, netoTerjatevAccountId })
      .onConflictDoUpdate({
        target: ddvZakljucekSettingsTable.companyId,
        set: { netoObveznostAccountId, netoTerjatevAccountId, updatedAt: new Date() },
      })
      .returning();

    res.json(upserted);
  },
);

// ─── POST /companies/:companyId/ddv-zakljucek-osnutek ────────────────────────

/**
 * Generira zaključno DDV temeljnico za izbrano DDV obdobje.
 *
 * Body: { year: number, period: string, vraciloChoice: "vracilo"|"prenos"|null, dryRun?: boolean }
 *
 * dryRun=true → vrne preview (brez vpisa v bazo)
 * dryRun=false → ustvari osnutek temeljnice in vrne entryId
 *
 * Logika:
 *  - Poišče salde vseh izstopnih DDV kontov (koda LIKE '160%' = vstopni in '260%' = izstopni)
 *    za poknjižene vnose znotraj datumskih meja DDV obdobja
 *  - 26x konto z neto kreditnim saldom → DEBET (zapiramo ga)
 *  - 16x konto z neto debetnim saldom → KREDIT (zapiramo ga)
 *  - Neto razlika → K 2609000 (obveznost) ali D 1609000 (presežek)
 *  - Temeljnica je vedno OSNUTEK — računovodja jo ročno potrdi
 */
router.post(
  "/companies/:companyId/ddv-zakljucek-osnutek",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    if (!await resolveOwnerOrAccountant(authReq.clerkUserId, companyId, res)) return;

    const { year, period, vraciloChoice, dryRun = false } = req.body as {
      year: number;
      period: string;
      vraciloChoice: "vracilo" | "prenos" | null;
      dryRun?: boolean;
    };

    if (!year || !period) { res.status(400).json({ error: "Manjkata year in period" }); return; }

    const bounds = periodBounds(Number(year), String(period));
    if (!bounds) { res.status(400).json({ error: "Neveljavno DDV obdobje" }); return; }

    // ── 1. Nastavitve — neto konti ───────────────────────────────────────────
    const [settingsRow] = await db
      .select()
      .from(ddvZakljucekSettingsTable)
      .where(eq(ddvZakljucekSettingsTable.companyId, companyId))
      .limit(1);

    // Pridobi ali ustvari konta 2609000 in 1609000
    let netoObveznostAccountId = settingsRow?.netoObveznostAccountId ?? null;
    let netoTerjatevAccountId = settingsRow?.netoTerjatevAccountId ?? null;

    if (!netoObveznostAccountId) {
      netoObveznostAccountId = await getOrCreateAccount(
        companyId, "2609000", "Obveznost za DDV po obračunu (DDV-O)", "liability",
      );
    }
    if (!netoTerjatevAccountId) {
      netoTerjatevAccountId = await getOrCreateAccount(
        companyId, "1609000", "Terjatev za presežek DDV (DDV-O)", "asset",
      );
    }

    // ── 2. Saldi DDV kontov za obdobje ──────────────────────────────────────
    // 16x = vstopni DDV (terjatve), 26x = izstopni DDV (obveznosti)
    // Iščemo samo posted temeljnice z entry_date znotraj meja
    const balanceRows = await db
      .select({
        accountId: accountsTable.id,
        code: accountsTable.code,
        name: accountsTable.name,
        debitTotal: sql<string>`COALESCE(SUM(CASE WHEN ${journalEntryLinesTable.side} = 'debit' THEN ${journalEntryLinesTable.amount}::numeric ELSE 0 END), 0)`,
        creditTotal: sql<string>`COALESCE(SUM(CASE WHEN ${journalEntryLinesTable.side} = 'credit' THEN ${journalEntryLinesTable.amount}::numeric ELSE 0 END), 0)`,
      })
      .from(journalEntryLinesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
      .innerJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
      .where(
        and(
          eq(journalEntriesTable.companyId, companyId),
          eq(accountsTable.companyId, companyId),
          eq(journalEntriesTable.status, "posted"),
          gte(journalEntriesTable.entryDate, bounds.from),
          lte(journalEntriesTable.entryDate, bounds.to),
          or(
            like(accountsTable.code, "160%"),
            like(accountsTable.code, "260%"),
          ),
        ),
      )
      .groupBy(accountsTable.id, accountsTable.code, accountsTable.name)
      .orderBy(accountsTable.code);

    // ── 3. Izračun zapiralnih vrstic ─────────────────────────────────────────
    type ClosingLine = {
      accountId: string;
      code: string;
      name: string;
      side: "debit" | "credit";
      amount: string;
      description: string;
    };

    const lines: ClosingLine[] = [];
    let izstopniSum = new Decimal(0);  // neto saldo 26x (kredit-debet)
    let vstopniSum = new Decimal(0);   // neto saldo 16x (debet-kredit)

    const periodLabel = `${year}/${period}`;

    for (const row of balanceRows) {
      const debit = new Decimal(row.debitTotal);
      const credit = new Decimal(row.creditTotal);

      if (row.code.startsWith("260")) {
        // Izstopni DDV — normalni saldo kredit
        const balance = credit.minus(debit);
        if (balance.gt(0.001)) {
          // Da zapremo kredit → knjižimo DEBET
          lines.push({
            accountId: row.accountId,
            code: row.code,
            name: row.name,
            side: "debit",
            amount: balance.toFixed(2),
            description: `Zapiranje izstopnega DDV ${row.code} — ${periodLabel}`,
          });
          izstopniSum = izstopniSum.plus(balance);
        }
      } else if (row.code.startsWith("160")) {
        // Vstopni DDV — normalni saldo debet
        const balance = debit.minus(credit);
        if (balance.gt(0.001)) {
          // Da zapremo debet → knjižimo KREDIT
          lines.push({
            accountId: row.accountId,
            code: row.code,
            name: row.name,
            side: "credit",
            amount: balance.toFixed(2),
            description: `Zapiranje vstopnega DDV ${row.code} — ${periodLabel}`,
          });
          vstopniSum = vstopniSum.plus(balance);
        }
      }
    }

    // ── 4. Neto razlika ──────────────────────────────────────────────────────
    const netoDdv = izstopniSum.minus(vstopniSum);
    let netType: "obveznost" | "presežek" | "nič" = "nič";

    if (netoDdv.gt(0.001)) {
      // Obveznost → K 2609000
      netType = "obveznost";
      lines.push({
        accountId: netoObveznostAccountId,
        code: "2609000",
        name: "Obveznost za DDV po obračunu (DDV-O)",
        side: "credit",
        amount: netoDdv.toFixed(2),
        description: `Neto DDV obveznost za plačilo FURS — ${periodLabel}`,
      });
    } else if (netoDdv.lt(-0.001)) {
      // Presežek → D 1609000
      netType = "presežek";
      const absNet = netoDdv.abs();
      const presezekLabel = vraciloChoice === "vracilo"
        ? `Neto DDV presežek — zahteva za vračilo FURS — ${periodLabel}`
        : vraciloChoice === "prenos"
          ? `Neto DDV presežek — prenos v naslednje obdobje — ${periodLabel}`
          : `Neto DDV presežek (terjatev od FURS) — ${periodLabel}`;
      lines.push({
        accountId: netoTerjatevAccountId,
        code: "1609000",
        name: "Terjatev za presežek DDV (DDV-O)",
        side: "debit",
        amount: absNet.toFixed(2),
        description: presezekLabel,
      });
    }

    // ── 5. Validacija uravnoteženosti ────────────────────────────────────────
    if (lines.length < 2) {
      res.status(422).json({
        error: "Za to obdobje ni dovolj poknjiženih DDV vpisov za zaključno temeljnico",
        periodFrom: bounds.from,
        periodTo: bounds.to,
        linesFound: lines.length,
      });
      return;
    }

    const debitTotal = lines
      .filter(l => l.side === "debit")
      .reduce((s, l) => s.plus(l.amount), new Decimal(0));
    const creditTotal = lines
      .filter(l => l.side === "credit")
      .reduce((s, l) => s.plus(l.amount), new Decimal(0));

    if (!debitTotal.minus(creditTotal).abs().lt(0.01)) {
      res.status(500).json({
        error: "Interna napaka: temeljnica ni uravnotežena",
        debitTotal: debitTotal.toFixed(2),
        creditTotal: creditTotal.toFixed(2),
      });
      return;
    }

    // ── 6. Preveri dvojnik ───────────────────────────────────────────────────
    const duplicateRef = `DDV-ZAKLJUCEK:${year}-${period}`;
    const [existing] = await db
      .select({ id: journalEntriesTable.id, status: journalEntriesTable.status })
      .from(journalEntriesTable)
      .where(
        and(
          eq(journalEntriesTable.companyId, companyId),
          eq(journalEntriesTable.reference, duplicateRef),
        ),
      )
      .limit(1);

    // ── 7. DryRun — vrni preview brez vpisa ─────────────────────────────────
    if (dryRun) {
      res.json({
        dryRun: true,
        periodFrom: bounds.from,
        periodTo: bounds.to,
        period: periodLabel,
        lines,
        debitTotal: debitTotal.toFixed(2),
        creditTotal: creditTotal.toFixed(2),
        netAmount: netoDdv.abs().toFixed(2),
        netType,
        vraciloChoice: vraciloChoice ?? null,
        existingEntry: existing ? { id: existing.id, status: existing.status } : null,
      });
      return;
    }

    // ── 8. Prepreči dvojnik (samo pri dejanskem vpisu) ───────────────────────
    if (existing) {
      res.status(409).json({
        error: `Zaključna DDV temeljnica za to obdobje že obstaja (${existing.status})`,
        existingEntryId: existing.id,
        existingStatus: existing.status,
      });
      return;
    }

    // ── 9. Poišči računovodsko obdobje (po zadnjem dnevu DDV obdobja) ────────
    const [period_] = await db
      .select({ id: accountingPeriodsTable.id, status: accountingPeriodsTable.status })
      .from(accountingPeriodsTable)
      .where(
        and(
          eq(accountingPeriodsTable.companyId, companyId),
          sql`${accountingPeriodsTable.startDate} <= ${bounds.to}`,
          sql`${accountingPeriodsTable.endDate} >= ${bounds.to}`,
        ),
      )
      .orderBy(accountingPeriodsTable.endDate)
      .limit(1);

    if (!period_) {
      res.status(404).json({
        error: `Ni odprtega računovodskega obdobja za datum ${bounds.to}. Ustvarite ga v razdelku Obdobja.`,
      });
      return;
    }

    if (period_.status === "locked") {
      res.status(400).json({ error: "Računovodsko obdobje je zaklenjeno." });
      return;
    }

    // ── 10. Ustvari osnutek temeljnice ───────────────────────────────────────
    const entryDate = bounds.to; // datum na zadnji dan DDV obdobja

    const descriptionParts = [`DDV zaključek ${periodLabel} — ${bounds.from} do ${bounds.to}`];
    if (vraciloChoice === "vracilo") descriptionParts.push("Presežek: zahteva za vračilo");
    if (vraciloChoice === "prenos") descriptionParts.push("Presežek: prenos v naslednje obdobje");
    const description = descriptionParts.join(" · ");

    const entry = await db.transaction(async (tx) => {
      const [newEntry] = await tx
        .insert(journalEntriesTable)
        .values({
          companyId,
          periodId: period_.id,
          documentDate: entryDate,
          entryDate,
          taxDate: entryDate,
          description,
          reference: duplicateRef,
          status: "draft",
          sourceType: "manual" as const,  // DDV zaključek — prepoznaven po reference
          createdBy: authReq.clerkUserId,
        })
        .returning({ id: journalEntriesTable.id });

      await tx.insert(journalEntryLinesTable).values(
        lines.map((l, i) => ({
          entryId: newEntry.id,
          accountId: l.accountId,
          side: l.side as "debit" | "credit",
          amount: l.amount,
          description: l.description,
          sequence: i,
        })),
      );

      await tx.insert(auditLogTable).values({
        companyId,
        entityType: "journal_entry",
        entityId: newEntry.id,
        action: "create",
        changedBy: authReq.clerkUserId,
        payload: {
          type: "ddv_zakljucek",
          period: periodLabel,
          netType,
          lineCount: lines.length,
          vraciloChoice: vraciloChoice ?? null,
        },
      });

      return newEntry;
    });

    res.status(201).json({
      entryId: entry.id,
      reference: duplicateRef,
      periodFrom: bounds.from,
      periodTo: bounds.to,
      period: periodLabel,
      lines,
      debitTotal: debitTotal.toFixed(2),
      creditTotal: creditTotal.toFixed(2),
      netAmount: netoDdv.abs().toFixed(2),
      netType,
      vraciloChoice: vraciloChoice ?? null,
    });
  },
);

export default router;
