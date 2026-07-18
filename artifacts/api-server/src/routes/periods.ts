import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, asc, lt, gt } from "drizzle-orm";
import { db, accountingPeriodsTable, accountingRolesTable } from "@workspace/db";
import { CreatePeriodBody, UpdatePeriodBody } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Pomožna funkcija: razreši dostop in vlogo za podjetje iz poti
async function resolveAccess(
  req: AuthenticatedRequest,
  companyId: string,
  res: Response,
): Promise<{ role: "owner" | "accountant" | "viewer" } | null> {
  const [row] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(
      and(
        eq(accountingRolesTable.clerkUserId, req.clerkUserId),
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

// GET /companies/:companyId/periods
router.get(
  "/companies/:companyId/periods",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = Array.isArray(req.params.companyId)
      ? req.params.companyId[0]
      : req.params.companyId;

    const access = await resolveAccess(authReq, companyId, res);
    if (!access) return;

    const periods = await db
      .select()
      .from(accountingPeriodsTable)
      .where(eq(accountingPeriodsTable.companyId, companyId))
      .orderBy(asc(accountingPeriodsTable.startDate));

    res.json({ periods });
  },
);

// POST /companies/:companyId/periods
router.post(
  "/companies/:companyId/periods",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = Array.isArray(req.params.companyId)
      ? req.params.companyId[0]
      : req.params.companyId;

    const access = await resolveAccess(authReq, companyId, res);
    if (!access) return;
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za ustvarjanje obdobij potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = CreatePeriodBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // z.coerce.date() vrne Date objekt; Drizzle date(mode:"string") pričakuje string
    const startDate = (parsed.data.startDate as unknown as Date).toISOString().slice(0, 10);
    const endDate = (parsed.data.endDate as unknown as Date).toISOString().slice(0, 10);

    if (startDate >= endDate) {
      res.status(400).json({ error: "Datum konca mora biti po datumu začetka" });
      return;
    }

    // Preveri prekrivanje z obstoječimi obdobji za isto podjetje.
    // Dve obdobji se prekrivata ko: obstoječe.startDate < novoEndDate AND obstoječe.endDate > novoStartDate
    const [overlap] = await db
      .select({ id: accountingPeriodsTable.id, name: accountingPeriodsTable.name })
      .from(accountingPeriodsTable)
      .where(
        and(
          eq(accountingPeriodsTable.companyId, companyId),
          lt(accountingPeriodsTable.startDate, endDate),
          gt(accountingPeriodsTable.endDate, startDate),
        ),
      )
      .limit(1);

    if (overlap) {
      res.status(409).json({
        error: `Obdobje se prekriva z obstoječim obdobjem "${overlap.name}". Preverite datume.`,
      });
      return;
    }

    const [period] = await db
      .insert(accountingPeriodsTable)
      .values({ name: parsed.data.name, startDate, endDate, companyId })
      .returning();

    res.status(201).json(period);
  },
);

// PATCH /companies/:companyId/periods/:id
router.patch(
  "/companies/:companyId/periods/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = Array.isArray(req.params.companyId)
      ? req.params.companyId[0]
      : req.params.companyId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const access = await resolveAccess(authReq, companyId, res);
    if (!access) return;

    // Viewer ne sme spremeniti ničesar
    if (access.role === "viewer") {
      res.status(403).json({ error: "Za urejanje obdobij potrebujete vlogo računovodja ali lastnik" });
      return;
    }

    const parsed = UpdatePeriodBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    // Zaklepanje/odklepanje zahteva vlogo owner
    if (parsed.data.status !== undefined && access.role !== "owner") {
      res.status(403).json({ error: "Samo lastnik lahko zaklene ali odklene obdobje" });
      return;
    }

    const [existing] = await db
      .select()
      .from(accountingPeriodsTable)
      .where(
        and(
          eq(accountingPeriodsTable.id, id),
          eq(accountingPeriodsTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "Računovodsko obdobje ni najdeno" });
      return;
    }

    const updateData: Record<string, unknown> = {};
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;

    if (Object.keys(updateData).length === 0) {
      res.json(existing);
      return;
    }

    const [updated] = await db
      .update(accountingPeriodsTable)
      .set(updateData)
      .where(
        and(
          eq(accountingPeriodsTable.id, id),
          eq(accountingPeriodsTable.companyId, companyId),
        ),
      )
      .returning();

    res.json(updated);
  },
);

export default router;
