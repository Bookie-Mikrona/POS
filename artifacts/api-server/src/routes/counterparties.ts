import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, asc, desc } from "drizzle-orm";
import {
  db,
  counterpartiesTable,
  accountingRolesTable,
  counterpartyAccountTemplatesTable,
  accountsTable,
} from "@workspace/db";
import {
  CreateCounterpartyBody,
  UpdateCounterpartyBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { ajpesLookup, viesLookup, VIES_COUNTRIES } from "../lib/ajpesSim";

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

// POST /companies/:companyId/counterparties/ajpes-lookup
router.post(
  "/companies/:companyId/counterparties/ajpes-lookup",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { taxId } = req.body as { taxId?: string };
    if (!taxId || typeof taxId !== "string" || !taxId.trim()) {
      res.status(400).json({ error: "Davčna številka je obvezna" });
      return;
    }

    const cleaned = taxId.trim().toUpperCase().replace(/\s/g, "");
    const prefix = cleaned.match(/^([A-Z]{2})/)?.[1] ?? null;

    let result;
    if (!prefix || prefix === "SI") {
      // Slovenska davčna številka → AJPES
      result = await ajpesLookup(taxId);
    } else if (VIES_COUNTRIES.has(prefix)) {
      // EU tuji DDV zavezanec → VIES
      const vatNumber = cleaned.slice(2);
      result = await viesLookup(prefix, vatNumber);
    } else {
      // Zunaj-EU / neznana predpona — ni samodejne poizvedbe
      res.status(422).json({ error: `Samodejno iskanje za predpono "${prefix}" ni podprto. Podatke vnesite ročno.` });
      return;
    }

    res.json(result);
  },
);

// GET /companies/:companyId/counterparties
router.get(
  "/companies/:companyId/counterparties",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { type, search, includeInactive } = req.query as Record<string, string | undefined>;

    const conditions: ReturnType<typeof eq>[] = [
      eq(counterpartiesTable.companyId, companyId),
    ];
    if (includeInactive !== "true") {
      conditions.push(eq(counterpartiesTable.isActive, true));
    }
    if (type) conditions.push(eq(counterpartiesTable.type, type as any));

    let rows = await db
      .select()
      .from(counterpartiesTable)
      .where(and(...conditions))
      .orderBy(asc(counterpartiesTable.name));

    // Tekstovno iskanje po imenu ali davčni številki
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(s) ||
          (r.taxId ?? "").toLowerCase().includes(s) ||
          (r.city ?? "").toLowerCase().includes(s),
      );
    }

    res.json({ counterparties: rows });
  },
);

// POST /companies/:companyId/counterparties
router.post(
  "/companies/:companyId/counterparties",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za ustvarjanje partnerjev potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = CreateCounterpartyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [row] = await db
      .insert(counterpartiesTable)
      .values({ ...parsed.data, companyId })
      .returning();

    res.status(201).json(row);
  },
);

// GET /companies/:companyId/counterparties/:id
router.get(
  "/companies/:companyId/counterparties/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const [row] = await db
      .select()
      .from(counterpartiesTable)
      .where(
        and(
          eq(counterpartiesTable.id, id),
          eq(counterpartiesTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!row) {
      res.status(404).json({ error: "Partner ni najden" });
      return;
    }

    res.json(row);
  },
);

// GET /companies/:companyId/counterparties/:id/account-templates
router.get(
  "/companies/:companyId/counterparties/:id/account-templates",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const [cp] = await db
      .select({ id: counterpartiesTable.id })
      .from(counterpartiesTable)
      .where(and(eq(counterpartiesTable.id, id), eq(counterpartiesTable.companyId, companyId)))
      .limit(1);
    if (!cp) {
      res.status(404).json({ error: "Partner ni najden" });
      return;
    }

    const templates = await db
      .select({
        id: counterpartyAccountTemplatesTable.id,
        accountId: counterpartyAccountTemplatesTable.accountId,
        accountCode: accountsTable.code,
        accountName: accountsTable.name,
        documentType: counterpartyAccountTemplatesTable.documentType,
        lastLineDescription: counterpartyAccountTemplatesTable.lastLineDescription,
        usageCount: counterpartyAccountTemplatesTable.usageCount,
        lastUsedAt: counterpartyAccountTemplatesTable.lastUsedAt,
      })
      .from(counterpartyAccountTemplatesTable)
      .innerJoin(accountsTable, eq(counterpartyAccountTemplatesTable.accountId, accountsTable.id))
      .where(
        and(
          eq(counterpartyAccountTemplatesTable.companyId, companyId),
          eq(counterpartyAccountTemplatesTable.counterpartyId, id),
        ),
      )
      .orderBy(desc(counterpartyAccountTemplatesTable.usageCount));

    res.json({ templates });
  },
);

// PATCH /companies/:companyId/counterparties/:id
router.patch(
  "/companies/:companyId/counterparties/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);

    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za urejanje partnerjev potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = UpdateCounterpartyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select({ id: counterpartiesTable.id })
      .from(counterpartiesTable)
      .where(
        and(
          eq(counterpartiesTable.id, id),
          eq(counterpartiesTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Partner ni najden" });
      return;
    }

    const [updated] = await db
      .update(counterpartiesTable)
      .set(parsed.data)
      .where(eq(counterpartiesTable.id, id))
      .returning();

    res.json(updated);
  },
);

export default router;
