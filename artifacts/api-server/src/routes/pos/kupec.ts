import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { artikliTable, counterpartiesTable, db, enoteTable, kategorijeTable, partnerCenikiTable } from "@workspace/db";
import { poisciVUjp } from "../ujp";
import { poisciVAjpes } from "../ajpes";
import { preveriVies, drzavaIzKode } from "../../lib/vies.js";
import {
  poisciNaInetis, poisciVInetisNiz, zaznajVrsto, trrSuroviVIban, razclenitNaslov,
  BANCNI_BIC, type TrrPostavka, type InetisRezultat,
} from "../../lib/inetis.js";
import type { PosRequest } from "../../middlewares/pos.js";
import { resolveSifrantAccess } from "../../lib/resolveSifrantAccess.js";
import { slovenianCollated } from "../../lib/slovenian-collation";

/**
 * Pretvori 15-mestno slovensko TRR številko (UJP format) v IBAN.
 * Če je vrednost že v IBAN formatu (začne s "SI"), jo vrne nespremenjen.
 * Napačen format vrne izvorno vrednost.
 */
function ujpTrrVIban(trrSt: string): string {
  const cleaned = trrSt.trim();
  if (/^SI\d{17}$/i.test(cleaned)) return cleaned.toUpperCase(); // že IBAN
  if (!/^\d{15}$/.test(cleaned)) return cleaned;                 // ne prepoznan format
  const rearranged = cleaned + "281800";
  const mod = BigInt(rearranged) % 97n;
  const check = String(98n - mod).padStart(2, "0");
  return `SI${check}${cleaned}`;
}

/**
 * Normalizira matično številko za primerjavo z UJP bazo.
 * Inetis vrne matično s trailing ničlami (npr. "5067889000"), UJP hrani 7-mestno ("5067889").
 */
function normalizeMaticnaZaUjp(m?: string | null): string | undefined {
  if (!m) return undefined;
  const t = m.trim().replace(/0+$/, "");
  return t.length >= 4 ? t : m.trim();
}

const router: IRouter = Router();

/** Preslikava iz skupne tabele counterparties v POS API format. */
function mapKupec(k: typeof counterpartiesTable.$inferSelect) {
  return {
    id: k.id,                               // UUID string (ne integer!)
    naziv: k.name,
    kratkiNaziv: k.kratkiNaziv ?? null,
    naslov: k.address ?? null,
    ulica: k.ulica ?? null,
    postnaStevilka: k.postCode ?? null,
    kraj: k.city ?? null,
    drzava: k.country ?? null,
    kodaDrzave: k.kodaDrzave ?? null,
    zavezanecDdv: k.vatPayer ?? null,
    davcnaStevilka: k.taxId ?? null,
    idZaDdv: k.idZaDdv ?? null,
    maticnaStevilka: k.registrationNumber ?? null,
    trr: (k.trr as TrrPostavka[] | null) ?? null,
    vrstaPartnerja: k.vrstaPartnerja ?? null,
    kmgMid: k.kmgMid ?? null,
    eRacunPrejemnik: k.eRacunPrejemnik ?? null,
    eRacunOmrezje: k.eRacunOmrezje ?? null,
    eRacunEmail: k.eRacunEmail ?? null,
    eRacunNaslov: k.eRacunNaslov ?? null,
    eRacunSifraPu: k.eRacunSifraPu ?? null,
    eRacunBic: k.eRacunBic ?? null,
    email: k.email ?? null,
    telefon: k.phone ?? null,
    steviloUpor: k.steviloUpor,
    zadnjaUporaba: k.zadnjaUporaba,
    ustvarjeno: k.createdAt,
  };
}

async function poisciNaBizBox(davcna: string, naziv?: string): Promise<{ registriran: boolean; omrezje: string | null; naslov: string | null } | null> {
  const cleaned = davcna.replace(/^SI/i, "");
  const siDavcna = `SI${cleaned}`.toUpperCase();
  const iskalniNiz = naziv
    ? naziv.split(/[\s,]+/).filter(Boolean).slice(0, 3).join(" ")
    : siDavcna;
  try {
    const r = await fetch(
      `https://bizbox.zzi.si/bizBoxIskalnik?filter=${encodeURIComponent(iskalniNiz)}`,
      {
        signal: AbortSignal.timeout(8000),
        headers: {
          "Accept": "application/json, */*",
          "User-Agent": "Mozilla/5.0 (compatible; POS/1.0)",
          "Referer": "https://www.bizbox.eu/e-imenik/",
          "Origin": "https://www.bizbox.eu",
        },
      }
    );
    if (!r.ok) return null;
    const data = await r.json() as {
      result: {
        companies: Array<{
          name?: string;
          taxid?: string;
          provider?: string;
          isedirecipient?: number;
          defaultlocation?: string;
        }>;
      };
    };
    const companies = data?.result?.companies ?? [];
    const match = companies.find(c => c.taxid?.toUpperCase() === siDavcna);
    if (!match) return { registriran: false, omrezje: null, naslov: null };
    const registriran = (match.isedirecipient ?? 1) === 1;
    const omrezje = match.provider ?? null;
    const naslov = match.defaultlocation ?? null;
    return { registriran, omrezje, naslov };
  } catch {
    return null;
  }
}

// ── Pogosti (8 najpogosteje izbranih) ───────────────────────────────────────
router.get("/kupec/pogosti", async (req, res): Promise<void> => {
  const companyId = (req as any).companyId;
  const kupci = await db
    .select()
    .from(counterpartiesTable)
    .where(and(eq(counterpartiesTable.companyId, companyId), eq(counterpartiesTable.isActive, true)))
    .orderBy(desc(counterpartiesTable.steviloUpor), desc(counterpartiesTable.zadnjaUporaba))
    .limit(8);
  res.json(kupci.map(mapKupec));
});

