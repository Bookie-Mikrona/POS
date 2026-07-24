import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, desc, eq, inArray, ne, sql, sum } from "drizzle-orm";
import { artModSkupineTable, artikliTable, db, kategorijeTable, modSkupineTable, modifikatorjiTable, nastavitveTable, normativiTable, postavkeTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";

const router: IRouter = Router();

const SELECT_FIELDS = {
  id: artikliTable.id,
  ime: artikliTable.ime,
  opis: artikliTable.opis,
  cena: artikliTable.cena,
  davek: artikliTable.davek,
  aktiven: artikliTable.aktiven,
  kategorijaId: artikliTable.kategorijaId,
  kategorijaIme: kategorijeTable.ime,
  barva: artikliTable.barva,
  vrstniRed: artikliTable.vrstniRed,
  nabavniArtikel: artikliTable.nabavniArtikel,
  prodajniArtikel: artikliTable.prodajniArtikel,
  imeZaNabavo: artikliTable.imeZaNabavo,
  enotaMere: artikliTable.enotaMere,
  jePica: artikliTable.jePica,
  jeDodatekZaPico: artikliTable.jeDodatekZaPico,
  privzetiDodatki: artikliTable.privzetiDodatki,
  jeModifikator: artikliTable.jeModifikator,
  privzetiModifikatorji: artikliTable.privzetiModifikatorji,
  toGoArtikli: artikliTable.toGoArtikli,
  toGo: artikliTable.toGo,
  vrstaArtikla: artikliTable.vrstaArtikla,
  hasNormativ: sql<boolean>`EXISTS (SELECT 1 FROM normativi WHERE artikel_id = ${artikliTable.id})`};

function mapRow(r: Record<string, unknown>) {
  return {
    id: r.id as number,
    ime: r.ime as string,
    opis: (r.opis as string | null) ?? null,
    cena: Number(r.cena),
    davek: Number(r.davek),
    aktiven: r.aktiven as boolean,
    kategorijaId: (r.kategorijaId as number | null) ?? null,
    kategorijaIme: (r.kategorijaIme as string | null) ?? null,
    barva: (r.barva as string | null) ?? null,
    vrstniRed: r.vrstniRed as number,
    nabavniArtikel: r.nabavniArtikel as boolean,
    prodajniArtikel: r.prodajniArtikel as boolean,
    imeZaNabavo: (r.imeZaNabavo as string | null) ?? null,
    enotaMere: (r.enotaMere as string | null) ?? null,
    jePica: r.jePica as boolean,
    jeDodatekZaPico: r.jeDodatekZaPico as boolean,
    privzetiDodatki: (r.privzetiDodatki as number[] | null) ?? [],
    jeModifikator: r.jeModifikator as boolean,
    privzetiModifikatorji: (r.privzetiModifikatorji as number[] | null) ?? [],
    toGoArtikli: (r.toGoArtikli as number[] | null) ?? [],
    toGo: Boolean(r.toGo),
    vrstaArtikla: (r.vrstaArtikla as string | null) ?? "material",
    hasNormativ: Boolean(r.hasNormativ),
    modSkupine: [] as Array<{
      id: number; ime: string; obvezna: boolean; minIzbir: number; maxIzbir: number; vrstniRed: number;
      modifikatorji: Array<{ id: number; skupinaId: number; ime: string; cenaDodatek: number; aktiven: boolean; vrstniRed: number }>;
    }>};
}

async function fetchModSkupineForArtikli(artikelIds: number[]) {
  if (artikelIds.length === 0) return new Map<number, ReturnType<typeof mapRow>["modSkupine"]>();

  const rows = await db
    .select({
      artikelId: artModSkupineTable.artikelId,
      skupinaVrstniRed: artModSkupineTable.vrstniRed,
      skupinaId: modSkupineTable.id,
      skupinaIme: modSkupineTable.ime,
      skupinaObvezna: modSkupineTable.obvezna,
      skupinaMinIzbir: modSkupineTable.minIzbir,
      skupinaMaxIzbir: modSkupineTable.maxIzbir,
      skupinaVrstniRedNat: modSkupineTable.vrstniRed,
      modId: modifikatorjiTable.id,
      modIme: modifikatorjiTable.ime,
      modCenaDodatek: modifikatorjiTable.cenaDodatek,
      modAktiven: modifikatorjiTable.aktiven,
      modVrstniRed: modifikatorjiTable.vrstniRed})
    .from(artModSkupineTable)
    .innerJoin(modSkupineTable, eq(artModSkupineTable.skupinaId, modSkupineTable.id))
    .leftJoin(modifikatorjiTable, eq(modifikatorjiTable.skupinaId, modSkupineTable.id))
    .where(inArray(artModSkupineTable.artikelId, artikelIds))
    .orderBy(asc(artModSkupineTable.vrstniRed), asc(modSkupineTable.id), asc(modifikatorjiTable.vrstniRed), asc(modifikatorjiTable.id));

  const map = new Map<number, Map<number, ReturnType<typeof mapRow>["modSkupine"][number]>>();
  for (const r of rows) {
    const aId = r.artikelId as number;
    if (!map.has(aId)) map.set(aId, new Map());
    const skupineMap = map.get(aId)!;
    if (!skupineMap.has(r.skupinaId as number)) {
      skupineMap.set(r.skupinaId as number, {
        id: r.skupinaId as number,
        ime: r.skupinaIme as string,
        obvezna: r.skupinaObvezna as boolean,
        minIzbir: r.skupinaMinIzbir as number,
        maxIzbir: r.skupinaMaxIzbir as number,
        vrstniRed: r.skupinaVrstniRed as number,
        modifikatorji: []});
    }
    if (r.modId != null) {
      skupineMap.get(r.skupinaId as number)!.modifikatorji.push({
        id: r.modId as number,
        skupinaId: r.skupinaId as number,
        ime: r.modIme as string,
        cenaDodatek: Number(r.modCenaDodatek),
        aktiven: r.modAktiven as boolean,
        vrstniRed: r.modVrstniRed as number});
    }
  }

  const result = new Map<number, ReturnType<typeof mapRow>["modSkupine"]>();
  for (const [aId, skupineMap] of map.entries()) {
    result.set(aId, Array.from(skupineMap.values()));
  }
  return result;
}

router.get("/artikli/priljubljeni", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db
    .select({
      artikelId: postavkeTable.artikelId,
      ime: postavkeTable.ime,
      steviloNarocil: count(postavkeTable.id),
      skupajZnesek: sum(postavkeTable.skupaj)})
    .from(postavkeTable)
    .innerJoin(artikliTable, eq(postavkeTable.artikelId, artikliTable.id))
    .where(and(eq(artikliTable.enotaId, tenotaId)))
    .groupBy(postavkeTable.artikelId, postavkeTable.ime)
    .orderBy(desc(count(postavkeTable.id)))
    .limit(10);

  const mapped = rows.map((r) => ({
    artikelId: r.artikelId,
    ime: r.ime,
    steviloNarocil: Number(r.steviloNarocil),
    skupajZnesek: Number(r.skupajZnesek ?? 0)}));

  res.json((mapped));
});

