/**
 * POS Auth — /api/pos/auth/me
 * Zahteva samo Clerk JWT (brez X-Enota-Id), ker je to endpoint za ugotovitev vloge.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { db, posUporabnikiTable, enoteTable, blagajneTable, companiesTable, natakariTable } from "@workspace/db";

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
router.get("/auth/me", async (req: Request, res: Response): Promise<void> => {
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

  // Poišči POS uporabniški zapis (z JOIN na podjetje, enoto in blagajno)
  const rows = await db
    .select({
      id: posUporabnikiTable.id,
      clerkUserId: posUporabnikiTable.clerkUserId,
      companyId: posUporabnikiTable.companyId,
      enotaId: posUporabnikiTable.enotaId,
      blagajnaId: posUporabnikiTable.blagajnaId,
      vloga: posUporabnikiTable.vloga,
      ime: posUporabnikiTable.ime,
      priimek: posUporabnikiTable.priimek,
      aktiven: posUporabnikiTable.aktiven,
      companyNaziv: companiesTable.naziv,
      companyNaslov: companiesTable.naslov,
      companyDavcna: companiesTable.podjetjeDavcna,
      companyIdZaDdv: companiesTable.idZaDdv,
      companyZavezanecDdv: companiesTable.zavezanecDdv,
      companyTrr: companiesTable.trr,
      enotaIme: enoteTable.ime,
      blagajnaIme: blagajneTable.ime,
      blagajnaPpId: blagajneTable.ppId,
    })
    .from(posUporabnikiTable)
    .innerJoin(companiesTable, eq(posUporabnikiTable.companyId, companiesTable.id))
    .leftJoin(enoteTable, eq(posUporabnikiTable.enotaId, enoteTable.id))
    .leftJoin(blagajneTable, eq(posUporabnikiTable.blagajnaId, blagajneTable.id))
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

  // Poišči natakarjev profil vezan na tega Clerk uporabnika (po clerkUserId + companyId).
  // Natakarji so na nivoju podjetja — ni vezave na posamezno enoto.
  let natakariId: number | null = null;
  const [nat] = await db
    .select({ id: natakariTable.id })
    .from(natakariTable)
    .where(and(
      eq(natakariTable.clerkUserId, clerkUserId),
      eq(natakariTable.companyId, uporabnik.companyId),
      eq(natakariTable.aktiven, true),
    ))
    .limit(1);
  natakariId = nat?.id ?? null;

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
    companyNaziv: uporabnik.companyNaziv ?? null,
    companyNaslov: uporabnik.companyNaslov ?? null,
    podjetjeDavcna: uporabnik.companyDavcna ?? "",
    idZaDdv: uporabnik.companyIdZaDdv ?? null,
    jeDdvZavezanec: uporabnik.companyZavezanecDdv ?? false,
    imaTrr: Array.isArray(uporabnik.companyTrr) && (uporabnik.companyTrr as Array<{ iban?: string }>).some(t => typeof t.iban === "string" && t.iban.trim().length > 0),
    enotaId: uporabnik.enotaId,
    enotaIme: uporabnik.enotaIme ?? null,
    blagajnaId: uporabnik.blagajnaId ?? null,
    blagajnaIme: uporabnik.blagajnaIme ?? null,
    blagajnaPpId: uporabnik.blagajnaPpId ?? null,
    natakariId,
    enote,
    aktiven: uporabnik.aktiven,
  });
});

export default router;