// ── Celoten šifrant (legacy alias za GET /partnerji) ─────────────────────────
router.get("/kupec/shranjeni", async (req, res): Promise<void> => {
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;
  const kupci = await db
    .select()
    .from(counterpartiesTable)
    .where(and(eq(counterpartiesTable.companyId, ctx.companyId), eq(counterpartiesTable.isActive, true)))
    .orderBy(slovenianCollated(counterpartiesTable.name));
  res.json(kupci.map(mapKupec));
});

// ── Ustvari novega partnerja (legacy alias za POST /partnerji) ───────────────
router.post("/kupec/shranjeni", async (req, res): Promise<void> => {
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;
  const companyId = ctx.companyId;
  const d = req.body as any;
  const [kupec] = await db
    .insert(counterpartiesTable)
    .values({
      companyId,
      type: "both",
      name: d.naziv,
      kratkiNaziv: d.kratkiNaziv ?? null,
      address: d.naslov ?? null,
      ulica: d.ulica ?? null,
      postCode: d.postnaStevilka ?? null,
      city: d.kraj ?? null,
      country: d.drzava ?? null,
      kodaDrzave: d.kodaDrzave ?? null,
      vatPayer: d.zavezanecDdv ?? false,
      taxId: d.davcnaStevilka ?? null,
      idZaDdv: d.idZaDdv ?? null,
      registrationNumber: d.maticnaStevilka ?? null,
      trr: d.trr ?? null,
      vrstaPartnerja: d.vrstaPartnerja ?? null,
      kmgMid: d.kmgMid ?? null,
      eRacunPrejemnik: d.eRacunPrejemnik ?? false,
      eRacunOmrezje: d.eRacunOmrezje ?? null,
      eRacunNaslov: d.eRacunNaslov ?? null,
      eRacunEmail: d.eRacunEmail ?? null,
      eRacunSifraPu: d.eRacunSifraPu ?? null,
      eRacunBic: d.eRacunBic ?? null,
      email: d.email ?? null,
      phone: d.telefon ?? null,
      steviloUpor: 1,
      zadnjaUporaba: new Date(),
    })
    .returning();
  res.status(201).json(mapKupec(kupec!));
});

// ── Posodobi partnerja (legacy alias za PUT /partnerji/:id) ──────────────────
router.put("/kupec/shranjeni/:id", async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  if (!id) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;
  const companyId = ctx.companyId;
  const d = req.body as any;
  const [updated] = await db
    .update(counterpartiesTable)
    .set({
      name: d.naziv,
      kratkiNaziv: d.kratkiNaziv ?? null,
      address: d.naslov ?? null,
      ulica: d.ulica ?? null,
      postCode: d.postnaStevilka ?? null,
      city: d.kraj ?? null,
      country: d.drzava ?? null,
      kodaDrzave: d.kodaDrzave ?? null,
      vatPayer: d.zavezanecDdv ?? false,
      taxId: d.davcnaStevilka ?? null,
      idZaDdv: d.idZaDdv ?? null,
      registrationNumber: d.maticnaStevilka ?? null,
      trr: d.trr ?? null,
      vrstaPartnerja: d.vrstaPartnerja ?? null,
      kmgMid: d.kmgMid ?? null,
      eRacunPrejemnik: d.eRacunPrejemnik ?? false,
      eRacunOmrezje: d.eRacunOmrezje ?? null,
      eRacunNaslov: d.eRacunNaslov ?? null,
      eRacunEmail: d.eRacunEmail ?? null,
      eRacunSifraPu: d.eRacunSifraPu ?? null,
      eRacunBic: d.eRacunBic ?? null,
      email: d.email ?? null,
      phone: d.telefon ?? null,
    })
    .where(and(
      eq(counterpartiesTable.id, id),
      eq(counterpartiesTable.companyId, companyId),
    ))
    .returning();
  if (!updated) { res.status(404).json({ napaka: "Kupec ni najden" }); return; }
  res.json(mapKupec(updated));
});

// ── Izbriši partnerja (legacy alias za DELETE /partnerji/:id) ────────────────
router.delete("/kupec/shranjeni/:id", async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  if (!id) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;
  const companyId = ctx.companyId;

  const [obstojecKupec] = await db
    .select({ id: counterpartiesTable.id })
    .from(counterpartiesTable)
    .where(and(
      eq(counterpartiesTable.id, id),
      eq(counterpartiesTable.companyId, companyId),
    ))
    .limit(1);
  if (!obstojecKupec) {
    res.status(404).json({ napaka: "Partner ni najden" });
    return;
  }

  // artikel_dobavitelj in uvoz_profil imata FK CASCADE/SET NULL → brisanje counterparties je varno
  await db
    .update(counterpartiesTable)
    .set({ isActive: false })
    .where(eq(counterpartiesTable.id, id));

  res.status(204).end();
});

// ── Osveži podatke iz javnih registrov (legacy alias za POST /partnerji/:id/osvezi) ──
router.post("/kupec/shranjeni/:id/osvezi", async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  if (!id) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;
  await osveziPartnerjaPodLogiko(id, ctx.companyId, req, res);
});

