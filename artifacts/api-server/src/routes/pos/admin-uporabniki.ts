/**
 * POS Admin — upravljanje POS uporabnikov znotraj podjetja.
 * Dostopno superadminu in admin vlogi POS sistema.
 * Zahteva Clerk JWT brez X-Enota-Id (upravljanje je na nivoju podjetja).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth as clerkRequireAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { db, posUporabnikiTable, enoteTable } from "@workspace/db";

const router: IRouter = Router();

const SUPER_ADMIN_IDS = (process.env.SUPER_ADMIN_IDS ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

/** Middleware: zahteva Clerk JWT + preveri, da je klic iz superadmina ali admin vloge. */
async function requirePosAdmin(req: Request, res: Response, next: () => void): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    clerkRequireAuth()(req, res, (err?: unknown) => { if (err) reject(err); else resolve(); });
  }).catch(() => { if (!res.headersSent) res.status(401).json({ napaka: "Prijava je obvezna" }); return; });
  if (res.headersSent) return;

  const clerkUserId = (req as any).auth?.userId as string | undefined;
  if (!clerkUserId) { res.status(401).json({ napaka: "Prijava je obvezna" }); return; }

  if (SUPER_ADMIN_IDS.includes(clerkUserId)) { next(); return; }

  // Preveri admin vlogo v POS
  const companyId = req.params.companyId ?? (req.body as Record<string, unknown>)?.companyId as string;
  if (!companyId) { res.status(400).json({ napaka: "Manjka companyId" }); return; }

  const [admin] = await db
    .select({ vloga: posUporabnikiTable.vloga })
    .from(posUporabnikiTable)
    .where(and(
      eq(posUporabnikiTable.clerkUserId, clerkUserId),
      eq(posUporabnikiTable.companyId, companyId),
      eq(posUporabnikiTable.aktiven, true),
    ))
    .limit(1);

  if (!admin || admin.vloga !== "admin") {
    res.status(403).json({ napaka: "Dostop zavrnjen — potrebna je admin vloga" });
    return;
  }

  next();
}

/** GET /pos/admin/podjetja/:companyId/uporabniki */
router.get(
  "/pos/admin/podjetja/:companyId/uporabniki",
  (req, res, next) => requirePosAdmin(req, res, next),
  async (req: Request, res: Response): Promise<void> => {
    const { companyId } = req.params;
    const rows = await db
      .select({
        id: posUporabnikiTable.id,
        clerkUserId: posUporabnikiTable.clerkUserId,
        enotaId: posUporabnikiTable.enotaId,
        vloga: posUporabnikiTable.vloga,
        ime: posUporabnikiTable.ime,
        priimek: posUporabnikiTable.priimek,
        aktiven: posUporabnikiTable.aktiven,
        ustvarjeno: posUporabnikiTable.ustvarjeno,
        enotaIme: enoteTable.ime,
      })
      .from(posUporabnikiTable)
      .leftJoin(enoteTable, eq(posUporabnikiTable.enotaId, enoteTable.id))
      .where(eq(posUporabnikiTable.companyId, companyId))
      .orderBy(posUporabnikiTable.id);
    res.json(rows);
  }
);

/** POST /pos/admin/podjetja/:companyId/uporabniki */
router.post(
  "/pos/admin/podjetja/:companyId/uporabniki",
  (req, res, next) => requirePosAdmin(req, res, next),
  async (req: Request, res: Response): Promise<void> => {
    const { companyId } = req.params;
    const { clerkUserId, enotaId, vloga, ime, priimek } = req.body as {
      clerkUserId?: string; enotaId?: number; vloga?: string; ime?: string; priimek?: string;
    };

    if (!clerkUserId || !vloga || !ime || !priimek) {
      res.status(400).json({ napaka: "Polja clerkUserId, vloga, ime in priimek so obvezna" }); return;
    }
    if (!["admin", "admin_enote", "uporabnik"].includes(vloga)) {
      res.status(400).json({ napaka: "Vloga mora biti admin, admin_enote ali uporabnik" }); return;
    }
    if ((vloga === "admin_enote" || vloga === "uporabnik") && !enotaId) {
      res.status(400).json({ napaka: `Vloga ${vloga} zahteva enotaId` }); return;
    }

    const [row] = await db.insert(posUporabnikiTable).values({
      clerkUserId,
      companyId,
      enotaId: enotaId ?? null,
      vloga,
      ime,
      priimek,
      aktiven: true,
    }).returning();
    res.status(201).json(row);
  }
);

/** PUT /pos/admin/podjetja/:companyId/uporabniki/:id */
router.put(
  "/pos/admin/podjetja/:companyId/uporabniki/:id",
  (req, res, next) => requirePosAdmin(req, res, next),
  async (req: Request, res: Response): Promise<void> => {
    const { companyId, id } = req.params;
    const { enotaId, vloga, ime, priimek, aktiven } = req.body as {
      enotaId?: number | null; vloga?: string; ime?: string; priimek?: string; aktiven?: boolean;
    };

    const patch: Partial<typeof posUporabnikiTable.$inferInsert> = {};
    if (vloga !== undefined) patch.vloga = vloga;
    if (ime !== undefined) patch.ime = ime;
    if (priimek !== undefined) patch.priimek = priimek;
    if (aktiven !== undefined) patch.aktiven = aktiven;
    if (enotaId !== undefined) patch.enotaId = enotaId;

    const [row] = await db
      .update(posUporabnikiTable)
      .set(patch)
      .where(and(eq(posUporabnikiTable.id, Number(id)), eq(posUporabnikiTable.companyId, companyId)))
      .returning();

    if (!row) { res.status(404).json({ napaka: "Uporabnik ni najden" }); return; }
    res.json(row);
  }
);

/** DELETE /pos/admin/podjetja/:companyId/uporabniki/:id — deaktivira */
router.delete(
  "/pos/admin/podjetja/:companyId/uporabniki/:id",
  (req, res, next) => requirePosAdmin(req, res, next),
  async (req: Request, res: Response): Promise<void> => {
    const { companyId, id } = req.params;
    const [row] = await db
      .update(posUporabnikiTable)
      .set({ aktiven: false })
      .where(and(eq(posUporabnikiTable.id, Number(id)), eq(posUporabnikiTable.companyId, companyId)))
      .returning();
    if (!row) { res.status(404).json({ napaka: "Uporabnik ni najden" }); return; }
    res.json({ ok: true });
  }
);

export default router;
