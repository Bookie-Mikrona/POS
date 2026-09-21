/**
 * POS Nastavitve knjiženja — ERP API
 *
 * GET  /companies/:companyId/pos-booking-settings      — preberi nastavitve
 * PUT  /companies/:companyId/pos-booking-settings      — shrani nastavitve
 * POST /companies/:companyId/pos-booking-settings/sync/:datum  — ročni trigger za datum
 * POST /companies/:companyId/pos-booking-settings/sync-range    — ročni trigger za razpon
 */

import { Router, type Request, type Response, type IRouter } from "express";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  posBookingSettingsTable,
  posCategoryRevenueAccountsTable,
  accountingRolesTable,
  posUporabnikiTable,
  accountsTable,
  counterpartiesTable,
  vatCodeTable,
  racuniTable,
  journalEntriesTable,
  journalEntryLinesTable,
  enoteTable,
  kategorijeTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { syncPosBookingForDay, syncPosBookingForMonth } from "../lib/posSyncBooking";
import { UpdatePosBookingSettingsBody } from "@workspace/api-zod";

const router: IRouter = Router();

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

async function getTipJournalPreview(companyId: string, from: string, to: string) {
  const [summary] = await db.select({
    gross: sql<string>`COALESCE(SUM(CAST(${racuniTable.znesekNapitnina} AS numeric)), 0)`,
    employerRevenue: sql<string>`COALESCE(SUM(CASE WHEN ${racuniTable.tipPolicyMode} = 'employer_controlled' THEN CAST(${racuniTable.znesekNapitnina} AS numeric) ELSE 0 END), 0)`,
    employeeLiability: sql<string>`COALESCE(SUM(CASE WHEN ${racuniTable.tipPolicyMode} IN ('direct_employee','independent_pool') THEN CAST(${racuniTable.znesekNapitnina} AS numeric) - CASE WHEN ${racuniTable.tipCardFeeTreatment} = 'deduct_from_tip' THEN CAST(${racuniTable.tipCardFeeAmount} AS numeric) ELSE 0 END ELSE 0 END), 0)`,
    vat: sql<string>`COALESCE(SUM(CAST(${racuniTable.tipVatAmount} AS numeric)), 0)`,
    receiptCount: sql<number>`COUNT(*)`,
  }).from(racuniTable).innerJoin(enoteTable, eq(racuniTable.enotaId, enoteTable.id)).where(and(
    eq(enoteTable.companyId, companyId),
    sql`DATE(${racuniTable.ustvarjeno} AT TIME ZONE 'Europe/Ljubljana') >= ${from}`,
    sql`DATE(${racuniTable.ustvarjeno} AT TIME ZONE 'Europe/Ljubljana') <= ${to}`,
    sql`CAST(${racuniTable.znesekNapitnina} AS numeric) <> 0`,
  ));

  if (Number(summary?.receiptCount ?? 0) === 0) return { hasTips: false, entries: [] };
  const rows = await db.select({
    entryId: journalEntriesTable.id,
    entryDate: journalEntriesTable.entryDate,
    reference: journalEntriesTable.reference,
    description: journalEntriesTable.description,
    status: journalEntriesTable.status,
    accountCode: accountsTable.code,
    accountName: accountsTable.name,
    side: journalEntryLinesTable.side,
    amount: journalEntryLinesTable.amount,
    lineDescription: journalEntryLinesTable.description,
  }).from(journalEntryLinesTable)
    .innerJoin(journalEntriesTable, eq(journalEntryLinesTable.entryId, journalEntriesTable.id))
    .innerJoin(accountsTable, eq(journalEntryLinesTable.accountId, accountsTable.id))
    .where(and(
      eq(journalEntriesTable.companyId, companyId),
      gte(journalEntriesTable.entryDate, from),
      lte(journalEntriesTable.entryDate, to),
      eq(journalEntriesTable.createdBy, "pos-sync"),
      sql`LOWER(COALESCE(${journalEntryLinesTable.description}, '')) LIKE '%napitnin%'`,
    ));

  const entries = Object.values(rows.reduce<Record<string, {
    entryId: string; entryDate: string; reference: string; description: string; status: string;
    lines: Array<{ accountCode: string; accountName: string; side: string; amount: string; description: string | null }>;
  }>>((map, row) => {
    const current = map[row.entryId] ?? {
      entryId: row.entryId,
      entryDate: row.entryDate,
      reference: row.reference,
      description: row.description,
      status: row.status,
      lines: [],
    };
    current.lines.push({
      accountCode: row.accountCode,
      accountName: row.accountName,
      side: row.side,
      amount: String(row.amount),
      description: row.lineDescription,
    });
    map[row.entryId] = current;
    return map;
  }, {}));

  return {
    hasTips: true,
    summary: {
      gross: Number(summary?.gross ?? 0),
      employerRevenue: Number(summary?.employerRevenue ?? 0),
      employeeLiability: Number(summary?.employeeLiability ?? 0),
      vat: Number(summary?.vat ?? 0),
      receiptCount: Number(summary?.receiptCount ?? 0),
    },
    entries,
  };
}