// ── Iskanje po EU VAT ID (tuji partnerji) ───────────────────────────────────
router.get("/kupec/poisci-vies", async (req, res): Promise<void> => {
  const vatId = typeof req.query.vatId === "string"
    ? req.query.vatId.trim().toUpperCase().replace(/\s/g, "")
    : "";
  if (!/^[A-Z]{2}\S{2,}$/.test(vatId)) {
    res.status(400).json({ napaka: "Neveljaven EU VAT ID (npr. DE195033395)" });
    return;
  }
  const companyId = (req as any).companyId;
  const kodaDrzave = vatId.slice(0, 2);

  // Že v šifrantu?
  const [obstojecKupec] = await db
    .select()
    .from(counterpartiesTable)
    .where(and(
      eq(counterpartiesTable.companyId, companyId),
      eq(counterpartiesTable.idZaDdv, vatId),
      eq(counterpartiesTable.isActive, true),
    ))
    .limit(1);
  if (obstojecKupec) { res.json(mapKupec(obstojecKupec)); return; }

  const vies = await preveriVies(vatId);
  if (!vies) { res.status(503).json({ napaka: "VIES ni dosegljiv. Poskusite pozneje." }); return; }

  const drzavaNaziv = vies.drzavaNaziv ?? drzavaIzKode(kodaDrzave);
  const naziv = vies.naziv && vies.naziv !== "---" ? vies.naziv : null;
  const ulica = vies.ulica && vies.ulica !== "---" ? vies.ulica : null;
  const postnaStevilka = vies.postnaStevilka && vies.postnaStevilka !== "---" ? vies.postnaStevilka : null;
  const kraj = vies.kraj && vies.kraj !== "---" ? vies.kraj : null;

  if (vies.veljaven && naziv) {
    try {
      const [nov] = await db.insert(counterpartiesTable).values({
        companyId,
        type: "customer",
        name: naziv,
        idZaDdv: vatId,
        kodaDrzave,
        country: drzavaNaziv,
        ulica,
        address: ulica,
        postCode: postnaStevilka,
        city: kraj,
        vatPayer: true,
        vrstaPartnerja: "podjetje",
      }).returning();
      res.json(mapKupec(nov!));
      return;
    } catch { /* spodleti → vrni brez id */ }
  }
  res.json({ naziv, idZaDdv: vatId, kodaDrzave, drzava: drzavaNaziv, zavezanecDdv: vies.veljaven ?? null, ulica, postnaStevilka, kraj });
});

// ── Iskanje po davčni (slovensko podjetje) ───────────────────────────────────
router.get("/kupec/poisci", async (req, res): Promise<void> => {
  const davcna = typeof req.query.davcna === "string" ? req.query.davcna.trim() : "";
  if (!/^\d{8}$/.test(davcna)) {
    res.status(400).json({ napaka: "Davčna številka mora imeti točno 8 številk." });
    return;
  }

  const r = await poisciNaInetis(davcna);
  if (!r || !r.naziv) {
    res.status(404).json({ napaka: "Kupec s to davčno številko ni bil najden v registru." });
    return;
  }

  const [eReg, ujpVnosi, ajpesSub] = await Promise.all([
    poisciNaBizBox(davcna, r.naziv),
    poisciVUjp(davcna, normalizeMaticnaZaUjp(r.maticnaStevilka)),
    poisciVAjpes(r.maticnaStevilka),
  ]);

  const jeVUjp = ujpVnosi.length > 0;
  const eRacunPrejemnik = jeVUjp ? true : (eReg?.registriran ?? null);
  const eRacunOmrezje = jeVUjp ? "UJP" : (eReg?.omrezje ?? null);
  const eRacunNaslov = jeVUjp ? ujpTrrVIban(ujpVnosi[0]!.trrSt) : (eReg?.naslov ?? null);

  const companyId = (req as any).companyId;
  let shranjeniId: string | null = null;
  if (r) {
    try {
      const [existing] = await db
        .select({ id: counterpartiesTable.id })
        .from(counterpartiesTable)
        .where(and(
          eq(counterpartiesTable.companyId, companyId),
          eq(counterpartiesTable.taxId, r.davcnaStevilka),
        ))
        .limit(1);

      const vrstaIzPoisci = zaznajVrsto(r.naziv, r.zavezanecDdv, r.maticnaStevilka);
      const trr_popravljeni = r.trr
        ? (r.trr as Array<{ iban: string; bic: string }>).map(t =>
            t.iban.replace(/\s/g, "").toUpperCase().startsWith("SI5601")
              ? { ...t, bic: "BSLJSI2X" } : t)
        : r.trr;
      const ajpesEmailPoisci = ajpesSub?.email || null;

      if (existing) {
        shranjeniId = existing.id;
        await db.update(counterpartiesTable).set({
          name: r.naziv,
          kratkiNaziv: r.kratkiNaziv,
          address: r.naslov,
          ulica: r.ulica,
          postCode: r.postnaStevilka,
          city: r.kraj,
          country: "Slovenija",
          kodaDrzave: "SI",
          vatPayer: r.zavezanecDdv ?? false,
          idZaDdv: r.idZaDdv,
          registrationNumber: r.maticnaStevilka,
          trr: trr_popravljeni,
          zadnjaUporaba: new Date(),
          ...(ajpesEmailPoisci ? { email: ajpesEmailPoisci } : {}),
          ...(vrstaIzPoisci !== null ? { vrstaPartnerja: vrstaIzPoisci } : {}),
          ...(eRacunPrejemnik !== null ? {
            eRacunPrejemnik,
            eRacunOmrezje,
            ...(eRacunNaslov ? { eRacunNaslov } : {}),
            ...(jeVUjp && ujpVnosi[0]!.sifraPu ? { eRacunSifraPu: ujpVnosi[0]!.sifraPu } : {}),
            ...(jeVUjp ? { eRacunBic: "BSLJSI2X" } : {}),
          } : {}),
        }).where(eq(counterpartiesTable.id, existing.id));
      } else {
        const [inserted] = await db.insert(counterpartiesTable).values({
          companyId,
          type: "both",
          name: r.naziv,
          kratkiNaziv: r.kratkiNaziv,
          address: r.naslov,
          ulica: r.ulica,
          postCode: r.postnaStevilka,
          city: r.kraj,
          country: "Slovenija",
          kodaDrzave: "SI",
          vatPayer: r.zavezanecDdv ?? false,
          taxId: r.davcnaStevilka,
          idZaDdv: r.idZaDdv,
          registrationNumber: r.maticnaStevilka,
          trr: trr_popravljeni,
          email: ajpesEmailPoisci,
          steviloUpor: 0,
          zadnjaUporaba: new Date(),
          ...(vrstaIzPoisci !== null ? { vrstaPartnerja: vrstaIzPoisci } : {}),
          ...(eRacunPrejemnik !== null ? {
            eRacunPrejemnik,
            eRacunOmrezje,
            ...(eRacunNaslov ? { eRacunNaslov } : {}),
            ...(jeVUjp && ujpVnosi[0]!.sifraPu ? { eRacunSifraPu: ujpVnosi[0]!.sifraPu } : {}),
            ...(jeVUjp ? { eRacunBic: "BSLJSI2X" } : {}),
          } : {}),
        }).returning({ id: counterpartiesTable.id });
        shranjeniId = inserted?.id ?? null;
      }
    } catch {
      // Ne blokiraj odgovora pri napaki shranjevanja
    }
  }

  const eRacunSifraPuIzPoisci = jeVUjp ? (ujpVnosi[0]!.sifraPu || null) : null;
  res.json({
    ...r,
    id: shranjeniId,
    email: (r as any).email ?? ajpesSub?.email ?? null,
    eRacunPrejemnik,
    eRacunOmrezje,
    eRacunNaslov,
    eRacunSifraPu: eRacunSifraPuIzPoisci,
    eRacunBic: jeVUjp ? "BSLJSI2X" : null,
    ujpVnosi: jeVUjp ? ujpVnosi : undefined,
  });
});