router.get("/artikli", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const query = { success: true as const, data: req.query };
  if (!query.success) { res.status(400).json({ error: (query as any).error.message }); return; }

  const conditions = [sql`true`, eq(artikliTable.enotaId, tenotaId)];
  if (query.data.kategorijaId != null) conditions.push(eq(artikliTable.kategorijaId, Number(query.data.kategorijaId)));

  const rows = await db
    .select(SELECT_FIELDS)
    .from(artikliTable)
    .leftJoin(kategorijeTable, and(eq(artikliTable.kategorijaId, kategorijeTable.id), sql`true`, eq(kategorijeTable.enotaId, tenotaId)))
    .where(and(...conditions))
    .orderBy(asc(artikliTable.vrstniRed), asc(artikliTable.ime));

  const mapped = rows.map(mapRow);
  const modMap = await fetchModSkupineForArtikli(mapped.map((a) => a.id));
  const enriched = mapped.map((a) => ({ ...a, modSkupine: modMap.get(a.id) ?? [] }));
  res.json((enriched));
});

router.post("/artikli", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  if (parsed.data.kategorijaId != null) {
    const [kat] = await db.select({ id: kategorijeTable.id })
      .from(kategorijeTable)
      .where(and(eq(kategorijeTable.id, parsed.data.kategorijaId), sql`true`, eq(kategorijeTable.enotaId, tenotaId)));
    if (!kat) { res.status(403).json({ error: "Kategorija ne pripada temu podjetju" }); return; }
  }

  const [row] = await db.insert(artikliTable).values({
    enotaId: tenotaId,
    ime: parsed.data.ime,
    opis: parsed.data.opis ?? null,
    cena: String(parsed.data.cena ?? 0),
    davek: String(parsed.data.davek ?? 0),
    aktiven: parsed.data.aktiven ?? true,
    kategorijaId: parsed.data.kategorijaId ?? null,
    barva: parsed.data.barva ?? null,
    vrstniRed: parsed.data.vrstniRed ?? 0,
    nabavniArtikel: parsed.data.nabavniArtikel ?? false,
    prodajniArtikel: parsed.data.prodajniArtikel ?? true,
    imeZaNabavo: parsed.data.imeZaNabavo ?? null,
    enotaMere: parsed.data.enotaMere ?? null,
    jePica: parsed.data.jePica ?? false,
    jeDodatekZaPico: (parsed.data as { jeDodatekZaPico?: boolean }).jeDodatekZaPico ?? false,
    privzetiDodatki: (parsed.data as { privzetiDodatki?: number[] }).privzetiDodatki ?? [],
    jeModifikator: (parsed.data as { jeModifikator?: boolean }).jeModifikator ?? false,
    privzetiModifikatorji: (parsed.data as { privzetiModifikatorji?: number[] }).privzetiModifikatorji ?? [],
    toGoArtikli: (parsed.data as { toGoArtikli?: number[] }).toGoArtikli ?? [],
    toGo: (parsed.data as { toGo?: boolean }).toGo ?? false,
    vrstaArtikla: (parsed.data as { vrstaArtikla?: string }).vrstaArtikla ?? "material"}).returning();

  const [withKat] = await db
    .select(SELECT_FIELDS)
    .from(artikliTable)
    .leftJoin(kategorijeTable, and(eq(artikliTable.kategorijaId, kategorijeTable.id), sql`true`, eq(kategorijeTable.enotaId, tenotaId)))
    .where(eq(artikliTable.id, row.id));

  res.status(201).json((mapRow(withKat!)));
});