/**
 * Dostop do POS nastavitev temeljnic.
 *
 * Računovodske vloge ostanejo primarni način dostopa za ERP. POS admin pa
 * potrebuje dostop tudi v podjetju brez GLK modula oziroma accounting_roles
 * vrstice. Druge POS vloge nimajo niti bralnega dostopa do teh nastavitev.
 */
async function resolvePosBookingAccess(
  clerkUserId: string,
  companyId: string,
  res: Response,
  action: "read" | "write",
): Promise<boolean> {
  const [accountingRole] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(
      and(
        eq(accountingRolesTable.clerkUserId, clerkUserId),
        eq(accountingRolesTable.companyId, companyId),
      ),
    )
    .limit(1);

  const [posRole] = await db
    .select({ vloga: posUporabnikiTable.vloga })
    .from(posUporabnikiTable)
    .where(
      and(
        eq(posUporabnikiTable.clerkUserId, clerkUserId),
        eq(posUporabnikiTable.companyId, companyId),
        eq(posUporabnikiTable.aktiven, true),
      ),
    )
    .limit(1);

  // Pravice se združijo: POS admin sme upravljati svoje POS nastavitve tudi,
  // če ima v GLK samo bralno vlogo. S tem POS admin brez GLK in POS admin z
  // GLK viewerjem dobita enako pravico do tega POS-specifičnega obrazca.
  if (posRole?.vloga === "admin") {
    return true;
  }

  if (accountingRole && (action === "read" || accountingRole.role !== "viewer")) {
    return true;
  }

  if (action === "write") {
    res.status(403).json({ error: "Samo lastnik ali računovodja lahko ureja nastavitve" });
  } else {
    res.status(403).json({ error: "Dostop do nastavitev knjiženja ni dovoljen" });
  }
  return false;
}

// ── Veljavni UUID ali null ────────────────────────────────────────────────────

function uuidOrNull(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null;
}

// ── Vsa polja s kontnimi nastavitvami ─────────────────────────────────────────

const ACCOUNT_FIELDS = [
  // T1 debet — plačila
  "cashAccountId",
  "bankAccountId",
  "cashInTransitAccountId",
  "cardAccountId",
  "tipsLiabilityAccountId",
  "tipsRevenueAccountId",
  "tipsVatAccountId",
  "tipsCardFeeExpenseAccountId",
  "voucherAccountId",
  "advancePaymentsAccountId",
  "otherPaymentAccountId",
  "contractReceivableTransitAccountId",
  "subsidyReceivableAccountId",
  // T1 kredit — prihodki po vrsti × DDV
  "revenueMaterial95AccountId",
  "revenueMaterial22AccountId",
  "revenueMaterial5AccountId",
  "revenueGoods22AccountId",
  "revenueGoods95AccountId",
  "revenueGoods5AccountId",
  "revenueService22AccountId",
  "revenueService95AccountId",
  "revenueService5AccountId",
  "revenueServiceAccountId",
  // T1 kredit — DDV
  "vat95AccountId",
  "vat5AccountId",
  "vat22AccountId",
  // T2 — prejemnice
  "inventoryMaterialAccountId",
  "inventoryGoodsAccountId",
  "payablesAccountId",
  "returnablePackagingAccountId",
  "nabavaObracunAccountId",
  "inputVatAccountId",
  "inputVat22AccountId",
  "inputVat95AccountId",
  "inputVat5AccountId",
  "otherCostsAccountId",
  "rawMaterialExpenseAccountId",
  "inboundFreightExpenseAccountId",
  // T3 — COGS
  "cogsMaterialAccountId",
  "cogsGoodsAccountId",
  // T4 — lastna poraba / reprezentanca + KIR
  "kirArAccountId",
  "lastnaPorabaAccountId",
  "reprezentancaAccountId",
  "wasteAccountId",
  // Začetna zaloga — otvoritvena temeljnica
  "openingBalanceAccountId",
  // ← zastareli fallback konti (ohranjeni za nazaj)
  "revenueAccountId",
  "vatLiabilityAccountId",
  "inventoryAccountId",
  "cogsAccountId",
] as const;

