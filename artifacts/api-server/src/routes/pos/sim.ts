/**
 * Simulacijski način — upravljanje datuma in brisanje prometov za testiranje.
 */
import { Router, type IRouter } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db, nastavitveTable, izmeneTable, racuniTable, narocilaTable,
  artikliTable, zacetneZalogeTable, zacetneZalogePostavkeTable,
  zalogaGibiTable, zalogeTable,
} from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";
import { broadcast } from "../../lib/pos-sse";
import { SIM_DATUM_KEY } from "../../lib/sim-datum";

const router: IRouter = Router();

// ── GET /sim ─────────────────────────────────────────────────────────────────
router.get("/sim", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;
  const [row] = await db
    .select({ vrednost: nastavitveTable.vrednost })
    .from(nastavitveTable)
    .where(and(eq(nastavitveTable.enotaId, enotaId), eq(nastavitveTable.kljuc, SIM_DATUM_KEY)));
  const datum = row?.vrednost ?? null;
  res.json({ active: datum !== null, datum });
});

// ── POST /sim/datum ───────────────────────────────────────────────────────────
// Nastavi simulacijski datum. Novi datum mora biti >= prejšnjega.
// Samodejno zapre vse odprte izmene.
router.post("/sim/datum", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;
  const { datum } = req.body ?? {};
  if (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) {
    res.status(400).json({ error: "Datum mora biti v obliki YYYY-MM-DD" }); return;
  }

  // Preveri da je novi datum >= obstoječega
  const [existing] = await db
    .select({ vrednost: nastavitveTable.vrednost })
    .from(nastavitveTable)
    .where(and(eq(nastavitveTable.enotaId, enotaId), eq(nastavitveTable.kljuc, SIM_DATUM_KEY)));

  if (existing?.vrednost && datum < existing.vrednost) {
    res.status(400).json({ error: `Datum mora biti večji ali enak ${existing.vrednost}` }); return;
  }

  // Zapri vse odprte izmene za to enoto (zaključek dneva)
  const openIzmene = await db
    .select({ id: izmeneTable.id })
    .from(izmeneTable)
    .where(and(isNull(izmeneTable.konec), eq(izmeneTable.enotaId, enotaId)));

  const konecDatum = existing?.vrednost
    ? new Date(existing.vrednost + "T23:59:59")
    : new Date();

  for (const izmena of openIzmene) {
    const aggResult = await db.execute(sql`
      SELECT COALESCE(SUM(CAST(skupaj AS NUMERIC)), 0)::text AS skupaj_znesek,
             COUNT(*)::integer AS stevilo_racunov
      FROM racuni
      WHERE izmena_id = ${izmena.id} AND enota_id = ${enotaId}
    `);
    const agg = aggResult.rows[0] as any;
    await db.update(izmeneTable)
      .set({
        konec: konecDatum,
        skupajZnesek: String(agg?.skupaj_znesek ?? "0"),
        steviloRacunov: Number(agg?.stevilo_racunov ?? 0),
      })
      .where(eq(izmeneTable.id, izmena.id));
  }

  // Shrani/posodobi sim_datum v nastavitve
  await db.insert(nastavitveTable)
    .values({ enotaId, kljuc: SIM_DATUM_KEY, vrednost: datum })
    .onConflictDoUpdate({
      target: [nastavitveTable.enotaId, nastavitveTable.kljuc],
      set: { vrednost: datum },
    });

  broadcast("update", { type: "sim" });
  res.json({ datum, izmeneZaprte: openIzmene.length });
});

// ── DELETE /sim/datum ─────────────────────────────────────────────────────────
router.delete("/sim/datum", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;
  await db.delete(nastavitveTable)
    .where(and(eq(nastavitveTable.enotaId, enotaId), eq(nastavitveTable.kljuc, SIM_DATUM_KEY)));
  broadcast("update", { type: "sim" });
  res.status(204).send();
});