// ── Iskanje po nazivu (Inetis) ───────────────────────────────────────────────
router.get("/kupec/poisci-naziv", async (req, res): Promise<void> => {
  const niz = typeof req.query.niz === "string" ? req.query.niz.trim() : "";
  if (niz.length < 3) {
    res.status(400).json({ napaka: "Iskalni niz mora imeti vsaj 3 znake." });
    return;
  }
  try {
    const zadetki = await poisciVInetisNiz(niz);
    if (zadetki.length === 0) {
      res.status(404).json({ napaka: "Podjetja po iskalnem nizu ni v Inetis registru." });
      return;
    }
    if (zadetki.length === 1) { res.json(zadetki[0]); return; }
    res.json({ vecZadetkov: true, zadetki });
  } catch {
    res.status(502).json({ napaka: "Napaka pri iskanju prek Inetis registra." });
  }
});

/**
 * Upsert "pogost kupec" ob potrditvi računa.
 * Sedaj dela na ravni podjetja (companyId) — skupen šifrant za vse enote.
 */
export async function upsertPogostKupec(opts: {
  companyId: string;
  naziv: string;
  naslov: string | null;
  davcnaStevilka: string | null;
}): Promise<void> {
  const { companyId, naziv, naslov, davcnaStevilka } = opts;

  const whereClause = davcnaStevilka
    ? and(
        eq(counterpartiesTable.companyId, companyId),
        eq(counterpartiesTable.taxId, davcnaStevilka),
      )
    : and(
        eq(counterpartiesTable.companyId, companyId),
        sql`lower(${counterpartiesTable.name}) = lower(${naziv})`,
      );

  const [existing] = await db
    .select({ id: counterpartiesTable.id })
    .from(counterpartiesTable)
    .where(whereClause)
    .limit(1);

  if (existing) {
    await db
      .update(counterpartiesTable)
      .set({
        steviloUpor: sql`${counterpartiesTable.steviloUpor} + 1`,
        zadnjaUporaba: new Date(),
        name: naziv,
        ...(naslov !== undefined && { address: naslov }),
      })
      .where(eq(counterpartiesTable.id, existing.id));
  } else {
    await db.insert(counterpartiesTable).values({
      companyId,
      type: "both",
      name: naziv,
      address: naslov,
      taxId: davcnaStevilka,
      steviloUpor: 1,
      zadnjaUporaba: new Date(),
    });
  }
}

// ─── Partner cenik ────────────────────────────────────────────────────────────

// Legacy alias za GET /partnerji/:id/cenik
router.get("/kupec/shranjeni/:id/cenik", async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  if (!id) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;
  const companyId = ctx.companyId;

  const [kupec] = await db.select({ id: counterpartiesTable.id })
    .from(counterpartiesTable)
    .where(and(eq(counterpartiesTable.id, id), eq(counterpartiesTable.companyId, companyId)))
    .limit(1);
  if (!kupec) { res.status(404).json({ napaka: "Partner ni najden" }); return; }

  const vrstice = await db
    .select({
      artikelId: partnerCenikiTable.artikelId,
      artikelIme: artikliTable.ime,
      kategorijaId: artikliTable.kategorijaId,
      kategorijaIme: kategorijeTable.ime,
      originalCena: artikliTable.cena,
      cena: partnerCenikiTable.cena,
      davek: artikliTable.davek,
    })
    .from(partnerCenikiTable)
    .innerJoin(artikliTable, eq(partnerCenikiTable.artikelId, artikliTable.id))
    .innerJoin(enoteTable, eq(artikliTable.enotaId, enoteTable.id))
    .leftJoin(kategorijeTable, eq(artikliTable.kategorijaId, kategorijeTable.id))
    .where(and(
      eq(partnerCenikiTable.kupecId, id),
      eq(enoteTable.companyId, ctx.companyId),
    ))
    .orderBy(slovenianCollated(artikliTable.ime));

  res.json(vrstice.map(v => ({
    artikelId: v.artikelId,
    artikelIme: v.artikelIme,
    kategorijaId: v.kategorijaId ?? null,
    kategorijaIme: v.kategorijaIme ?? null,
    originalCena: Number(v.originalCena),
    cena: Number(v.cena),
    davek: Number(v.davek),
  })));
});

