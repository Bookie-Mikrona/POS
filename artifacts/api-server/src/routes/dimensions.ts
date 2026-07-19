import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, asc } from "drizzle-orm";
import {
  db,
  costCentersTable,
  projectsTable,
  departmentsTable,
  accountingRolesTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import {
  CreateCostCenterBody,
  UpdateCostCenterBody,
  CreateProjectBody,
  UpdateProjectBody,
  CreateDepartmentBody,
  UpdateDepartmentBody,
} from "@workspace/api-zod";

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

// ─── Cost Centers ──────────────────────────────────────────────────────────────

router.get(
  "/companies/:companyId/cost-centers",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const includeInactive = req.query.includeInactive === "true";
    const conditions = [eq(costCentersTable.companyId, companyId)];
    if (!includeInactive) conditions.push(eq(costCentersTable.isActive, true));

    const rows = await db
      .select()
      .from(costCentersTable)
      .where(and(...conditions))
      .orderBy(asc(costCentersTable.code));
    res.json({ costCenters: rows });
  },
);

router.post(
  "/companies/:companyId/cost-centers",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za ustvarjanje stroškovnih mest potrebujete vlogo računovodja ali lastnik" });
      return;
    }
    const parsed = CreateCostCenterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [existing] = await db
      .select({ id: costCentersTable.id })
      .from(costCentersTable)
      .where(and(eq(costCentersTable.companyId, companyId), eq(costCentersTable.code, parsed.data.code)))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: `Stroškovno mesto s kodo "${parsed.data.code}" že obstaja` });
      return;
    }
    const [row] = await db
      .insert(costCentersTable)
      .values({ ...parsed.data, companyId, description: parsed.data.description ?? null })
      .returning();
    res.status(201).json(row);
  },
);

router.patch(
  "/companies/:companyId/cost-centers/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za urejanje stroškovnih mest potrebujete vlogo računovodja ali lastnik" });
      return;
    }
    const parsed = UpdateCostCenterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [existing] = await db
      .select({ id: costCentersTable.id })
      .from(costCentersTable)
      .where(and(eq(costCentersTable.id, id), eq(costCentersTable.companyId, companyId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Stroškovno mesto ni najdeno" });
      return;
    }
    const updateData: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if ("description" in parsed.data) updateData.description = parsed.data.description ?? null;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
    if (Object.keys(updateData).length === 0) {
      const [cur] = await db.select().from(costCentersTable).where(eq(costCentersTable.id, id)).limit(1);
      res.json(cur);
      return;
    }
    const [updated] = await db
      .update(costCentersTable)
      .set(updateData)
      .where(and(eq(costCentersTable.id, id), eq(costCentersTable.companyId, companyId)))
      .returning();
    res.json(updated);
  },
);

// ─── Projects ─────────────────────────────────────────────────────────────────

router.get(
  "/companies/:companyId/projects",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const includeInactive = req.query.includeInactive === "true";
    const conditions = [eq(projectsTable.companyId, companyId)];
    if (!includeInactive) conditions.push(eq(projectsTable.isActive, true));

    const rows = await db
      .select()
      .from(projectsTable)
      .where(and(...conditions))
      .orderBy(asc(projectsTable.code));
    res.json({ projects: rows });
  },
);

router.post(
  "/companies/:companyId/projects",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za ustvarjanje projektov potrebujete vlogo računovodja ali lastnik" });
      return;
    }
    const parsed = CreateProjectBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [existing] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.companyId, companyId), eq(projectsTable.code, parsed.data.code)))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: `Projekt s kodo "${parsed.data.code}" že obstaja` });
      return;
    }
    const [row] = await db
      .insert(projectsTable)
      .values({ ...parsed.data, companyId, description: parsed.data.description ?? null })
      .returning();
    res.status(201).json(row);
  },
);

router.patch(
  "/companies/:companyId/projects/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za urejanje projektov potrebujete vlogo računovodja ali lastnik" });
      return;
    }
    const parsed = UpdateProjectBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [existing] = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.companyId, companyId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Projekt ni najden" });
      return;
    }
    const updateData: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if ("description" in parsed.data) updateData.description = parsed.data.description ?? null;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
    if (Object.keys(updateData).length === 0) {
      const [cur] = await db.select().from(projectsTable).where(eq(projectsTable.id, id)).limit(1);
      res.json(cur);
      return;
    }
    const [updated] = await db
      .update(projectsTable)
      .set(updateData)
      .where(and(eq(projectsTable.id, id), eq(projectsTable.companyId, companyId)))
      .returning();
    res.json(updated);
  },
);

// ─── Departments ──────────────────────────────────────────────────────────────

router.get(
  "/companies/:companyId/departments",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const includeInactive = req.query.includeInactive === "true";
    const conditions = [eq(departmentsTable.companyId, companyId)];
    if (!includeInactive) conditions.push(eq(departmentsTable.isActive, true));

    const rows = await db
      .select()
      .from(departmentsTable)
      .where(and(...conditions))
      .orderBy(asc(departmentsTable.code));
    res.json({ departments: rows });
  },
);

router.post(
  "/companies/:companyId/departments",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za ustvarjanje oddelkov potrebujete vlogo računovodja ali lastnik" });
      return;
    }
    const parsed = CreateDepartmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [existing] = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.companyId, companyId), eq(departmentsTable.code, parsed.data.code)))
      .limit(1);
    if (existing) {
      res.status(409).json({ error: `Oddelek s kodo "${parsed.data.code}" že obstaja` });
      return;
    }
    const [row] = await db
      .insert(departmentsTable)
      .values({ ...parsed.data, companyId, description: parsed.data.description ?? null })
      .returning();
    res.status(201).json(row);
  },
);

router.patch(
  "/companies/:companyId/departments/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const id = extractParam(req.params.id);
    const access = await resolveAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za urejanje oddelkov potrebujete vlogo računovodja ali lastnik" });
      return;
    }
    const parsed = UpdateDepartmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [existing] = await db
      .select({ id: departmentsTable.id })
      .from(departmentsTable)
      .where(and(eq(departmentsTable.id, id), eq(departmentsTable.companyId, companyId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Oddelek ni najden" });
      return;
    }
    const updateData: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if ("description" in parsed.data) updateData.description = parsed.data.description ?? null;
    if (parsed.data.isActive !== undefined) updateData.isActive = parsed.data.isActive;
    if (Object.keys(updateData).length === 0) {
      const [cur] = await db.select().from(departmentsTable).where(eq(departmentsTable.id, id)).limit(1);
      res.json(cur);
      return;
    }
    const [updated] = await db
      .update(departmentsTable)
      .set(updateData)
      .where(and(eq(departmentsTable.id, id), eq(departmentsTable.companyId, companyId)))
      .returning();
    res.json(updated);
  },
);

export default router;
