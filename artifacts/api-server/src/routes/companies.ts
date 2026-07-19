import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import { db, companiesTable, accountingRolesTable } from "@workspace/db";
import {
  CreateCompanyBody,
  AssignRoleBody,
} from "@workspace/api-zod";

interface UpdateCompanyFields {
  naziv?: string;
  kratekNaziv?: string | null;
  naslov?: string | null;
  postnaStevika?: string | null;
  kraj?: string | null;
}

function parseUpdateCompany(body: unknown): { ok: true; data: UpdateCompanyFields } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Telo zahteve mora biti objekt" };
  const b = body as Record<string, unknown>;
  const data: UpdateCompanyFields = {};
  if ("naziv" in b) {
    if (typeof b.naziv !== "string" || b.naziv.trim() === "") return { ok: false, error: "naziv mora biti neprazen niz" };
    data.naziv = b.naziv.trim();
  }
  for (const field of ["kratekNaziv", "naslov", "postnaStevika", "kraj"] as const) {
    if (field in b) {
      if (b[field] !== null && typeof b[field] !== "string") return { ok: false, error: `${field} mora biti niz ali null` };
      data[field] = b[field] as string | null;
    }
  }
  return { ok: true, data };
}
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

// GET /companies — seznam podjetij prijavljenega uporabnika
router.get(
  "/companies",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;

    const rows = await db
      .select({
        id: companiesTable.id,
        podjetjeDavcna: companiesTable.podjetjeDavcna,
        naziv: companiesTable.naziv,
        kratekNaziv: companiesTable.kratekNaziv,
        naslov: companiesTable.naslov,
        postnaStevika: companiesTable.postnaStevika,
        kraj: companiesTable.kraj,
        createdAt: companiesTable.createdAt,
        role: accountingRolesTable.role,
      })
      .from(accountingRolesTable)
      .innerJoin(
        companiesTable,
        eq(companiesTable.id, accountingRolesTable.companyId),
      )
      .where(eq(accountingRolesTable.clerkUserId, authReq.clerkUserId))
      .orderBy(companiesTable.naziv);

    res.json({ companies: rows });
  },
);

// POST /companies — ustvari novo podjetje, ustvarjalec dobi vlogo owner
router.post(
  "/companies",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;

    const parsed = CreateCompanyBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.podjetjeDavcna, parsed.data.podjetjeDavcna))
      .limit(1);

    if (existing) {
      res.status(409).json({ error: "Podjetje s to davčno številko že obstaja" });
      return;
    }

    const [company] = await db.transaction(async (tx) => {
      const [newCompany] = await tx
        .insert(companiesTable)
        .values(parsed.data)
        .returning();

      await tx.insert(accountingRolesTable).values({
        clerkUserId: authReq.clerkUserId,
        companyId: newCompany.id,
        role: "owner",
      });

      return [newCompany];
    });

    res.status(201).json({ ...company, role: "owner" });
  },
);

// GET /companies/:id — podrobnosti podjetja (pot :id je avtoritativna)
router.get(
  "/companies/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    // Preveri dostop — JOIN po companyId IZ poti, ne iz headerja
    const [row] = await db
      .select({
        id: companiesTable.id,
        podjetjeDavcna: companiesTable.podjetjeDavcna,
        naziv: companiesTable.naziv,
        kratekNaziv: companiesTable.kratekNaziv,
        naslov: companiesTable.naslov,
        postnaStevika: companiesTable.postnaStevika,
        kraj: companiesTable.kraj,
        createdAt: companiesTable.createdAt,
        role: accountingRolesTable.role,
      })
      .from(accountingRolesTable)
      .innerJoin(
        companiesTable,
        eq(companiesTable.id, accountingRolesTable.companyId),
      )
      .where(
        and(
          eq(accountingRolesTable.clerkUserId, authReq.clerkUserId),
          eq(accountingRolesTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!row) {
      // Razlikujemo: ali podjetje sploh obstaja ali samo nima dostopa
      const [exists] = await db
        .select({ id: companiesTable.id })
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId))
        .limit(1);

      if (!exists) {
        res.status(404).json({ error: "Podjetje ni najdeno" });
      } else {
        res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" });
      }
      return;
    }

    res.json(row);
  },
);