// Legacy alias za PUT /partnerji/:id/cenik/:artikelId
router.put("/kupec/shranjeni/:id/cenik/:artikelId", async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  const artikelId = parseInt(req.params.artikelId ?? "");
  if (!id || isNaN(artikelId)) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;
  const companyId = ctx.companyId;
  const enotaId = (req as any).enotaId;
  const cena = Number(req.body?.cena);
  if (!isFinite(cena) || cena < 0) { res.status(400).json({ napaka: "Cena mora biti nenegativno število" }); return; }

  const [kupec] = await db.select({ id: counterpartiesTable.id })
    .from(counterpartiesTable)
    .where(and(eq(counterpartiesTable.id, id), eq(counterpartiesTable.companyId, companyId)))
    .limit(1);
  if (!kupec) { res.status(404).json({ napaka: "Partner ni najden" }); return; }

  const [artikel] = await db.select({
    id: artikliTable.id, ime: artikliTable.ime,
    cena: artikliTable.cena, davek: artikliTable.davek,
    kategorijaId: artikliTable.kategorijaId,
  })
    .from(artikliTable)
    .innerJoin(enoteTable, eq(artikliTable.enotaId, enoteTable.id))
    .where(and(
      eq(artikliTable.id, artikelId),
      eq(enoteTable.companyId, ctx.companyId),
    ))
    .limit(1);
  if (!artikel) { res.status(404).json({ napaka: "Artikel ni najden" }); return; }

  await db.insert(partnerCenikiTable).values({
    enotaId,
    kupecId: id,
    artikelId,
    cena: String(cena),
  }).onConflictDoUpdate({
    target: [partnerCenikiTable.kupecId, partnerCenikiTable.artikelId],
    set: { cena: String(cena) },
  });

  const [kat] = artikel.kategorijaId
    ? await db.select({ ime: kategorijeTable.ime }).from(kategorijeTable)
        .where(eq(kategorijeTable.id, artikel.kategorijaId)).limit(1)
    : [];

  res.json({
    artikelId,
    artikelIme: artikel.ime,
    kategorijaId: artikel.kategorijaId ?? null,
    kategorijaIme: kat?.ime ?? null,
    originalCena: Number(artikel.cena),
    cena,
    davek: Number(artikel.davek),
  });
});

// Legacy alias za DELETE /partnerji/:id/cenik/:artikelId
router.delete("/kupec/shranjeni/:id/cenik/:artikelId", async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  const artikelId = parseInt(req.params.artikelId ?? "");
  if (!id || isNaN(artikelId)) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;
  const companyId = ctx.companyId;

  const [kupec] = await db.select({ id: counterpartiesTable.id })
    .from(counterpartiesTable)
    .where(and(eq(counterpartiesTable.id, id), eq(counterpartiesTable.companyId, companyId)))
    .limit(1);
  if (!kupec) { res.status(404).json({ napaka: "Partner ni najden" }); return; }

  const [artikel] = await db.select({ id: artikliTable.id })
    .from(artikliTable)
    .innerJoin(enoteTable, eq(artikliTable.enotaId, enoteTable.id))
    .where(and(
      eq(artikliTable.id, artikelId),
      eq(enoteTable.companyId, ctx.companyId),
    ))
    .limit(1);
  if (!artikel) { res.status(404).json({ napaka: "Artikel ni najden" }); return; }

  await db.delete(partnerCenikiTable)
    .where(and(eq(partnerCenikiTable.kupecId, id), eq(partnerCenikiTable.artikelId, artikelId)));

  res.status(204).send();
});

// ─── Canonical /api/partnerji/* rute (z resolveSifrantAccess) ────────────────
//
// Stare /kupec/shranjeni poti ostanejo kot backward-compatible aliasi.
// Novo POS ime je "partnerji"; resolver dovoljuje vse POS vloge (vrne accountant).

/** Skupna middleware funkcija za preverjanje dostopa prek resolveSifrantAccess. */
async function requirePartnerjiAccess(req: Request, res: Response): Promise<{ companyId: string; clerkUserId: string } | null> {
  const clerkUserId = (req as PosRequest).clerkUserId;
  const companyId = (req as PosRequest).companyId;
  if (!clerkUserId || !companyId) {
    res.status(401).json({ error: "Prijava je obvezna" });
    return null;
  }
  const access = await resolveSifrantAccess(clerkUserId, companyId, "partnerji", res);
  if (!access) return null; // resolveSifrantAccess je že poslal 403
  return { companyId, clerkUserId };
}

// GET /partnerji — seznam aktivnih partnerjev
router.get("/partnerji", async (req, res): Promise<void> => {
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;
  const kupci = await db
    .select()
    .from(counterpartiesTable)
    .where(and(eq(counterpartiesTable.companyId, ctx.companyId), eq(counterpartiesTable.isActive, true)))
    .orderBy(slovenianCollated(counterpartiesTable.name));
  res.json(kupci.map(mapKupec));
});

