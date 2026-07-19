import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, asc, like } from "drizzle-orm";
import {
  db,
  vatCodesTable,
  accountsTable,
  accountingRolesTable,
} from "@workspace/db";
import { CreateVatCodeBody, UpdateVatCodeBody } from "@workspace/api-zod";
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

async function fetchVatCodeWithAccounts(id: string) {
  const [row] = await db
    .select({
      id: vatCodesTable.id,
      companyId: vatCodesTable.companyId,
      code: vatCodesTable.code,
      name: vatCodesTable.name,
      rate: vatCodesTable.rate,
      behavior: vatCodesTable.behavior,
      accountOutputId: vatCodesTable.accountOutputId,
      accountInputId: vatCodesTable.accountInputId,
      validFrom: vatCodesTable.validFrom,
      validTo: vatCodesTable.validTo,
      isActive: vatCodesTable.isActive,
      notes: vatCodesTable.notes,
      createdAt: vatCodesTable.createdAt,
      updatedAt: vatCodesTable.updatedAt,
    })
    .from(vatCodesTable)
    .where(eq(vatCodesTable.id, id))
    .limit(1);

  if (!row) return null;

  // Pridobi kode kontov
  const [outAcc] = row.accountOutputId
    ? await db.select({ code: accountsTable.code }).from(accountsTable).where(eq(accountsTable.id, row.accountOutputId)).limit(1)
    : [null];
  const [inAcc] = row.accountInputId
    ? await db.select({ code: accountsTable.code }).from(accountsTable).where(eq(accountsTable.id, row.accountInputId)).limit(1)
    : [null];

  return {
    ...row,
    accountOutputCode: outAcc?.code ?? null,
    accountInputCode: inAcc?.code ?? null,
  };
}

/** Slovenian standard VAT codes */
const STANDARD_SLO_VAT_CODES = [
  { code: "S22", name: "Standardna stopnja DDV 22%", rate: "22.00", behavior: "standard" as const, outputPrefix: "260", inputPrefix: "160" },
  { code: "S095", name: "Znižana stopnja DDV 9,5%", rate: "9.50", behavior: "standard" as const, outputPrefix: "260", inputPrefix: "160" },
  { code: "OP", name: "Oproščeno DDV 0%", rate: "0.00", behavior: "exempt" as const, outputPrefix: null, inputPrefix: null },
  { code: "NOP", name: "Neobdavčeno 0% (izvoz)", rate: "0.00", behavior: "zero_rated" as const, outputPrefix: null, inputPrefix: null },
  { code: "RC", name: "Obratna davčna obveznost (reverse charge)", rate: "0.00", behavior: "reverse_charge" as const, outputPrefix: null, inputPrefix: null },
];

// ─── GET /companies/:companyId/vat-codes ──────────────────────────────────────
router.get(
  "/companies/:companyId/vat-codes",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const includeInactive = req.query.includeInactive === "true";
    const conditions: ReturnType<typeof eq>[] = [eq(vatCodesTable.companyId, companyId)];
    if (!includeInactive) conditions.push(eq(vatCodesTable.isActive, true));

    const rows = await db
      .select({
        id: vatCodesTable.id,
        companyId: vatCodesTable.companyId,
        code: vatCodesTable.code,
        name: vatCodesTable.name,
        rate: vatCodesTable.rate,
        behavior: vatCodesTable.behavior,
        accountOutputId: vatCodesTable.accountOutputId,
        accountInputId: vatCodesTable.accountInputId,
        validFrom: vatCodesTable.validFrom,
        validTo: vatCodesTable.validTo,
        isActive: vatCodesTable.isActive,
        notes: vatCodesTable.notes,
        createdAt: vatCodesTable.createdAt,
        updatedAt: vatCodesTable.updatedAt,
      })
      .from(vatCodesTable)
      .where(and(...conditions))
      .orderBy(asc(vatCodesTable.code));

    // Pridobi kode kontov za vse
    const outputIds = rows.map((r) => r.accountOutputId).filter(Boolean) as string[];
    const inputIds = rows.map((r) => r.accountInputId).filter(Boolean) as string[];
    const allAccIds = [...new Set([...outputIds, ...inputIds])];

    const accRows = allAccIds.length
      ? await db.select({ id: accountsTable.id, code: accountsTable.code }).from(accountsTable).where(
          and(eq(accountsTable.companyId, companyId)),
        )
      : [];
    const accMap = new Map(accRows.map((a) => [a.id, a.code]));

    const vatCodes = rows.map((r) => ({
      ...r,
      accountOutputCode: r.accountOutputId ? (accMap.get(r.accountOutputId) ?? null) : null,
      accountInputCode: r.accountInputId ? (accMap.get(r.accountInputId) ?? null) : null,
    }));

    res.json({ vatCodes });
  },
);

