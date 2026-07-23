/**
 * POS — Poslovne enote (lokacije restavracije).
 * Enote so vezane na ERP podjetje prek company_id.
 * Clerk JWT + X-Company-Id (ERP) → upravljanje enot tega podjetja.
 */

import { Router, type IRouter } from "express";
import { eq, count, and } from "drizzle-orm";
import {
  db, enoteTable, artikliTable, kategorijeTable, mizeTable, narocilaTable,
  racuniTable, nastavitveTable, natakariTable, poslovniProstoriTable,
  prostoriTable, izmeneTable, inventureTable, prejemniceTable, zacetneZalogeTable,
} from "@workspace/db";
import type { Request, Response } from "express";

const router: IRouter = Router();

// GET /enote — vse enote tega podjetja (company_id iz ERP middleware)
router.get("/", async (req: Request, res: Response): Promise<void> => {
  const companyId = (req as any).companyId as string | undefined;
  if (!companyId) { res.status(400).json({ napaka: "Manjka X-Company-Id" }); return; }
  const rows = await db.select().from(enoteTable)
    .where(eq(enoteTable.companyId, companyId))
    .orderBy(enoteTable.id);
  res.json(rows);
});

// POST /enote — ustvari novo enoto
router.post("/", async (req: Request, res: Response): Promise<void> => {
  const companyId = (req as any).companyId as string | undefined;
  if (!companyId) { res.status(400).json({ napaka: "Manjka X-Company-Id" }); return; }
  const { ime, opis, aktiven, zacetekDnevaUra } = req.body as { ime?: string; opis?: string; aktiven?: boolean; zacetekDnevaUra?: string };
  if (!ime) { res.status(400).json({ napaka: "Ime je obvezno" }); return; }
  const [row] = await db.insert(enoteTable).values({
    companyId,
    ime,
    opis: opis ?? null,
    aktiven: aktiven ?? true,
    zacetekDnevaUra: zacetekDnevaUra ?? "04:00",
  }).returning();
  res.status(201).json(row);
});

// PUT /enote/:id
router.put("/:id", async (req: Request, res: Response): Promise<void> => {
  const companyId = (req as any).companyId as string | undefined;
  if (!companyId) { res.status(400).json({ napaka: "Manjka X-Company-Id" }); return; }
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const { ime, opis, aktiven, zacetekDnevaUra } = req.body as { ime?: string; opis?: string; aktiven?: boolean; zacetekDnevaUra?: string };
  const updateData: Partial<typeof enoteTable.$inferInsert> = {};
  if (ime !== undefined) updateData.ime = ime;
  if (opis !== undefined) updateData.opis = opis;
  if (aktiven !== undefined) updateData.aktiven = aktiven;
  if (zacetekDnevaUra !== undefined) updateData.zacetekDnevaUra = zacetekDnevaUra;
  const [row] = await db.update(enoteTable).set(updateData)
    .where(and(eq(enoteTable.id, id), eq(enoteTable.companyId, companyId)))
    .returning();
  if (!row) { res.status(404).json({ napaka: "Enota ni najdena" }); return; }
  res.json(row);
});

// DELETE /enote/:id
router.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const companyId = (req as any).companyId as string | undefined;
  if (!companyId) { res.status(400).json({ napaka: "Manjka X-Company-Id" }); return; }
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }

  const allEnote = await db.select({ id: enoteTable.id }).from(enoteTable)
    .where(eq(enoteTable.companyId, companyId));
  if (allEnote.length <= 1) {
    res.status(409).json({ napaka: "Ne morete izbrisati zadnje poslovne enote" }); return;
  }

  const checks = await Promise.all([
    db.select({ n: count() }).from(artikliTable).where(eq(artikliTable.enotaId, id)),
    db.select({ n: count() }).from(kategorijeTable).where(eq(kategorijeTable.enotaId, id)),
    db.select({ n: count() }).from(mizeTable).where(eq(mizeTable.enotaId, id)),
    db.select({ n: count() }).from(narocilaTable).where(eq(narocilaTable.enotaId, id)),
    db.select({ n: count() }).from(racuniTable).where(eq(racuniTable.enotaId, id)),
  ]);
  const skupaj = checks.reduce((sum, [r]) => sum + Number(r?.n ?? 0), 0);
  if (skupaj > 0) {
    res.status(409).json({ napaka: "Enote ni mogoče izbrisati — vsebuje podatke." }); return;
  }

  await db.delete(enoteTable).where(and(eq(enoteTable.id, id), eq(enoteTable.companyId, companyId)));
  res.status(204).send();
});

export default router;