// POST /partnerji — ustvari novega partnerja
router.post("/partnerji", async (req, res): Promise<void> => {
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;
  const d = req.body as any;
  const [kupec] = await db
    .insert(counterpartiesTable)
    .values({
      companyId: ctx.companyId,
      type: "both",
      name: d.naziv,
      kratkiNaziv: d.kratkiNaziv ?? null,
      address: d.naslov ?? null,
      ulica: d.ulica ?? null,
      postCode: d.postnaStevilka ?? null,
      city: d.kraj ?? null,
      country: d.drzava ?? null,
      kodaDrzave: d.kodaDrzave ?? null,
      vatPayer: d.zavezanecDdv ?? false,
      taxId: d.davcnaStevilka ?? null,
      idZaDdv: d.idZaDdv ?? null,
      registrationNumber: d.maticnaStevilka ?? null,
      trr: d.trr ?? null,
      vrstaPartnerja: d.vrstaPartnerja ?? null,
      kmgMid: d.kmgMid ?? null,
      eRacunPrejemnik: d.eRacunPrejemnik ?? false,
      eRacunOmrezje: d.eRacunOmrezje ?? null,
      eRacunNaslov: d.eRacunNaslov ?? null,
      eRacunEmail: d.eRacunEmail ?? null,
      eRacunSifraPu: d.eRacunSifraPu ?? null,
      eRacunBic: d.eRacunBic ?? null,
      email: d.email ?? null,
      phone: d.telefon ?? null,
      steviloUpor: 1,
      zadnjaUporaba: new Date(),
    })
    .returning();
  res.status(201).json(mapKupec(kupec!));
});

// PUT /partnerji/:id — posodobi partnerja
router.put("/partnerji/:id", async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  if (!id) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;
  const d = req.body as any;
  const [updated] = await db
    .update(counterpartiesTable)
    .set({
      name: d.naziv,
      kratkiNaziv: d.kratkiNaziv ?? null,
      address: d.naslov ?? null,
      ulica: d.ulica ?? null,
      postCode: d.postnaStevilka ?? null,
      city: d.kraj ?? null,
      country: d.drzava ?? null,
      kodaDrzave: d.kodaDrzave ?? null,
      vatPayer: d.zavezanecDdv ?? false,
      taxId: d.davcnaStevilka ?? null,
      idZaDdv: d.idZaDdv ?? null,
      registrationNumber: d.maticnaStevilka ?? null,
      trr: d.trr ?? null,
      vrstaPartnerja: d.vrstaPartnerja ?? null,
      kmgMid: d.kmgMid ?? null,
      eRacunPrejemnik: d.eRacunPrejemnik ?? false,
      eRacunOmrezje: d.eRacunOmrezje ?? null,
      eRacunNaslov: d.eRacunNaslov ?? null,
      eRacunEmail: d.eRacunEmail ?? null,
      eRacunSifraPu: d.eRacunSifraPu ?? null,
      eRacunBic: d.eRacunBic ?? null,
      email: d.email ?? null,
      phone: d.telefon ?? null,
    })
    .where(and(
      eq(counterpartiesTable.id, id),
      eq(counterpartiesTable.companyId, ctx.companyId),
    ))
    .returning();
  if (!updated) { res.status(404).json({ napaka: "Partner ni najden" }); return; }
  res.json(mapKupec(updated));
});

// DELETE /partnerji/:id — soft-delete partnerja
router.delete("/partnerji/:id", async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  if (!id) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;

  const [obstojecKupec] = await db
    .select({ id: counterpartiesTable.id })
    .from(counterpartiesTable)
    .where(and(
      eq(counterpartiesTable.id, id),
      eq(counterpartiesTable.companyId, ctx.companyId),
    ))
    .limit(1);
  if (!obstojecKupec) {
    res.status(404).json({ napaka: "Partner ni najden" });
    return;
  }

  await db
    .update(counterpartiesTable)
    .set({ isActive: false })
    .where(eq(counterpartiesTable.id, id));

  res.status(204).end();
});

// POST /partnerji/:id/osvezi — osveži iz registrov (deljena logika s staro potjo)
router.post("/partnerji/:id/osvezi", async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  if (!id) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;
  await osveziPartnerjaPodLogiko(id, ctx.companyId, req, res);
});

// GET /partnerji/:id/cenik
router.get("/partnerji/:id/cenik", async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  if (!id) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;

  const [kupec] = await db.select({ id: counterpartiesTable.id })
    .from(counterpartiesTable)
    .where(and(eq(counterpartiesTable.id, id), eq(counterpartiesTable.companyId, ctx.companyId)))
    .limit(1);
  if (!kupec) { res.status(404).json({ napaka: "Partner ni najden" }); return; }

  const vrstice = await db
    .select({
      artikelId: partnerCenikiTable.artikelId,
      artikelIme: artikliTable.ime,
      kategorijaId: artikliTable.kategorijaId,
      kategorijaIme: kategorijeTable.ime,
      originalCena: artikliTable.cena,
      cena: partnerCenikiTable.cena,
      davek: artikliTable.davek,
    })
    .from(partnerCenikiTable)
    .innerJoin(artikliTable, eq(partnerCenikiTable.artikelId, artikliTable.id))
    .innerJoin(enoteTable, eq(artikliTable.enotaId, enoteTable.id))
    .leftJoin(kategorijeTable, eq(artikliTable.kategorijaId, kategorijeTable.id))
    .where(and(
      eq(partnerCenikiTable.kupecId, id),
      eq(enoteTable.companyId, ctx.companyId),
    ))
    .orderBy(slovenianCollated(artikliTable.ime));

  res.json(vrstice.map(v => ({
    artikelId: v.artikelId,
    artikelIme: v.artikelIme,
    kategorijaId: v.kategorijaId ?? null,
    kategorijaIme: v.kategorijaIme ?? null,
    originalCena: Number(v.originalCena),
    cena: Number(v.cena),
    davek: Number(v.davek),
  })));
});