const COUNTERPARTY_FIELDS = [
  "subsidyCounterpartyId",
] as const;

const BOOLEAN_FIELDS = [
  "warnGiftVoucherNegative",
] as const;

/**
 * Polja ki so UUID reference na globalni vat_code šifrant (ne na accounts).
 * Validiramo ločeno — vat_code ni per-company.
 */
const VAT_CODE_FIELDS = [
  "vat5VatCodeId",
  "vat95VatCodeId",
  "vat22VatCodeId",
] as const;

const VAT_CODE_RATES: Record<(typeof VAT_CODE_FIELDS)[number], number> = {
  vat5VatCodeId: 5,
  vat95VatCodeId: 9.5,
  vat22VatCodeId: 22,
};

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseIsoDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function enumerateIsoDates(from: string, to: string): string[] | null {
  const start = parseIsoDate(from);
  const end = parseIsoDate(to);
  if (!start || !end || start > end) return null;
  const total = Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (total > 366) return null;
  return Array.from({ length: total }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
}

type BookingFrequency = "daily" | "monthly";

function isBookingFrequency(value: unknown): value is BookingFrequency {
  return value === "daily" || value === "monthly";
}

function firstDayOfNextMonthIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
}

async function getCategoryRevenueAccounts(companyId: string) {
  return db
    .select({
      categoryId: kategorijeTable.id,
      categoryName: kategorijeTable.ime,
      unitId: enoteTable.id,
      unitName: enoteTable.ime,
      accountId: posCategoryRevenueAccountsTable.accountId,
    })
    .from(kategorijeTable)
    .innerJoin(enoteTable, eq(enoteTable.id, kategorijeTable.enotaId))
    .leftJoin(
      posCategoryRevenueAccountsTable,
      and(
        eq(posCategoryRevenueAccountsTable.categoryId, kategorijeTable.id),
        eq(posCategoryRevenueAccountsTable.companyId, companyId),
      ),
    )
    .where(eq(enoteTable.companyId, companyId))
    .orderBy(
      asc(enoteTable.ime),
      asc(kategorijeTable.vrstniRed),
      asc(kategorijeTable.ime),
    );
}

// ── GET ───────────────────────────────────────────────────────────────────────

router.get(
  "/companies/:companyId/pos-booking-settings",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const ok = await resolvePosBookingAccess(authReq.clerkUserId, companyId, res, "read");
    if (!ok) return;

    const [settings] = await db
      .select()
      .from(posBookingSettingsTable)
      .where(eq(posBookingSettingsTable.companyId, companyId))
      .limit(1);

    res.json({
      ...(settings ?? { companyId }),
      categoryRevenueAccounts: await getCategoryRevenueAccounts(companyId),
    });
  },
);

// ── GET /vat-codes — veljavne izhodne FURS kode za POS obrazec ─────────────────