// ── POST /sim/reset ───────────────────────────────────────────────────────────
// Pobriše vse promete (narocila, racuni, izmene, zaloge, prejemnice, ...) za enoto.
router.post("/sim/reset", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;

  await db.transaction(async (tx) => {
    // 1. Zaloga gibanja
    await tx.execute(sql`
      DELETE FROM zaloga_gibi
      WHERE artikel_id IN (SELECT id FROM artikli WHERE enota_id = ${enotaId})
    `);
    // 2. Inventure
    await tx.execute(sql`
      DELETE FROM inventure_postavke
      WHERE inventura_id IN (SELECT id FROM inventure WHERE enota_id = ${enotaId})
    `);
    await tx.execute(sql`DELETE FROM inventure WHERE enota_id = ${enotaId}`);
    // 3. Izdajnice
    await tx.execute(sql`
      DELETE FROM izdajnice_postavke
      WHERE izdajnica_id IN (SELECT id FROM izdajnice WHERE enota_id = ${enotaId})
    `);
    await tx.execute(sql`DELETE FROM izdajnice WHERE enota_id = ${enotaId}`);
    // 4. Prejemnice
    await tx.execute(sql`
      DELETE FROM prejemnice_postavke
      WHERE prejemnica_id IN (SELECT id FROM prejemnice WHERE enota_id = ${enotaId})
    `);
    await tx.execute(sql`DELETE FROM prejemnice WHERE enota_id = ${enotaId}`);
    // 5. Začetne zaloge
    await tx.execute(sql`
      DELETE FROM zacetne_zaloge_postavke
      WHERE zacetna_zaloga_id IN (SELECT id FROM zacetne_zaloge WHERE enota_id = ${enotaId})
    `);
    await tx.execute(sql`DELETE FROM zacetne_zaloge WHERE enota_id = ${enotaId}`);
    // 6. Tiskalne naloge (pred racuni)
    await tx.execute(sql`
      DELETE FROM tiskalne_naloge
      WHERE racun_id IN (SELECT id FROM racuni WHERE enota_id = ${enotaId})
    `);
    // 7. Viva vracila (pred racuni)
    await tx.execute(sql`
      DELETE FROM viva_vracila
      WHERE racun_id IN (SELECT id FROM racuni WHERE enota_id = ${enotaId})
    `);
    // 8. Prenosi narocil (pred narocili)
    await tx.execute(sql`
      DELETE FROM prenosi_narocil
      WHERE narocilo_id IN (SELECT id FROM narocila WHERE enota_id = ${enotaId})
    `);
    // 9. Postavke (vrstice narocil/racunov)
    await tx.execute(sql`
      DELETE FROM postavke
      WHERE narocilo_id IN (SELECT id FROM narocila WHERE enota_id = ${enotaId})
    `);
    // 10. Racuni
    await tx.execute(sql`DELETE FROM racuni WHERE enota_id = ${enotaId}`);
    // 11. Narocila
    await tx.execute(sql`DELETE FROM narocila WHERE enota_id = ${enotaId}`);
    // 12. Izmene (izmena_id je FK v racuni — racuni so že brisani)
    await tx.execute(sql`DELETE FROM izmene WHERE enota_id = ${enotaId}`);
    // 13. Ponastavi stanja zalog
    await tx.execute(sql`
      UPDATE zaloge
      SET kolicina = '0',
          povprecna_cena = NULL,
          skupna_vrednost = NULL,
          zadnja_posodobitev = NOW()
      WHERE artikel_id IN (SELECT id FROM artikli WHERE enota_id = ${enotaId})
    `);
  });

  broadcast("update", { type: "zaloge" });
  broadcast("update", { type: "narocila" });
  res.json({ ok: true });
});