// PUT /partnerji/:id/cenik/:artikelId — upsert postavke cenika
router.put("/partnerji/:id/cenik/:artikelId", async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  const artikelId = parseInt(req.params.artikelId ?? "");
  if (!id || isNaN(artikelId)) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;
  const enotaId = (req as any).enotaId;
  const cena = Number(req.body?.cena);
  if (!isFinite(cena) || cena < 0) { res.status(400).json({ napaka: "Cena mora biti nenegativno število" }); return; }

  const [kupec] = await db.select({ id: counterpartiesTable.id })
    .from(counterpartiesTable)
    .where(and(eq(counterpartiesTable.id, id), eq(counterpartiesTable.companyId, ctx.companyId)))
    .limit(1);
  if (!kupec) { res.status(404).json({ napaka: "Partner ni najden" }); return; }

  const [artikel] = await db.select({
    id: artikliTable.id, ime: artikliTable.ime,
    cena: artikliTable.cena, davek: artikliTable.davek,
    kategorijaId: artikliTable.kategorijaId,
  })
    .from(artikliTable)
    .innerJoin(enoteTable, eq(artikliTable.enotaId, enoteTable.id))
    .where(and(
      eq(artikliTable.id, artikelId),
      eq(enoteTable.companyId, ctx.companyId),
    ))
    .limit(1);
  if (!artikel) { res.status(404).json({ napaka: "Artikel ni najden" }); return; }

  await db.insert(partnerCenikiTable).values({
    enotaId,
    kupecId: id,
    artikelId,
    cena: String(cena),
  }).onConflictDoUpdate({
    target: [partnerCenikiTable.kupecId, partnerCenikiTable.artikelId],
    set: { cena: String(cena) },
  });

  const [kat] = artikel.kategorijaId
    ? await db.select({ ime: kategorijeTable.ime }).from(kategorijeTable)
        .where(eq(kategorijeTable.id, artikel.kategorijaId)).limit(1)
    : [];

  res.json({
    artikelId,
    artikelIme: artikel.ime,
    kategorijaId: artikel.kategorijaId ?? null,
    kategorijaIme: kat?.ime ?? null,
    originalCena: Number(artikel.cena),
    cena,
    davek: Number(artikel.davek),
  });
});

// DELETE /partnerji/:id/cenik/:artikelId — odstrani postavko cenika
router.delete("/partnerji/:id/cenik/:artikelId", async (req, res): Promise<void> => {
  const id = req.params.id ?? "";
  const artikelId = parseInt(req.params.artikelId ?? "");
  if (!id || isNaN(artikelId)) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const ctx = await requirePartnerjiAccess(req, res);
  if (!ctx) return;

  const [kupec] = await db.select({ id: counterpartiesTable.id })
    .from(counterpartiesTable)
    .where(and(eq(counterpartiesTable.id, id), eq(counterpartiesTable.companyId, ctx.companyId)))
    .limit(1);
  if (!kupec) { res.status(404).json({ napaka: "Partner ni najden" }); return; }

  const [artikel] = await db.select({ id: artikliTable.id })
    .from(artikliTable)
    .innerJoin(enoteTable, eq(artikliTable.enotaId, enoteTable.id))
    .where(and(
      eq(artikliTable.id, artikelId),
      eq(enoteTable.companyId, ctx.companyId),
    ))
    .limit(1);
  if (!artikel) { res.status(404).json({ napaka: "Artikel ni najden" }); return; }

  await db.delete(partnerCenikiTable)
    .where(and(eq(partnerCenikiTable.kupecId, id), eq(partnerCenikiTable.artikelId, artikelId)));

  res.status(204).send();
});

export default router;

// ─── Interni helper za logiko osveži (deljena med /kupec/shranjeni in /partnerji) ───

/**
 * Shranjuje logiko osveži skupaj — kliče jo tako /kupec/shranjeni/:id/osvezi
 * kot /partnerji/:id/osvezi. Obe poti imata identično logiko, razlikujeta se
 * le v poti. Helper je definiran PO export default, ker je interni.
 */
