import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, natakariTable } from "@workspace/db";
import type { PosRequest } from "../../middlewares/pos";

const router: IRouter = Router();

/** Vrne vse natakare podjetja (companyId-scoped), ne glede na enoto. */
router.get("/natakari", async (req, res): Promise<void> => {
  const companyId = (req as PosRequest).companyId;
  const rows = await db
    .select()
    .from(natakariTable)
    .where(eq(natakariTable.companyId, companyId))
    .orderBy(natakariTable.id);
  res.json(rows.map(r => ({
    ...r,
    davcnaStevilka: r.davcnaStevilka ?? null,
    ustvarjeno: r.ustvarjeno.toISOString(),
  })));
});

/** Doda novega natakarja na nivoju podjetja. */
router.post("/natakari", async (req, res): Promise<void> => {
  const companyId = (req as PosRequest).companyId;
  const { ime, priimek, davcnaStevilka, aktiven } = req.body as {
    ime: string; priimek: string; davcnaStevilka?: string | null; aktiven: boolean;
  };
  if (!ime || !priimek) {
    res.status(400).json({ error: "ime in priimek sta obvezna" });
    return;
  }

  const [row] = await db
    .insert(natakariTable)
    .values({ companyId, ime, priimek, davcnaStevilka: davcnaStevilka ?? null, aktiven: aktiven ?? true })
    .returning();

  res.status(201).json({
    ...row,
    davcnaStevilka: row!.davcnaStevilka ?? null,
    ustvarjeno: row!.ustvarjeno.toISOString(),
  });
});

/** Posodobi natakarja — preveri da pripada istemu podjetju. */
router.put("/natakari/:id", async (req, res): Promise<void> => {
  const companyId = (req as PosRequest).companyId;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const { ime, priimek, davcnaStevilka, aktiven, clerkUserId } = req.body as {
    ime: string; priimek: string; davcnaStevilka?: string | null; aktiven: boolean;
    clerkUserId?: string | null;
  };

  // clerkUserId mora biti unikaten — preverimo da ga ne uporablja drug natakar
  if (clerkUserId) {
    const [existing] = await db
      .select({ id: natakariTable.id })
      .from(natakariTable)
      .where(and(eq(natakariTable.clerkUserId, clerkUserId), eq(natakariTable.companyId, companyId)))
      .limit(1);
    if (existing && existing.id !== id) {
      res.status(409).json({ error: "Ta Clerk račun je že vezan na drugega natakarja." });
      return;
    }
  }

  const patch: Partial<typeof natakariTable.$inferInsert> = {
    ime, priimek, davcnaStevilka: davcnaStevilka ?? null, aktiven,
  };
  // clerkUserId: null odveže, string poveže, undefined ne spremeni
  if (clerkUserId !== undefined) patch.clerkUserId = clerkUserId ?? null;

  const [row] = await db
    .update(natakariTable)
    .set(patch)
    .where(and(eq(natakariTable.id, id), eq(natakariTable.companyId, companyId)))
    .returning();

  if (!row) { res.status(404).json({ error: "Natakar ni najden" }); return; }
  res.json({ ...row, davcnaStevilka: row.davcnaStevilka ?? null, clerkUserId: row.clerkUserId ?? null, ustvarjeno: row.ustvarjeno.toISOString() });
});

/** Izbriše natakarja — preveri da pripada istemu podjetju. */
router.delete("/natakari/:id", async (req, res): Promise<void> => {
  const companyId = (req as PosRequest).companyId;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  await db
    .delete(natakariTable)
    .where(and(eq(natakariTable.id, id), eq(natakariTable.companyId, companyId)));

  res.status(204).send();
});

export default router;