// ─── POST /companies/:companyId/vat-codes/seed ────────────────────────────────
router.post(
  "/companies/:companyId/vat-codes/seed",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za ustvarjanje DDV kod potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    // Preveri, ali DDV kode že obstajajo
    const existing = await db
      .select({ id: vatCodesTable.id })
      .from(vatCodesTable)
      .where(eq(vatCodesTable.companyId, companyId))
      .limit(1);

    if (existing.length > 0) {
      res.status(400).json({ error: "DDV kode za to podjetje že obstajajo" });
      return;
    }

    // Pridobi obstoječe konte za avtomatično dodelitev DDV kontov
    const allAccounts = await db
      .select({ id: accountsTable.id, code: accountsTable.code })
      .from(accountsTable)
      .where(and(eq(accountsTable.companyId, companyId), eq(accountsTable.isActive, true)));

    function findAccountByPrefix(prefix: string | null): string | null {
      if (!prefix) return null;
      const match = allAccounts.filter((a) => a.code.startsWith(prefix)).sort((a, b) => a.code.localeCompare(b.code));
      return match[0]?.id ?? null;
    }

    const seeded = await db.transaction(async (tx) => {
      const inserted = await tx.insert(vatCodesTable).values(
        STANDARD_SLO_VAT_CODES.map((c) => ({
          companyId,
          code: c.code,
          name: c.name,
          rate: c.rate,
          behavior: c.behavior,
          accountOutputId: findAccountByPrefix(c.outputPrefix),
          accountInputId: findAccountByPrefix(c.inputPrefix),
          isActive: true,
        })),
      ).returning({ id: vatCodesTable.id });
      return inserted;
    });

    const codes = await Promise.all(seeded.map((s) => fetchVatCodeWithAccounts(s.id)));
    res.status(201).json({ seeded: seeded.length, codes: codes.filter(Boolean) });
  },
);

// ─── POST /companies/:companyId/vat-codes ─────────────────────────────────────
router.post(
  "/companies/:companyId/vat-codes",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za ustvarjanje DDV kod potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = CreateVatCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { code, name, rate, behavior, accountOutputId, accountInputId, validFrom, validTo, notes } = parsed.data;

    // Preveri unikatnost kode
    const [existing] = await db
      .select({ id: vatCodesTable.id })
      .from(vatCodesTable)
      .where(and(eq(vatCodesTable.companyId, companyId), eq(vatCodesTable.code, code)))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: `DDV koda '${code}' že obstaja` });
      return;
    }

    // Validacija FK kontov
    if (accountOutputId) {
      const [acc] = await db.select({ id: accountsTable.id }).from(accountsTable)
        .where(and(eq(accountsTable.id, accountOutputId), eq(accountsTable.companyId, companyId))).limit(1);
      if (!acc) { res.status(400).json({ error: "Konto izstopnega DDV ne obstaja" }); return; }
    }
    if (accountInputId) {
      const [acc] = await db.select({ id: accountsTable.id }).from(accountsTable)
        .where(and(eq(accountsTable.id, accountInputId), eq(accountsTable.companyId, companyId))).limit(1);
      if (!acc) { res.status(400).json({ error: "Konto vstopnega DDV ne obstaja" }); return; }
    }

    const toDateStr = (d: unknown): string | null => {
      if (!d) return null;
      if (d instanceof Date) return d.toISOString().slice(0, 10);
      return String(d);
    };

    const [inserted] = await db.insert(vatCodesTable).values({
      companyId,
      code,
      name,
      rate: rate.toFixed(2),
      behavior: (behavior ?? "standard") as any,
      accountOutputId: accountOutputId ?? null,
      accountInputId: accountInputId ?? null,
      validFrom: toDateStr(validFrom),
      validTo: toDateStr(validTo),
      notes: notes ?? null,
    }).returning({ id: vatCodesTable.id });

    const result = await fetchVatCodeWithAccounts(inserted.id);
    res.status(201).json(result);
  },
);

// ─── PATCH /companies/:companyId/vat-codes/:id ────────────────────────────────
router.patch(
  "/companies/:companyId/vat-codes/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za urejanje DDV kod potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = UpdateVatCodeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select({ id: vatCodesTable.id })
      .from(vatCodesTable)
      .where(and(eq(vatCodesTable.id, id), eq(vatCodesTable.companyId, companyId)))
      .limit(1);
    if (!existing) { res.status(404).json({ error: "DDV koda ni najdena" }); return; }

    const { name, rate, behavior, accountOutputId, accountInputId, validFrom, validTo, isActive, notes } = parsed.data;

    if (accountOutputId) {
      const [acc] = await db.select({ id: accountsTable.id }).from(accountsTable)
        .where(and(eq(accountsTable.id, accountOutputId), eq(accountsTable.companyId, companyId))).limit(1);
      if (!acc) { res.status(400).json({ error: "Konto izstopnega DDV ne obstaja" }); return; }
    }
    if (accountInputId) {
      const [acc] = await db.select({ id: accountsTable.id }).from(accountsTable)
        .where(and(eq(accountsTable.id, accountInputId), eq(accountsTable.companyId, companyId))).limit(1);
      if (!acc) { res.status(400).json({ error: "Konto vstopnega DDV ne obstaja" }); return; }
    }

    const toDateStr = (d: unknown): string | null => {
      if (!d) return null;
      if (d instanceof Date) return d.toISOString().slice(0, 10);
      return String(d);
    };

    await db.update(vatCodesTable).set({
      ...(name !== undefined && { name }),
      ...(rate !== undefined && { rate: rate.toFixed(2) }),
      ...(behavior !== undefined && { behavior: behavior as any }),
      ...(accountOutputId !== undefined && { accountOutputId }),
      ...(accountInputId !== undefined && { accountInputId }),
      ...(validFrom !== undefined && { validFrom: toDateStr(validFrom) }),
      ...(validTo !== undefined && { validTo: toDateStr(validTo) }),
      ...(isActive !== undefined && { isActive }),
      ...(notes !== undefined && { notes }),
    }).where(eq(vatCodesTable.id, id));

    const result = await fetchVatCodeWithAccounts(id);
    res.json(result);
  },
);

export default router;