// PATCH /companies/:id — posodobi podatke podjetja (samo owner)
router.patch(
  "/companies/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const [callerRole] = await db
      .select({ role: accountingRolesTable.role })
      .from(accountingRolesTable)
      .where(and(eq(accountingRolesTable.clerkUserId, authReq.clerkUserId), eq(accountingRolesTable.companyId, companyId)))
      .limit(1);

    if (!callerRole) { res.status(403).json({ error: "Dostop ni dovoljen" }); return; }
    if (callerRole.role !== "owner") { res.status(403).json({ error: "Za urejanje podatkov podjetja potrebujete vlogo lastnik" }); return; }

    const parsed = parseUpdateCompany(req.body);
    if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }

    const [updated] = await db
      .update(companiesTable)
      .set({ ...parsed.data, updatedAt: new Date() } as Partial<typeof companiesTable.$inferInsert>)
      .where(eq(companiesTable.id, companyId))
      .returning();

    if (!updated) { res.status(404).json({ error: "Podjetje ni najdeno" }); return; }

    res.json({ ...updated, role: callerRole.role });
  },
);

// GET /companies/:id/roles — seznam vlog za podjetje (samo member+)
router.get(
  "/companies/:id/roles",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const [callerRole] = await db
      .select({ role: accountingRolesTable.role })
      .from(accountingRolesTable)
      .where(and(eq(accountingRolesTable.clerkUserId, authReq.clerkUserId), eq(accountingRolesTable.companyId, companyId)))
      .limit(1);

    if (!callerRole) { res.status(403).json({ error: "Dostop ni dovoljen" }); return; }

    const roles = await db
      .select({
        clerkUserId: accountingRolesTable.clerkUserId,
        role: accountingRolesTable.role,
        createdAt: accountingRolesTable.createdAt,
      })
      .from(accountingRolesTable)
      .where(eq(accountingRolesTable.companyId, companyId))
      .orderBy(accountingRolesTable.createdAt);

    res.json(roles);
  },
);

// DELETE /companies/:id/roles/:clerkUserId — odstrani vlogo (samo owner, ne more odstraniti sebe)
router.delete(
  "/companies/:id/roles/:clerkUserId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const targetUserId = Array.isArray(req.params.clerkUserId) ? req.params.clerkUserId[0] : req.params.clerkUserId;

    const [callerRole] = await db
      .select({ role: accountingRolesTable.role })
      .from(accountingRolesTable)
      .where(and(eq(accountingRolesTable.clerkUserId, authReq.clerkUserId), eq(accountingRolesTable.companyId, companyId)))
      .limit(1);

    if (!callerRole) { res.status(403).json({ error: "Dostop ni dovoljen" }); return; }
    if (callerRole.role !== "owner") { res.status(403).json({ error: "Za odstranjevanje vlog potrebujete vlogo lastnik" }); return; }
    if (targetUserId === authReq.clerkUserId) { res.status(400).json({ error: "Ne morete odstraniti lastne vloge" }); return; }

    await db
      .delete(accountingRolesTable)
      .where(and(eq(accountingRolesTable.clerkUserId, targetUserId), eq(accountingRolesTable.companyId, companyId)));

    res.status(204).send();
  },
);

// POST /companies/:id/roles — dodeli vlogo (samo owner, pot :id je avtoritativna)
router.post(
  "/companies/:id/roles",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    // Preveri, da je klic owner tega podjetja (pot :id)
    const [callerRole] = await db
      .select({ role: accountingRolesTable.role })
      .from(accountingRolesTable)
      .where(
        and(
          eq(accountingRolesTable.clerkUserId, authReq.clerkUserId),
          eq(accountingRolesTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!callerRole) {
      const [exists] = await db
        .select({ id: companiesTable.id })
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId))
        .limit(1);

      if (!exists) {
        res.status(404).json({ error: "Podjetje ni najdeno" });
      } else {
        res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" });
      }
      return;
    }

    if (callerRole.role !== "owner") {
      res.status(403).json({ error: "Za dodeljevanje vlog potrebujete vlogo lastnik" });
      return;
    }

    const parsed = AssignRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [role] = await db
      .insert(accountingRolesTable)
      .values({
        clerkUserId: parsed.data.clerkUserId,
        companyId,
        role: parsed.data.role,
      })
      .onConflictDoUpdate({
        target: [
          accountingRolesTable.clerkUserId,
          accountingRolesTable.companyId,
        ],
        set: { role: parsed.data.role, updatedAt: new Date() },
      })
      .returning();

    res.json({
      companyId: role.companyId,
      clerkUserId: role.clerkUserId,
      role: role.role,
    });
  },
);

export default router;