// ── POST /sim/zacetne-zaloge ──────────────────────────────────────────────────
// Naključno generira začetne zaloge za vse nabavne artikle.
router.post("/sim/zacetne-zaloge", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;
  const { datum, leto } = req.body ?? {};

  if (!datum || !leto) {
    res.status(400).json({ error: "Datum in leto sta obvezna" }); return;
  }
  const letoInt = parseInt(String(leto));
  if (isNaN(letoInt)) {
    res.status(400).json({ error: "Neveljaven leto" }); return;
  }

  // Preveri da leta še ni
  const [existing] = await db
    .select({ id: zacetneZalogeTable.id })
    .from(zacetneZalogeTable)
    .where(and(eq(zacetneZalogeTable.enotaId, enotaId), eq(zacetneZalogeTable.leto, letoInt)));
  if (existing) {
    res.status(409).json({ error: `Začetne zaloge za leto ${letoInt} že obstajajo` }); return;
  }

  // Nabavni artikli
  const artikli = await db
    .select({ id: artikliTable.id, ime: artikliTable.ime })
    .from(artikliTable)
    .where(and(eq(artikliTable.enotaId, enotaId), eq(artikliTable.nabavniArtikel, true)));

  if (!artikli.length) {
    res.status(400).json({ error: "Ni nabavnih artiklov v tej enoti" }); return;
  }

  // Deterministična psevdonaključna funkcija (seed iz id artikla)
  function rng(seed: number, min: number, max: number, decimals = 0): number {
    const x = Math.sin(seed * 9301 + 49297) * 233280;
    const r = x - Math.floor(x);
    const val = min + r * (max - min);
    const mult = Math.pow(10, decimals);
    return Math.round(val * mult) / mult;
  }

  const yy = String(letoInt).slice(-2);
  const stevilka = `${yy}000001`;

  const { zz, postavkeResult } = await db.transaction(async (tx) => {
    const [zz] = await tx.insert(zacetneZalogeTable).values({
      enotaId,
      leto: letoInt,
      stevilka,
      datum: new Date(datum),
      opomba: `Simulacijske začetne zaloge ${letoInt}`,
    }).returning();

    const postavkeResult: { artikelId: number; artikelIme: string; kolicina: number; cenaKos: number }[] = [];

    for (let i = 0; i < artikli.length; i++) {
      const art = artikli[i];
      const seed = art.id * 137 + i * 31 + letoInt;
      // Količina: 10–100, zaokrožena na 5
      const kolicina = Math.round(rng(seed, 10, 100, 0) / 5) * 5;
      // Cena/kos: 0.50–30.00 €
      const cenaKos = rng(seed + 7, 0.5, 30.0, 2);

      await tx.insert(zacetneZalogePostavkeTable).values({
        zacetnaZalogaId: zz.id,
        artikelId: art.id,
        kolicina: String(kolicina),
        cenaKos: String(cenaKos),
        steviloPrejsnje: "0",
      });

      await tx.execute(sql`
        INSERT INTO zaloge (artikel_id, kolicina, zadnja_posodobitev)
        VALUES (${art.id}, ${String(kolicina)}, NOW())
        ON CONFLICT (artikel_id) DO UPDATE
          SET kolicina = ${String(kolicina)}, zadnja_posodobitev = NOW()
      `);

      await tx.insert(zalogaGibiTable).values({
        artikelId: art.id,
        tip: "inventura",
        kolicina: String(kolicina),
        opomba: `Začetne zaloge ${letoInt}`,
        referencaId: zz.id,
      });

      postavkeResult.push({ artikelId: art.id, artikelIme: art.ime, kolicina, cenaKos });
    }

    return { zz, postavkeResult };
  });

  // WAC preračun za vse artikel
  await recomputeZaloge(artikli.map(a => a.id));
  broadcast("update", { type: "zaloge" });

  res.status(201).json({
    id: zz.id,
    stevilka: zz.stevilka,
    datum: zz.datum,
    steviloArtklov: postavkeResult.length,
    postavke: postavkeResult,
  });
});

export default router;