router.get(
  "/companies/:companyId/pos-booking-settings/vat-codes",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const ok = await resolvePosBookingAccess(authReq.clerkUserId, companyId, res, "read");
    if (!ok) return;

    const codes = await db
      .select({
        id: vatCodeTable.id,
        code: vatCodeTable.code,
        description: vatCodeTable.description,
        rate: vatCodeTable.rate,
      })
      .from(vatCodeTable)
      .where(
        and(
          eq(vatCodeTable.direction, "OUT"),
          lte(vatCodeTable.validFrom, todayIsoDate()),
          or(isNull(vatCodeTable.validTo), gte(vatCodeTable.validTo, todayIsoDate())),
        ),
      );

    res.json({ vatCodes: codes });
  },
);

// ── PUT ───────────────────────────────────────────────────────────────────────

router.put(
  "/companies/:companyId/pos-booking-settings",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const ok = await resolvePosBookingAccess(authReq.clerkUserId, companyId, res, "write");
    if (!ok) return;

    const contractBody = UpdatePosBookingSettingsBody.safeParse(req.body);
    if (!contractBody.success) {
      res.status(400).json({ error: contractBody.error.message });
      return;
    }
    const body = req.body as Record<string, unknown>;
    const categoryRevenueAccounts = "categoryRevenueAccounts" in body
      ? (body.categoryRevenueAccounts as Array<{ categoryId: number; accountId: string | null }>)
      : null;

    if (categoryRevenueAccounts) {
      const categoryIds = categoryRevenueAccounts.map((mapping) => mapping.categoryId);
      if (
        new Set(categoryIds).size !== categoryIds.length ||
        categoryRevenueAccounts.some((mapping) =>
          !Number.isInteger(mapping.categoryId) ||
          mapping.categoryId <= 0 ||
          (mapping.accountId !== null && uuidOrNull(mapping.accountId) === null),
        )
      ) {
        res.status(400).json({ error: "Preslikave kategorij vsebujejo neveljaven ali podvojen zapis" });
        return;
      }

      if (categoryIds.length > 0) {
        const ownedCategories = await db
          .select({ id: kategorijeTable.id })
          .from(kategorijeTable)
          .innerJoin(enoteTable, eq(enoteTable.id, kategorijeTable.enotaId))
          .where(and(
            eq(enoteTable.companyId, companyId),
            inArray(kategorijeTable.id, categoryIds),
          ));
        if (new Set(ownedCategories.map((category) => category.id)).size !== categoryIds.length) {
          res.status(400).json({ error: "Vse POS kategorije morajo pripadati izbranemu podjetju" });
          return;
        }
      }
    }

    const patch: Record<string, string | boolean | null> = {};
    const hasFrequencyPatch =
      "salesBookingFrequency" in body || "consumptionBookingFrequency" in body;

    if (hasFrequencyPatch) {
      const [current] = await db
        .select({
          salesBookingFrequency: posBookingSettingsTable.salesBookingFrequency,
          consumptionBookingFrequency: posBookingSettingsTable.consumptionBookingFrequency,
          frequencyEffectiveFrom: posBookingSettingsTable.frequencyEffectiveFrom,
          salesBookingFrequencyPrevious: posBookingSettingsTable.salesBookingFrequencyPrevious,
          consumptionBookingFrequencyPrevious: posBookingSettingsTable.consumptionBookingFrequencyPrevious,
        })
        .from(posBookingSettingsTable)
        .where(eq(posBookingSettingsTable.companyId, companyId))
        .limit(1);

      const configuredSales = (current?.salesBookingFrequency as BookingFrequency | undefined) ?? "daily";
      const configuredConsumption =
        (current?.consumptionBookingFrequency as BookingFrequency | undefined) ?? "monthly";
      const requestedSales = body.salesBookingFrequency ?? configuredSales;
      const requestedConsumption = body.consumptionBookingFrequency ?? configuredConsumption;
      if (!isBookingFrequency(requestedSales) || !isBookingFrequency(requestedConsumption)) {
        res.status(400).json({ error: "Frekvenca mora biti daily ali monthly" });
        return;
      }

      const today = todayIsoDate();
      const currentMonthStart = `${today.slice(0, 7)}-01`;
      const pending =
        typeof current?.frequencyEffectiveFrom === "string" &&
        current.frequencyEffectiveFrom > currentMonthStart;
      const activeSales = pending
        ? ((current?.salesBookingFrequencyPrevious as BookingFrequency | null) ?? "daily")
        : configuredSales;
      const activeConsumption = pending
        ? ((current?.consumptionBookingFrequencyPrevious as BookingFrequency | null) ?? "monthly")
        : configuredConsumption;

      patch.salesBookingFrequency = requestedSales;
      patch.consumptionBookingFrequency = requestedConsumption;
      if (requestedSales === activeSales && requestedConsumption === activeConsumption) {
        // Uporabnik je preklical čakajočo spremembo; tekoči mesec ostane
        // nespremenjen, nova nastavitev pa je takoj spet aktivna.
        patch.frequencyEffectiveFrom = null;
        patch.salesBookingFrequencyPrevious = null;
        patch.consumptionBookingFrequencyPrevious = null;
      } else if (
        requestedSales !== configuredSales ||
        requestedConsumption !== configuredConsumption ||
        !current?.frequencyEffectiveFrom
      ) {
        patch.frequencyEffectiveFrom = firstDayOfNextMonthIso();
        patch.salesBookingFrequencyPrevious = activeSales;
        patch.consumptionBookingFrequencyPrevious = activeConsumption;
      }
    }
    for (const field of ACCOUNT_FIELDS) {
      if (field in body) {
        patch[field] = uuidOrNull(body[field]);
      }
    }
    for (const field of VAT_CODE_FIELDS) {
      if (field in body) {
        patch[field] = uuidOrNull(body[field]);
      }
    }
    for (const field of COUNTERPARTY_FIELDS) {
      if (field in body) {
        patch[field] = uuidOrNull(body[field]);
      }
    }
    for (const field of BOOLEAN_FIELDS) {
      if (field in body) {
        if (typeof body[field] !== "boolean") {
          res.status(400).json({ error: "Nastavitev opozorila za darilne bone mora biti logična vrednost" });
          return;
        }
        patch[field] = body[field];
      }
    }

    // Preveri da vsi nastavljeni accountId-ji obstajajo in so del podjetja
    const accountPatch = Object.fromEntries(
      ACCOUNT_FIELDS.filter(f => f in patch).map(f => [f, patch[f]])
    );
    const nonNullAccountIds = [
      ...Object.values(accountPatch).filter((v): v is string => typeof v === "string"),
      ...(categoryRevenueAccounts ?? [])
        .map((mapping) => mapping.accountId)
        .filter((value): value is string => typeof value === "string"),
    ];
    if (nonNullAccountIds.length > 0) {
      const found = await db
        .select({ id: accountsTable.id, code: accountsTable.code, type: accountsTable.type })
        .from(accountsTable)
        .where(and(
          eq(accountsTable.companyId, companyId),
          eq(accountsTable.isActive, true),
          eq(accountsTable.allowsPosting, true),
          sql`char_length(${accountsTable.code}) = 7`,
        ));
      const foundSet = new Set(found.map(r => r.id));
      const missing = [...new Set(nonNullAccountIds)].filter(id => !foundSet.has(id));
      if (missing.length > 0) {
        res.status(400).json({
          error: "Konti morajo biti aktivni, proknjižljivi sedemmestni konti tega podjetja",
        });
        return;
      }
      const categoryAccountIds = new Set(
        (categoryRevenueAccounts ?? [])
          .map((mapping) => mapping.accountId)
          .filter((value): value is string => typeof value === "string"),
      );
      if (found.some((account) => categoryAccountIds.has(account.id) && account.type !== "revenue")) {
        res.status(400).json({ error: "POS kategorije je dovoljeno povezati samo s prihodkovnimi konti" });
        return;
      }
      // TRR in denar na poti sta bilančna konta. Brez te omejitve bi
      // napačna nastavitev nevidno spremenila prenos gotovine v prihodkovni ali
      // stroškovni dogodek.
      const codeById = new Map(found.map((row) => [row.id, row.code]));
      const packagingAccountId = patch.returnablePackagingAccountId ?? null;
      const payablesAccountId = patch.payablesAccountId ?? null;
      const packagingCode = typeof packagingAccountId === "string" ? codeById.get(packagingAccountId) : null;
      const payablesCode = typeof payablesAccountId === "string" ? codeById.get(payablesAccountId) : null;
      if (packagingAccountId && packagingCode !== "3107000") {
        res.status(400).json({ error: "Konto zaloge povratne embalaže mora biti 3107000" });
        return;
      }
      if (payablesAccountId && !payablesCode?.startsWith("220")) {
        res.status(400).json({ error: "Konto obveznosti do dobaviteljev mora biti iz razreda 220" });
        return;
      }
      for (const [field, label] of [
        ["rawMaterialExpenseAccountId", "neposrednega stroška surovin"],
        ["inboundFreightExpenseAccountId", "prevoznih storitev"],
      ] as const) {
        const id = patch[field] ?? null;
        const code = typeof id === "string" ? codeById.get(id) : null;
        if (id && !code?.startsWith("4")) {
          res.status(400).json({ error: `Konto ${label} mora biti v razredu 4` });
          return;
        }
      }
      const [current] = await db.select({
        bankAccountId: posBookingSettingsTable.bankAccountId,
        cashInTransitAccountId: posBookingSettingsTable.cashInTransitAccountId,
        advancePaymentsAccountId: posBookingSettingsTable.advancePaymentsAccountId,
        subsidyReceivableAccountId: posBookingSettingsTable.subsidyReceivableAccountId,
        contractReceivableTransitAccountId: posBookingSettingsTable.contractReceivableTransitAccountId,
        payablesAccountId: posBookingSettingsTable.payablesAccountId,
        returnablePackagingAccountId: posBookingSettingsTable.returnablePackagingAccountId,
        subsidyCounterpartyId: posBookingSettingsTable.subsidyCounterpartyId,
      }).from(posBookingSettingsTable).where(eq(posBookingSettingsTable.companyId, companyId)).limit(1);
      const bankAccountId = patch.bankAccountId ?? current?.bankAccountId ?? null;
      const cashInTransitAccountId = patch.cashInTransitAccountId ?? current?.cashInTransitAccountId ?? null;
      const advancePaymentsAccountId = patch.advancePaymentsAccountId ?? current?.advancePaymentsAccountId ?? null;
      const subsidyReceivableAccountId = patch.subsidyReceivableAccountId ?? current?.subsidyReceivableAccountId ?? null;
      const contractReceivableTransitAccountId = patch.contractReceivableTransitAccountId ?? current?.contractReceivableTransitAccountId ?? null;
      const subsidyCounterpartyId = patch.subsidyCounterpartyId ?? current?.subsidyCounterpartyId ?? null;
      const resolveCode = (id: string | boolean | null) => typeof id === "string" ? codeById.get(id) : null;
      const bankCode = resolveCode(bankAccountId);
      const transitCode = resolveCode(cashInTransitAccountId);
      const advanceCode = resolveCode(advancePaymentsAccountId);
      const subsidyCode = resolveCode(subsidyReceivableAccountId);
      const contractTransitCode = resolveCode(contractReceivableTransitAccountId);
      if ((bankAccountId && (!bankCode || !bankCode.startsWith("110") || bankCode.startsWith("109")))
        || (cashInTransitAccountId && (!transitCode || !transitCode.startsWith("109")))
        || (bankAccountId && bankAccountId === cashInTransitAccountId)) {
        res.status(400).json({ error: "TRR mora biti ločen konto 110…, Denar na poti pa ločen konto 109…." });
        return;
      }
      if (advancePaymentsAccountId && (!advanceCode || !advanceCode.startsWith("23"))) {
        res.status(400).json({ error: "Konto predplačil za darilne bone mora biti proknjižljiv konto razreda 23…" });
        return;
      }
      if (subsidyReceivableAccountId && (!subsidyCode || !subsidyCode.startsWith("16"))) {
        res.status(400).json({ error: "Konto terjatve za študentske bone mora biti proknjižljiv konto razreda 16 (praviloma 165…)." });
        return;
      }
      if (contractReceivableTransitAccountId && (!contractTransitCode || !contractTransitCode.startsWith("16"))) {
        res.status(400).json({ error: "Prehodni konto pogodbenih A-računov mora biti proknjižljiv konto razreda 16 (praviloma 165…)." });
        return;
      }
      if (subsidyCounterpartyId) {
        const [counterparty] = await db
          .select({ id: counterpartiesTable.id })
          .from(counterpartiesTable)
          .where(and(
            eq(counterpartiesTable.id, subsidyCounterpartyId as string),
            eq(counterpartiesTable.companyId, companyId),
          ))
          .limit(1);
        if (!counterparty) {
          res.status(400).json({ error: "Partner za študentske bone ne pripada izbranemu podjetju." });
          return;
        }
      }
    }
    // Partner preverjamo tudi, kadar računovodja spreminja samo partnerja in
    // konto terjatve že obstaja v shranjenih nastavitvah.
    if (patch.subsidyCounterpartyId) {
      const [counterparty] = await db
        .select({ id: counterpartiesTable.id })
        .from(counterpartiesTable)
        .where(and(
          eq(counterpartiesTable.id, patch.subsidyCounterpartyId as string),
          eq(counterpartiesTable.companyId, companyId),
        ))
        .limit(1);
      if (!counterparty) {
        res.status(400).json({ error: "Partner za študentske bone ne pripada izbranemu podjetju." });
        return;
      }
    }

    // Preveri smer, trenutno veljavnost in stopnjo DDV kode. Samo obstoj UUID-ja
    // ni dovolj: napačna FURS koda bi POS promet vpisala v napačno poročilno polje.
    const requestedVatCodes = VAT_CODE_FIELDS
      .filter((field) => patch[field] != null)
      .map((field) => ({ field, id: patch[field] as string }));

    const nonNullVatCodeIds = requestedVatCodes.map(({ id }) => id);
    if (nonNullVatCodeIds.length > 0) {
      const allVatCodes = await db
        .select({
          id: vatCodeTable.id,
          direction: vatCodeTable.direction,
          rate: vatCodeTable.rate,
          validFrom: vatCodeTable.validFrom,
          validTo: vatCodeTable.validTo,
        })
        .from(vatCodeTable)
        .where(inArray(vatCodeTable.id, nonNullVatCodeIds));
      const today = todayIsoDate();
      const validById = new Map(
        allVatCodes
          .filter((code) =>
            code.direction === "OUT" &&
            Number(code.rate) >= 0 &&
            code.validFrom <= today &&
            (code.validTo == null || code.validTo >= today),
          )
          .map((code) => [code.id, code]),
      );
      const invalidVat = requestedVatCodes.filter(({ field, id }) => {
        const code = validById.get(id);
        return !code || Number(code.rate) !== VAT_CODE_RATES[field];
      });
      if (invalidVat.length > 0) {
        res.status(400).json({ error: "DDV kode morajo biti veljavne izhodne kode z ustrezno stopnjo" });
        return;
      }
    }

    const upserted = await db.transaction(async (tx) => {
      const [savedSettings] = await tx
        .insert(posBookingSettingsTable)
        .values({
          companyId,
          ...patch,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: posBookingSettingsTable.companyId,
          set: {
            ...patch,
            updatedAt: new Date(),
          },
        })
        .returning();

      if (categoryRevenueAccounts) {
        for (const mapping of categoryRevenueAccounts) {
          if (mapping.accountId === null) {
            await tx
              .delete(posCategoryRevenueAccountsTable)
              .where(and(
                eq(posCategoryRevenueAccountsTable.companyId, companyId),
                eq(posCategoryRevenueAccountsTable.categoryId, mapping.categoryId),
              ));
          } else {
            await tx
              .insert(posCategoryRevenueAccountsTable)
              .values({
                companyId,
                categoryId: mapping.categoryId,
                accountId: mapping.accountId,
                updatedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [
                  posCategoryRevenueAccountsTable.companyId,
                  posCategoryRevenueAccountsTable.categoryId,
                ],
                set: {
                  accountId: mapping.accountId,
                  updatedAt: new Date(),
                },
              });
          }
        }
      }

      return savedSettings;
    });

    res.json({
      ...upserted,
      categoryRevenueAccounts: await getCategoryRevenueAccounts(companyId),
    });
  },
);