router.patch("/artikli/reorder", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  await Promise.all(
    parsed.data.map(({ id, vrstniRed }: { id: number; vrstniRed: number }) =>
      db.update(artikliTable).set({ vrstniRed })
        .where(and(eq(artikliTable.id, id), sql`true`, eq(artikliTable.enotaId, tenotaId)))
    )
  );

  res.sendStatus(204);
});

router.post("/artikli/uskladi-ddv", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;

  // Preberi globalne DDV stopnje
  const globalRows = await db
    .select({ kljuc: nastavitveTable.kljuc, vrednost: nastavitveTable.vrednost })
    .from(nastavitveTable)
    .where(and(eq(nastavitveTable.enotaId, 0)));
  const ddvMap: Record<string, string> = {};
  for (const r of globalRows) ddvMap[r.kljuc] = r.vrednost;
  const splosnaSt = Number(ddvMap["ddvSplosnaSt"] ?? "22");
  const nizjaSt   = Number(ddvMap["ddvNizjaSt"]   ?? "9.5");
  const znizanaSt = Number(ddvMap["ddvZnizanaSt"] ?? "5");
  const slots = [splosnaSt, nizjaSt, znizanaSt];

  // Preberi vse artikle podjetja
  const artiki = await db
    .select({ id: artikliTable.id, davek: artikliTable.davek })
    .from(artikliTable)
    .where(and(eq(artikliTable.enotaId, tenotaId)));

  // Razporedi artikle po ciljni stopnji (davek=0 preskočimo)
  const skupineUpdate = new Map<number, number[]>();
  for (const art of artiki) {
    const trenutna = Number(art.davek);
    if (trenutna === 0) continue;
    let najbljizja = slots[0]!;
    let minDiff = Math.abs(trenutna - najbljizja);
    for (const s of slots) {
      const diff = Math.abs(trenutna - s);
      if (diff < minDiff) { minDiff = diff; najbljizja = s; }
    }
    if (najbljizja === trenutna) continue;
    const ids = skupineUpdate.get(najbljizja) ?? [];
    ids.push(art.id);
    skupineUpdate.set(najbljizja, ids);
  }

  let posodobljeno = 0;
  for (const [novaStopnja, ids] of skupineUpdate.entries()) {
    await db
      .update(artikliTable)
      .set({ davek: String(novaStopnja) })
      .where(and(eq(artikliTable.enotaId, tenotaId),
        inArray(artikliTable.id, ids)
      ));
    posodobljeno += ids.length;
  }

  res.json({ posodobljeno, splosnaSt, nizjaSt, znizanaSt });
});

