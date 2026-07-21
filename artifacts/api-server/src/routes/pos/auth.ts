/**
 * POS Auth — /api/pos/auth/me
 * Zahteva samo Clerk JWT (brez X-Enota-Id), ker je to endpoint za ugotovitev vloge.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { db, posUporabnikiTable, enoteTable, companiesTable } from "@workspace/db";

const router: IRouter = Router();

const SUPER_ADMIN_IDS = (process.env.SUPER_ADMIN_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/**
 * GET /pos/auth/me
 * Vrne vlogo in podatke trenutno prijavljenega Clerk uporabnika v POS sistemu.
 * Superadmin: določen prek SUPER_ADMIN_IDS env var.
 * Ostali: poiščemo v pos_uporabniki tabeli.
 */
router.get("/pos/auth/me", async (req: Request, res: Response): Promise<void> => {
  const { userId: clerkUserId } = getAuth(req);
  if (!clerkUserId) { res.status(401).json({ napaka: "Prijava je obvezna" }); return; }

  // Superadmin — platformni nivo
  if (SUPER_ADMIN_IDS.includes(clerkUserId)) {
    res.json({
      id: 0,
      clerkUserId,
      vloga: "superadmin",
      ime: "Super",
      priimek: "Admin",
      companyId: null,
      enotaId: null,
      enote: [],
      aktiven: true,
    });
    return;
  }

  // Poišči POS uporabniški zapis
  const rows = await db
    .select({
      id: posUporabnikiTable.id,
      clerkUserId: posUporabnikiTable.clerkUserId,
      companyId: posUporabnikiTable.companyId,
      enotaId: posUporabnikiTable.enotaId,
      vloga: posUporabnikiTable.vloga,
      ime: posUporabnikiTable.ime,
      priimek: posUporabnikiTable.priimek,
      aktiven: posUporabnikiTable.aktiven,
      companyIme: companiesTable.naziv,
      companyDavcna: companiesTable.podjetjeDavcna,
    })
    .from(posUporabnikiTable)
    .innerJoin(companiesTable, eq(posUporabnikiTable.companyId, companiesTable.id))
    .where(
      and(
        eq(posUporabnikiTable.clerkUserId, clerkUserId),
        eq(posUporabnikiTable.aktiven, true),
      )
    )
    .limit(10);

  if (rows.length === 0) {
    res.status(403).json({ napaka: "Nimate dostopa do POS sistema" });
    return;
  }

  const uporabnik = rows[0];

  // Za admin vloge: seznam vseh enot podjetja
  let enote: Array<{ id: number; ime: string }> = [];
  if (uporabnik.vloga === "admin") {
    enote = await db
      .select({ id: enoteTable.id, ime: enoteTable.ime })
      .from(enoteTable)
      .where(and(eq(enoteTable.companyId, uporabnik.companyId), eq(enoteTable.aktiven, true)))
      .orderBy(enoteTable.id);
  }

  res.json({
    id: uporabnik.id,
    clerkUserId: uporabnik.clerkUserId,
    vloga: uporabnik.vloga,
    ime: uporabnik.ime,
    priimek: uporabnik.priimek,
    companyId: uporabnik.companyId,
    companyIme: uporabnik.companyIme,
    podjetjeDavcna: uporabnik.companyDavcna ?? "",
    enotaId: uporabnik.enotaId,
    enote,
    aktiven: uporabnik.aktiven,
  });
});

export default router;