router.get(
  "/companies/:companyId/pos-booking-settings/tip-journal/:from/:to",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const from = extractParam(req.params.from);
    const to = extractParam(req.params.to);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      res.status(400).json({ error: "Neveljaven razpon datuma" });
      return;
    }
    if (!await resolvePosBookingAccess(authReq.clerkUserId, companyId, res, "read")) return;
    res.json(await getTipJournalPreview(companyId, from, to));
  },
);

// ── POST /sync/:datum — ročni trigger ─────────────────────────────────────────

router.post(
  "/companies/:companyId/pos-booking-settings/sync/:datum",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const datum = extractParam(req.params.datum);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
      res.status(400).json({ error: "Neveljaven datum — pričakujem YYYY-MM-DD" });
      return;
    }

    const ok = await resolvePosBookingAccess(authReq.clerkUserId, companyId, res, "write");
    if (!ok) return;

    try {
      const result = await syncPosBookingForDay(companyId, datum);
      res.json(result);
    } catch (err) {
      req.log?.error({ err, companyId, datum }, "POS sync napaka");
      res.status(500).json({ error: "Napaka pri sinhronizaciji POS temeljnic" });
    }
  },
);

// ── POST /sync-range — ročni trigger za največ 366 dni ───────────────────────

router.post(
  "/companies/:companyId/pos-booking-settings/sync-range",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const from = typeof req.body?.from === "string" ? req.body.from : "";
    const to = typeof req.body?.to === "string" ? req.body.to : "";
    const dates = enumerateIsoDates(from, to);

    if (!dates) {
      res.status(400).json({
        error: "Neveljaven razpon — datuma morata biti veljavna YYYY-MM-DD in največ 366 dni narazen",
      });
      return;
    }

    const ok = await resolvePosBookingAccess(authReq.clerkUserId, companyId, res, "write");
    if (!ok) return;

    res.status(200);
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.flushHeaders?.();

    const created: string[] = [];
    const skipped: Array<{ ref: string; reason: string }> = [];
    try {
      for (let index = 0; index < dates.length; index += 1) {
        const datum = dates[index];
        const result = await syncPosBookingForDay(companyId, datum);
        created.push(...result.created);
        skipped.push(...result.skipped);
        res.write(`${JSON.stringify({
          type: "progress",
          completed: index + 1,
          total: dates.length,
          datum,
          created: result.created.length,
          skipped: result.skipped.length,
        })}\n`);
      }
      res.write(`${JSON.stringify({
        type: "complete",
        total: dates.length,
        created,
        skipped,
      })}\n`);
      res.end();
    } catch (err) {
      req.log?.error({ err, companyId, from, to }, "POS sync razpona napaka");
      if (!res.headersSent) {
        res.status(500).json({ error: "Napaka pri sinhronizaciji POS temeljnic" });
      } else {
        res.write(`${JSON.stringify({ type: "error", error: "Napaka pri sinhronizaciji POS temeljnic" })}\n`);
        res.end();
      }
    }
  },
);

// ── POST /sync-month/:mesec — ročni mesečni zbirnik ───────────────────────────

router.post(
  "/companies/:companyId/pos-booking-settings/sync-month/:mesec",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const mesec = extractParam(req.params.mesec);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mesec)) {
      res.status(400).json({ error: "Neveljaven mesec — pričakujem YYYY-MM" });
      return;
    }
    const ok = await resolvePosBookingAccess(authReq.clerkUserId, companyId, res, "write");
    if (!ok) return;

    try {
      res.json(await syncPosBookingForMonth(companyId, mesec));
    } catch (err) {
      req.log?.error({ err, companyId, mesec }, "POS mesečni sync napaka");
      res.status(500).json({ error: "Napaka pri mesečni sinhronizaciji POS temeljnic" });
    }
  },
);

export default router;