router.get("/artikli/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }

  const [row] = await db
    .select(SELECT_FIELDS)
    .from(artikliTable)
    .leftJoin(kategorijeTable, and(eq(artikliTable.kategorijaId, kategorijeTable.id), sql`true`, eq(kategorijeTable.enotaId, tenotaId)))
    .where(and(eq(artikliTable.id, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));

  if (!row) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  const mapped = mapRow(row);
  const modMap = await fetchModSkupineForArtikli([mapped.id]);
  mapped.modSkupine = modMap.get(mapped.id) ?? [];
  res.json((mapped));
});

router.put("/artikli/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const updateData: Partial<typeof artikliTable.$inferInsert> = {};
  if (parsed.data.ime !== undefined) updateData.ime = parsed.data.ime;
  if (parsed.data.opis !== undefined) updateData.opis = parsed.data.opis;
  if (parsed.data.cena !== undefined) updateData.cena = String(parsed.data.cena);
  if (parsed.data.davek !== undefined) updateData.davek = String(parsed.data.davek);
  if (parsed.data.aktiven !== undefined) updateData.aktiven = parsed.data.aktiven;
  if ("kategorijaId" in parsed.data) updateData.kategorijaId = parsed.data.kategorijaId ?? null;
  if ("barva" in parsed.data) updateData.barva = parsed.data.barva ?? null;
  if (parsed.data.vrstniRed !== undefined) updateData.vrstniRed = parsed.data.vrstniRed;
  if (parsed.data.nabavniArtikel !== undefined) updateData.nabavniArtikel = parsed.data.nabavniArtikel;
  if (parsed.data.prodajniArtikel !== undefined) updateData.prodajniArtikel = parsed.data.prodajniArtikel;
  if ("imeZaNabavo" in parsed.data) updateData.imeZaNabavo = parsed.data.imeZaNabavo ?? null;
  if ("enotaMere" in parsed.data) updateData.enotaMere = parsed.data.enotaMere ?? null;
  if (parsed.data.jePica !== undefined) updateData.jePica = parsed.data.jePica;
  if ((parsed.data as { jeDodatekZaPico?: boolean }).jeDodatekZaPico !== undefined) updateData.jeDodatekZaPico = (parsed.data as { jeDodatekZaPico?: boolean }).jeDodatekZaPico;
  if ((parsed.data as { privzetiDodatki?: number[] }).privzetiDodatki !== undefined) updateData.privzetiDodatki = (parsed.data as { privzetiDodatki?: number[] }).privzetiDodatki ?? [];
  if ((parsed.data as { jeModifikator?: boolean }).jeModifikator !== undefined) updateData.jeModifikator = (parsed.data as { jeModifikator?: boolean }).jeModifikator;
  if ((parsed.data as { privzetiModifikatorji?: number[] }).privzetiModifikatorji !== undefined) updateData.privzetiModifikatorji = (parsed.data as { privzetiModifikatorji?: number[] }).privzetiModifikatorji ?? [];
  if ((parsed.data as { toGoArtikli?: number[] }).toGoArtikli !== undefined) updateData.toGoArtikli = (parsed.data as { toGoArtikli?: number[] }).toGoArtikli ?? [];
  if ((parsed.data as { toGo?: boolean }).toGo !== undefined) updateData.toGo = (parsed.data as { toGo?: boolean }).toGo;
  if ((parsed.data as { vrstaArtikla?: string }).vrstaArtikla !== undefined) updateData.vrstaArtikla = (parsed.data as { vrstaArtikla?: string }).vrstaArtikla;

  if ("kategorijaId" in parsed.data && parsed.data.kategorijaId != null) {
    const [kat] = await db.select({ id: kategorijeTable.id })
      .from(kategorijeTable)
      .where(and(eq(kategorijeTable.id, parsed.data.kategorijaId), sql`true`, eq(kategorijeTable.enotaId, tenotaId)));
    if (!kat) { res.status(403).json({ error: "Kategorija ne pripada temu podjetju" }); return; }
  }

  await db.update(artikliTable).set(updateData)
    .where(and(eq(artikliTable.id, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));

  const [row] = await db
    .select(SELECT_FIELDS)
    .from(artikliTable)
    .leftJoin(kategorijeTable, and(eq(artikliTable.kategorijaId, kategorijeTable.id), sql`true`, eq(kategorijeTable.enotaId, tenotaId)))
    .where(and(eq(artikliTable.id, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));

  if (!row) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  res.json((mapRow(row)));
});

router.delete("/artikli/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }

  const [owner] = await db.select({ id: artikliTable.id })
    .from(artikliTable)
    .where(and(eq(artikliTable.id, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));
  if (!owner) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  const vpNormativi = await db
    .select({ id: artikliTable.id, ime: artikliTable.ime })
    .from(normativiTable)
    .innerJoin(artikliTable, eq(normativiTable.artikelId, artikliTable.id))
    .where(and(eq(normativiTable.vhodniArtikelId, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));

  if (vpNormativi.length > 0) {
    const potrdi = req.query["potrdi"] === "1";
    if (!potrdi) {
      res.status(409).json({ error: "Artikel se uporablja v normativih", vpNormativi });
      return;
    }
    // Potrjeno kaskadno brisanje: odstrani vse normativne vrstice, kjer je ta artikel sestavina
    await db.delete(normativiTable).where(eq(normativiTable.vhodniArtikelId, params.data.id));
  }

  // Preverimo ali je artikel vezan na kakšne postavke (naročila ali računi)
  const vpPostavke = await db
    .select({ id: postavkeTable.id })
    .from(postavkeTable)
    .where(eq(postavkeTable.artikelId, params.data.id))
    .limit(1);

  if (vpPostavke.length > 0) {
    // Artikel ima zgodovino — ne moremo ga izbrisati, deaktiviramo ga
    await db.update(artikliTable)
      .set({ aktiven: false })
      .where(and(eq(artikliTable.id, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));
    res.json({ deaktiviran: true });
    return;
  }

  await db.delete(artikliTable)
    .where(and(eq(artikliTable.id, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));
  res.sendStatus(204);
});

type NormativRow = {
  id: number;
  artikelId: number;
  vhodniArtikelId: number;
  vhodniArtikelIme: string;
  enotaMere: string | null;
  kolicina: string;
  vrstniRed: number;
};

router.get("/artikli/:id/v-normativi", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [owner] = await db.select({ id: artikliTable.id })
    .from(artikliTable)
    .where(and(eq(artikliTable.id, id), sql`true`, eq(artikliTable.enotaId, tenotaId)));
  if (!owner) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  const rows = await db
    .select({ id: artikliTable.id, ime: artikliTable.ime })
    .from(normativiTable)
    .innerJoin(artikliTable, eq(normativiTable.artikelId, artikliTable.id))
    .where(and(eq(normativiTable.vhodniArtikelId, id), sql`true`, eq(artikliTable.enotaId, tenotaId)));

  res.json(rows);
});

router.get("/artikli/:id/normativi", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [owner] = await db.select({ id: artikliTable.id })
    .from(artikliTable)
    .where(and(eq(artikliTable.id, id), sql`true`, eq(artikliTable.enotaId, tenotaId)));
  if (!owner) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  const rows = await db.execute(sql<NormativRow>`
    SELECT
      n.id,
      n.artikel_id   AS "artikelId",
      n.vhodni_artikel_id AS "vhodniArtikelId",
      COALESCE(a.ime, '')  AS "vhodniArtikelIme",
      a.enota_mere         AS "enotaMere",
      n.kolicina,
      n.vrstni_red   AS "vrstniRed"
    FROM normativi n
    LEFT JOIN artikli a ON n.vhodni_artikel_id = a.id AND a.enota_id = ${tenotaId}
    WHERE n.artikel_id = ${id}
    ORDER BY n.vrstni_red
  `);

  res.json(rows.rows.map((r) => ({
    id: r.id,
    artikelId: r.artikelId,
    vhodniArtikelId: r.vhodniArtikelId,
    vhodniArtikelIme: r.vhodniArtikelIme ?? "",
    enotaMere: r.enotaMere ?? null,
    kolicina: Number(r.kolicina),
    vrstniRed: r.vrstniRed})));
});

type NormativInput = { vhodniArtikelId: number; kolicina: number };

router.put("/artikli/:id/normativi", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [owner] = await db.select({ id: artikliTable.id })
    .from(artikliTable)
    .where(and(eq(artikliTable.id, id), sql`true`, eq(artikliTable.enotaId, tenotaId)));
  if (!owner) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  if (!Array.isArray(req.body)) { res.status(400).json({ error: "Pričakovano polje" }); return; }
  const items: NormativInput[] = (req.body as NormativInput[]).filter(
    (item) => item && typeof item.vhodniArtikelId === "number" && typeof item.kolicina === "number"
  );

  if (items.length > 0) {
    const vhodniIds = [...new Set(items.map(i => i.vhodniArtikelId))];
    const validVhodni = await db.select({ id: artikliTable.id, ime: artikliTable.ime })
      .from(artikliTable)
      .where(and(inArray(artikliTable.id, vhodniIds), sql`true`, eq(artikliTable.enotaId, tenotaId)));
    const validIds = new Set(validVhodni.map(v => v.id));
    const manjkajociIds = vhodniIds.filter((id: any) => !validIds.has(id));
    if (manjkajociIds.length > 0) {
      res.status(422).json({
        error: "Nekatere sestavine normativa so bile izbrisane ali ne obstajajo",
        manjkajoceSestavine: manjkajociIds});
      return;
    }
  }

  await db.delete(normativiTable).where(eq(normativiTable.artikelId, id));

  if (items.length > 0) {
    await db.insert(normativiTable).values(
      items.map((item, idx) => ({
        artikelId: id,
        vhodniArtikelId: item.vhodniArtikelId,
        kolicina: String(item.kolicina),
        vrstniRed: idx}))
    );
  }

  res.sendStatus(204);
});

export default router;