async function osveziPartnerjaPodLogiko(id: string, companyId: string, req: Request, res: Response): Promise<void> {
  const [obstojecKupec] = await db
    .select()
    .from(counterpartiesTable)
    .where(and(
      eq(counterpartiesTable.id, id),
      eq(counterpartiesTable.companyId, companyId),
    ))
    .limit(1);

  if (!obstojecKupec) { res.status(404).json({ napaka: "Kupec ni najden" }); return; }

  const davcna = obstojecKupec.taxId?.trim();
  const idZaDdv = obstojecKupec.idZaDdv?.trim();
  const jeTuji = !davcna || !/^\d{8}$/.test(davcna);

  if (jeTuji) {
    if (!idZaDdv || !/^[A-Z]{2}.+$/i.test(idZaDdv)) {
      res.status(400).json({ napaka: "Partner nima EU VAT ID — osveževanje ni mogoče." });
      return;
    }
    const vies = await preveriVies(idZaDdv);
    if (!vies) {
      res.status(503).json({ napaka: "VIES ni dosegljiv. Poskusite pozneje.", kodaNapake: "VIES_NEDOSEGLJIV" });
      return;
    }
    const kodaDrzave = obstojecKupec.kodaDrzave ?? vies.kodaDrzave;
    const imaPodatke = !!(vies.naziv || vies.ulica || vies.postnaStevilka || vies.kraj);
    if (!vies.veljaven && !imaPodatke) {
      const drzavaNaziv = vies.drzavaNaziv ?? drzavaIzKode(kodaDrzave) ?? kodaDrzave;
      res.status(422).json({
        napaka: `VIES ne vrača podatkov za ${drzavaNaziv}. Dopolnite podatke ročno.`,
        kodaNapake: "VIES_NO_DATA",
      });
      return;
    }
    const [posodobljen] = await db
      .update(counterpartiesTable)
      .set({
        ...(vies.naziv ? { name: vies.naziv } : {}),
        ...(vies.ulica ? { ulica: vies.ulica, address: vies.ulica } : {}),
        ...(vies.postnaStevilka ? { postCode: vies.postnaStevilka } : {}),
        ...(vies.kraj ? { city: vies.kraj } : {}),
        country: obstojecKupec.country || vies.drzavaNaziv || drzavaIzKode(kodaDrzave),
        kodaDrzave,
        vatPayer: vies.veljaven ? true : (obstojecKupec.vatPayer ?? false),
      })
      .where(and(eq(counterpartiesTable.id, id), eq(counterpartiesTable.companyId, companyId)))
      .returning();
    res.json(mapKupec(posodobljen!));
    return;
  }

  const svezi = await poisciNaInetis(davcna);
  if (!svezi) {
    res.status(422).json({
      napaka: `Podjetja z davčno ${davcna} ni v registru AJPES/INETIS. Dopolnite podatke ročno.`,
      kodaNapake: "INETIS_NI_ZADETKOV",
    });
    return;
  }
  function normalizeMaticnaZaUjp(m?: string | null): string | undefined {
    if (!m) return undefined;
    const t = m.trim().replace(/0+$/, "");
    return t.length >= 4 ? t : m.trim();
  }
  const maticnaZaUjp = normalizeMaticnaZaUjp(svezi.maticnaStevilka ?? obstojecKupec.registrationNumber);
  const [eReg, ujpVnosi, ajpesSub] = await Promise.all([
    poisciNaBizBox(davcna, svezi.naziv),
    poisciVUjp(davcna, maticnaZaUjp),
    poisciVAjpes(svezi.maticnaStevilka ?? obstojecKupec.registrationNumber),
  ]);
  const jeVUjp = ujpVnosi.length > 0;
  function ujpTrrVIban(trrSt: string): string {
    const cleaned = trrSt.trim();
    if (/^SI\d{17}$/i.test(cleaned)) return cleaned.toUpperCase();
    if (!/^\d{15}$/.test(cleaned)) return cleaned;
    const rearranged = cleaned + "281800";
    const mod = BigInt(rearranged) % 97n;
    const check = String(98n - mod).padStart(2, "0");
    return `SI${check}${cleaned}`;
  }
  const eRacunPrejemnik = jeVUjp ? true : (eReg?.registriran ?? null);
  const eRacunOmrezje = jeVUjp ? "UJP" : (eReg?.omrezje ?? obstojecKupec.eRacunOmrezje ?? null);
  const eRacunNaslov = jeVUjp
    ? ujpTrrVIban(ujpVnosi[0]!.trrSt)
    : (eReg?.naslov ?? obstojecKupec.eRacunNaslov ?? null);
  const eRacunSifraPu = jeVUjp ? (ujpVnosi[0]!.sifraPu || null) : obstojecKupec.eRacunSifraPu ?? null;
  const ujpIban = jeVUjp ? ujpTrrVIban(ujpVnosi[0]!.trrSt) : null;
  const eRacunBic = (jeVUjp && ujpIban?.replace(/\s/g, "").toUpperCase().startsWith("SI5601"))
    ? "BSLJSI2X"
    : (obstojecKupec.eRacunBic ?? null);
  const surowiTrr = (svezi.trr && svezi.trr.length > 0) ? svezi.trr : obstojecKupec.trr;
  const trrji = surowiTrr
    ? (surowiTrr as Array<{ iban: string; bic: string }>).map(t =>
        t.iban.replace(/\s/g, "").toUpperCase().startsWith("SI5601")
          ? { ...t, bic: "BSLJSI2X" }
          : t)
    : surowiTrr;
  const novaVrsta = zaznajVrsto(svezi.naziv, svezi.zavezanecDdv, svezi.maticnaStevilka);
  const eRacunPosodobitev =
    jeVUjp ? { eRacunPrejemnik: true, eRacunOmrezje: "UJP", eRacunNaslov, eRacunSifraPu, eRacunBic }
    : eReg !== null ? {
        eRacunPrejemnik: eReg.registriran,
        eRacunOmrezje: eReg.omrezje ?? obstojecKupec.eRacunOmrezje,
        ...(eReg.naslov ? { eRacunNaslov: eReg.naslov } : {}),
      }
    : {};
  const ajpesEmail = (ajpesSub?.email && !obstojecKupec.email) ? ajpesSub.email : undefined;
  const [posodobljen] = await db
    .update(counterpartiesTable)
    .set({
      name: svezi.naziv || obstojecKupec.name,
      kratkiNaziv: svezi.kratkiNaziv ?? obstojecKupec.kratkiNaziv,
      address: svezi.naslov ?? obstojecKupec.address,
      ulica: svezi.ulica ?? obstojecKupec.ulica,
      postCode: svezi.postnaStevilka ?? obstojecKupec.postCode,
      city: svezi.kraj ?? obstojecKupec.city,
      country: obstojecKupec.country || "Slovenija",
      kodaDrzave: obstojecKupec.kodaDrzave || "SI",
      vatPayer: svezi.zavezanecDdv ?? obstojecKupec.vatPayer,
      idZaDdv: svezi.idZaDdv ?? obstojecKupec.idZaDdv,
      registrationNumber: svezi.maticnaStevilka ?? obstojecKupec.registrationNumber,
      trr: trrji,
      ...(novaVrsta !== null ? { vrstaPartnerja: novaVrsta } : {}),
      ...(ajpesEmail ? { email: ajpesEmail } : {}),
      ...eRacunPosodobitev,
    })
    .where(and(eq(counterpartiesTable.id, id), eq(counterpartiesTable.companyId, companyId)))
    .returning();
  res.json(mapKupec(posodobljen!));
}
