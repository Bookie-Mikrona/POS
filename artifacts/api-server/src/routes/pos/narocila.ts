import { Router, type IRouter, type Request, type Response } from "express";
import { aliasedTable, and, count, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { artModSkupineTable, artikliTable, db, enoteTable, kategorijeTable, mizeTable, modSkupineTable, modifikatorjiTable, narocilaTable, nastavitveTable, postavkeTable, prenosiNarocilTable, racuniTable, zacetneZalogeTable } from "@workspace/db";
import { broadcast, broadcastTo } from "../../lib/pos-sse";
import { round2 } from "../../lib/pos-furs";
import { getSimDatumOrNow } from "../../lib/sim-datum";

function izracunajDDVNeskladje(postavke: { kolicina: number; cenaKos: number; skupaj: number; davek: number }[]): { imaNeskladje: boolean; razlika: number } {
  if (postavke.length === 0) return { imaNeskladje: false, razlika: 0 };

  const ddv = round2(postavke.reduce((acc, p) => acc + round2(p.skupaj * p.davek / (100 + p.davek)), 0));

  const vatGroups = new Map<number, number>();
  for (const p of postavke) {
    const lineTotal = round2(p.kolicina * p.cenaKos);
    const taxAmount = round2((lineTotal * p.davek) / (100 + p.davek));
    vatGroups.set(p.davek, (vatGroups.get(p.davek) ?? 0) + taxAmount);
  }
  const skupajDDVSkupin = round2(Array.from(vatGroups.values()).reduce((a, b) => a + b, 0));
  const razlika = round2(Math.abs(skupajDDVSkupin - ddv));

  return { imaNeskladje: razlika > 0.01, razlika };
}

const router: IRouter = Router();

async function fetchPostavke(narociloId: number) {
  const rows = await db
    .select({
      id: postavkeTable.id,
      artikelId: postavkeTable.artikelId,
      ime: postavkeTable.ime,
      kolicina: postavkeTable.kolicina,
      cenaKos: postavkeTable.cenaKos,
      cenaKosOriginalna: postavkeTable.cenaKosOriginalna,
      skupaj: postavkeTable.skupaj,
      davek: postavkeTable.davek,
      opomba: postavkeTable.opomba,
      kategorijaId: artikliTable.kategorijaId,
      kategorijaIme: kategorijeTable.ime,
      jePica: artikliTable.jePica,
      racunId: postavkeTable.racunId,
      racunStevilka: racuniTable.stevilkaRacuna,
      gostStevilka: postavkeTable.gostStevilka,
      parentPostavkaId: postavkeTable.parentPostavkaId,
      modifikatorId: postavkeTable.modifikatorId,
      toGo: postavkeTable.toGo,
      ustvarjeno: postavkeTable.ustvarjeno,
      pripravljeno: postavkeTable.pripravljeno})
    .from(postavkeTable)
    .leftJoin(artikliTable, eq(postavkeTable.artikelId, artikliTable.id))
    .leftJoin(kategorijeTable, eq(artikliTable.kategorijaId, kategorijeTable.id))
    .leftJoin(racuniTable, eq(postavkeTable.racunId, racuniTable.id))
    .where(eq(postavkeTable.narociloId, narociloId))
    .orderBy(desc(postavkeTable.id));

  return rows.map((p) => ({
    id: p.id,
    artikelId: p.artikelId,
    ime: p.ime,
    kolicina: p.kolicina,
    cenaKos: Number(p.cenaKos),
    cenaKosOriginalna: p.cenaKosOriginalna != null ? Number(p.cenaKosOriginalna) : null,
    skupaj: Number(p.skupaj),
    davek: Number(p.davek),
    opomba: p.opomba ?? null,
    kategorijaId: p.kategorijaId ?? null,
    kategorijaIme: p.kategorijaIme ?? null,
    jePica: p.jePica ?? false,
    racunId: p.racunId ?? null,
    racunStevilka: p.racunStevilka ?? null,
    gostStevilka: p.gostStevilka ?? null,
    parentPostavkaId: p.parentPostavkaId ?? null,
    modifikatorId: p.modifikatorId ?? null,
    toGo: p.toGo ?? false,
    ustvarjeno: p.ustvarjeno.toISOString(),
    pripravljeno: p.pripravljeno?.toISOString() ?? null}));
}

const staraMizaAlias = aliasedTable(mizeTable, "stara_miza");
const novaMizaAlias = aliasedTable(mizeTable, "nova_miza");

async function fetchPrenosi(narociloId: number) {
  const rows = await db
    .select({
      id: prenosiNarocilTable.id,
      narociloId: prenosiNarocilTable.narociloId,
      staraMizaId: prenosiNarocilTable.staraMizaId,
      staraMizaStevilka: staraMizaAlias.stevilka,
      staraMizaIme: staraMizaAlias.ime,
      novaMizaId: prenosiNarocilTable.novaMizaId,
      novaMizaStevilka: novaMizaAlias.stevilka,
      novaMizaIme: novaMizaAlias.ime,
      ustvarjeno: prenosiNarocilTable.ustvarjeno})
    .from(prenosiNarocilTable)
    .leftJoin(staraMizaAlias, eq(prenosiNarocilTable.staraMizaId, staraMizaAlias.id))
    .leftJoin(novaMizaAlias, eq(prenosiNarocilTable.novaMizaId, novaMizaAlias.id))
    .where(eq(prenosiNarocilTable.narociloId, narociloId))
    .orderBy(prenosiNarocilTable.ustvarjeno);

  return rows.map((p) => ({
    id: p.id,
    narociloId: p.narociloId,
    staraMizaId: p.staraMizaId ?? null,
    staraMizaStevilka: p.staraMizaStevilka ?? null,
    staraMizaIme: p.staraMizaIme ?? null,
    novaMizaId: p.novaMizaId ?? null,
    novaMizaStevilka: p.novaMizaStevilka ?? null,
    novaMizaIme: p.novaMizaIme ?? null,
    ustvarjeno: p.ustvarjeno}));
}

async function getNarociloById(id: number, _davcna: string, tenotaId: number) {
  const [narocilo] = await db
    .select({
      id: narocilaTable.id,
      stevilkaNarocila: narocilaTable.stevilkaNarocila,
      mizaId: narocilaTable.mizaId,
      mizaStevilka: mizeTable.stevilka,
      mizaIme: mizeTable.ime,
      status: narocilaTable.status,
      skupaj: narocilaTable.skupaj,
      opomba: narocilaTable.opomba,
      ustvarjeno: narocilaTable.ustvarjeno,
      posodobljeno: narocilaTable.posodobljeno})
    .from(narocilaTable)
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(and(eq(narocilaTable.id, id), sql`true`, eq(narocilaTable.enotaId, tenotaId)));

  if (!narocilo) return null;

  const postavke = await fetchPostavke(id);
  const prenosi = await fetchPrenosi(id);

  const ddvNeskladje = izracunajDDVNeskladje(postavke);

  return {
    ...narocilo,
    skupaj: Number(narocilo.skupaj),
    mizaStevilka: narocilo.mizaStevilka ?? null,
    mizaIme: narocilo.mizaIme ?? null,
    opomba: narocilo.opomba ?? null,
    posodobljeno: narocilo.posodobljeno ?? null,
    postavke,
    prenosi,
    ddvNeskladje: ddvNeskladje.imaNeskladje ? ddvNeskladje : null};
}

async function updateSkupaj(narociloId: number) {
  const postavke = await db.select().from(postavkeTable).where(eq(postavkeTable.narociloId, narociloId));
  const skupaj = postavke.reduce((acc, p) => acc + Number(p.skupaj), 0);
  await db.update(narocilaTable).set({ skupaj: String(skupaj.toFixed(2)) }).where(eq(narocilaTable.id, narociloId));
}

router.get("/narocila/aktivna", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db
    .select({
      id: narocilaTable.id,
      stevilkaNarocila: narocilaTable.stevilkaNarocila,
      mizaId: narocilaTable.mizaId,
      mizaStevilka: mizeTable.stevilka,
      mizaIme: mizeTable.ime,
      status: narocilaTable.status,
      skupaj: narocilaTable.skupaj,
      opomba: narocilaTable.opomba,
      ustvarjeno: narocilaTable.ustvarjeno,
      posodobljeno: narocilaTable.posodobljeno})
    .from(narocilaTable)
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(and(eq(narocilaTable.status, "odprto"), sql`true`, eq(narocilaTable.enotaId, tenotaId)))
    .orderBy(narocilaTable.ustvarjeno);

  const result = await Promise.all(
    rows.map(async (n) => {
      const postavke = await fetchPostavke(n.id);
      const ddvNeskladje = izracunajDDVNeskladje(postavke);
      return {
        ...n,
        skupaj: Number(n.skupaj),
        mizaStevilka: n.mizaStevilka ?? null,
        mizaIme: n.mizaIme ?? null,
        opomba: n.opomba ?? null,
        posodobljeno: n.posodobljeno ?? null,
        postavke,
        ddvNeskladje: ddvNeskladje.imaNeskladje ? ddvNeskladje : null};
    })
  );

  res.json(result);
});

router.get("/narocila", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const query = { success: true as const, data: req.query };
  if (!query.success) { res.status(400).json({ error: (query as any).error.message }); return; }

  const conditions: ReturnType<typeof eq>[] = [sql`true`, eq(narocilaTable.enotaId, tenotaId)];
  if (query.data.status != null) conditions.push(eq(narocilaTable.status, query.data.status as "odprto" | "zakljuceno" | "preklicano"));
  if (query.data.mizaId != null) conditions.push(eq(narocilaTable.mizaId, Number(query.data.mizaId)));

  const rows = await db
    .select({
      id: narocilaTable.id,
      stevilkaNarocila: narocilaTable.stevilkaNarocila,
      mizaId: narocilaTable.mizaId,
      mizaStevilka: mizeTable.stevilka,
      mizaIme: mizeTable.ime,
      status: narocilaTable.status,
      skupaj: narocilaTable.skupaj,
      opomba: narocilaTable.opomba,
      ustvarjeno: narocilaTable.ustvarjeno,
      posodobljeno: narocilaTable.posodobljeno})
    .from(narocilaTable)
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(and(...conditions))
    .orderBy(narocilaTable.ustvarjeno);

  const result = await Promise.all(
    rows.map(async (n) => {
      return {
        ...n,
        skupaj: Number(n.skupaj),
        mizaStevilka: n.mizaStevilka ?? null,
        mizaIme: n.mizaIme ?? null,
        opomba: n.opomba ?? null,
        posodobljeno: n.posodobljeno ?? null,
        postavke: await fetchPostavke(n.id)};
    })
  );

  res.json(result);
});

router.post("/narocila", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const currentYear = new Date().getFullYear();
  const [nabavniArtikel] = await db.select({ id: artikliTable.id })
    .from(artikliTable)
    .where(and(eq(artikliTable.enotaId, tenotaId), eq(artikliTable.nabavniArtikel, true)));
  if (nabavniArtikel) {
    const [zz] = await db.select({ id: zacetneZalogeTable.id })
      .from(zacetneZalogeTable)
      .where(and(eq(zacetneZalogeTable.leto, currentYear), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));
    if (!zz) {
      res.status(400).json({
        error: `Pred prvim naročilom v letu ${currentYear} morate najprej vnesti začetne zaloge.`,
        code: "MISSING_ZACETNE_ZALOGE",
        leto: currentYear});
      return;
    }
  }

  if (parsed.data.mizaId != null) {
    const [miza] = await db.select({ id: mizeTable.id })
      .from(mizeTable)
      .where(and(eq(mizeTable.id, parsed.data.mizaId), sql`true`, eq(mizeTable.enotaId, tenotaId)));
    if (!miza) { res.status(404).json({ error: "Miza ni najdena" }); return; }
  }

  const companyId = (req as any).companyId as string;
  const simDatumNarocilo = await getSimDatumOrNow(tenotaId);

  const [row] = await db.insert(narocilaTable).values({
    enotaId: tenotaId,
    mizaId: parsed.data.mizaId ?? null,
    opomba: parsed.data.opomba ?? null,
    status: "odprto",
    skupaj: "0",
    ustvarjeno: simDatumNarocilo,
  }).returning();

  // Nastavi stevilka_narocila z raw SQL — Drizzle schema morda nima stolpca v runtime
  await db.execute(sql`
    UPDATE narocila
    SET stevilka_narocila = (
      SELECT COALESCE(MAX(n2.stevilka_narocila), 0) + 1
      FROM narocila n2
      JOIN enote e ON e.id = n2.enota_id
      WHERE e.company_id = ${companyId}
        AND n2.id != ${row.id}
    )
    WHERE id = ${row.id}
  `);

  if (parsed.data.mizaId != null) {
    await db.update(mizeTable).set({ status: "zasedena" }).where(eq(mizeTable.id, parsed.data.mizaId));
  }

  const narocilo = await getNarociloById(row.id, "", tenotaId);
  broadcast("update", { type: "narocilo" });
  res.status(201).json(narocilo);
});

router.get("/narocila/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const narocilo = await getNarociloById(params.data.id, "", tenotaId);
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  res.json(narocilo);
});

router.put("/narocila/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const [obstojeceNarocilo] = await db.select().from(narocilaTable)
    .where(and(eq(narocilaTable.id, params.data.id), sql`true`, eq(narocilaTable.enotaId, tenotaId)));
  if (!obstojeceNarocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }

  const updateData: Partial<typeof narocilaTable.$inferInsert> = {};
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status as "odprto" | "zakljuceno" | "preklicano";
  if (parsed.data.opomba !== undefined) updateData.opomba = parsed.data.opomba;

  const novaMizaId = (parsed.data as { mizaId?: number | null }).mizaId;
  const menjavaMize = novaMizaId !== undefined && novaMizaId !== obstojeceNarocilo.mizaId;

  if (menjavaMize) {
    if (novaMizaId != null) {
      const [novaMiza] = await db.select({ id: mizeTable.id })
        .from(mizeTable)
        .where(and(eq(mizeTable.id, novaMizaId), sql`true`, eq(mizeTable.enotaId, tenotaId)));
      if (!novaMiza) { res.status(404).json({ error: "Nova miza ni najdena" }); return; }
    }
    updateData.mizaId = novaMizaId ?? null;
  }

  await db.update(narocilaTable).set(updateData)
    .where(and(eq(narocilaTable.id, params.data.id), sql`true`, eq(narocilaTable.enotaId, tenotaId)));

  if (parsed.data.status === "zakljuceno" || parsed.data.status === "preklicano") {
    const mizaZaPreveritev = obstojeceNarocilo.mizaId;
    if (mizaZaPreveritev != null) {
      const activeCount = await db.select().from(narocilaTable)
        .where(and(eq(narocilaTable.mizaId, mizaZaPreveritev), eq(narocilaTable.status, "odprto"), sql`true`, eq(narocilaTable.enotaId, tenotaId)));
      if (activeCount.length === 0) {
        await db.update(mizeTable).set({ status: "prosta" }).where(eq(mizeTable.id, mizaZaPreveritev));
      }
    }
  }

  if (menjavaMize) {
    const staraMizaId = obstojeceNarocilo.mizaId;
    if (staraMizaId != null) {
      const activeOnOld = await db.select().from(narocilaTable)
        .where(and(eq(narocilaTable.mizaId, staraMizaId), eq(narocilaTable.status, "odprto"), sql`true`, eq(narocilaTable.enotaId, tenotaId)));
      if (activeOnOld.length === 0) {
        await db.update(mizeTable).set({ status: "prosta" }).where(eq(mizeTable.id, staraMizaId));
      }
    }
    if (novaMizaId != null) {
      await db.update(mizeTable).set({ status: "zasedena" }).where(eq(mizeTable.id, novaMizaId));
    }
    await db.insert(prenosiNarocilTable).values({
      narociloId: params.data.id,
      enotaId: tenotaId,
      staraMizaId: obstojeceNarocilo.mizaId ?? null,
      novaMizaId: novaMizaId ?? null});
  }

  const narocilo = await getNarociloById(params.data.id, "", tenotaId);
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  broadcast("update", { type: "narocilo", id: params.data.id });
  res.json(narocilo);
});

router.delete("/narocila/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  await db.delete(narocilaTable)
    .where(and(eq(narocilaTable.id, params.data.id), sql`true`, eq(narocilaTable.enotaId, tenotaId)));
  broadcast("update", { type: "narocilo" });
  res.sendStatus(204);
});

router.post("/narocila/:id/spoji", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const ciljId = params.data.id;
  const virId = parsed.data.virNarociloId;

  if (ciljId === virId) { res.status(400).json({ error: "Ciljno in izvorno naročilo sta enaki" }); return; }

  const [cilj] = await db.select().from(narocilaTable)
    .where(and(eq(narocilaTable.id, ciljId), sql`true`, eq(narocilaTable.enotaId, tenotaId)));
  if (!cilj) { res.status(404).json({ error: "Ciljno naročilo ni najdeno" }); return; }
  if (cilj.status !== "odprto") { res.status(400).json({ error: "Ciljno naročilo ni odprto" }); return; }

  const [vir] = await db.select().from(narocilaTable)
    .where(and(eq(narocilaTable.id, virId), sql`true`, eq(narocilaTable.enotaId, tenotaId)));
  if (!vir) { res.status(404).json({ error: "Izvorno naročilo ni najdeno" }); return; }
  if (vir.status !== "odprto") { res.status(400).json({ error: "Izvorno naročilo ni odprto" }); return; }

  if (cilj.mizaId == null || vir.mizaId == null || cilj.mizaId !== vir.mizaId) {
    res.status(400).json({ error: "Naročili nista za isto mizo" }); return;
  }

  // Atomiška transakcija: prenos + recalc + brisanje/zapiranje
  await db.transaction(async (tx) => {
    // Prestavi neračunane postavke iz virNarociloId → ciljId
    await tx.update(postavkeTable)
      .set({ narociloId: ciljId })
      .where(and(eq(postavkeTable.narociloId, virId), isNull(postavkeTable.racunId)));

    // Posodobi skupaj ciljnega naročila
    const ciljPostavke = await tx.select().from(postavkeTable).where(eq(postavkeTable.narociloId, ciljId));
    const ciljSkupaj = ciljPostavke.reduce((acc, p) => acc + Number(p.skupaj), 0);
    await tx.update(narocilaTable).set({ skupaj: String(ciljSkupaj.toFixed(2)) }).where(eq(narocilaTable.id, ciljId));

    // Preveri, ali ima vir preostale zaračunane postavke
    const virPreostale = await tx.select({ id: postavkeTable.id }).from(postavkeTable)
      .where(eq(postavkeTable.narociloId, virId));
    if (virPreostale.length === 0) {
      // Ni več postavk → zbriši izvorno naročilo
      await tx.delete(narocilaTable).where(eq(narocilaTable.id, virId));
    } else {
      // Ima zaračunane postavke → posodobi skupaj vira in ga zapri
      const virSkupaj = await tx.select().from(postavkeTable).where(eq(postavkeTable.narociloId, virId));
      const virTotal = virSkupaj.reduce((acc, p) => acc + Number(p.skupaj), 0);
      await tx.update(narocilaTable)
        .set({ skupaj: String(virTotal.toFixed(2)), status: "zakljuceno" })
        .where(eq(narocilaTable.id, virId));
    }
  });

  const narocilo = await getNarociloById(ciljId, "", tenotaId);
  broadcast("update", { type: "narocilo" });
  res.json(narocilo);
});

router.post("/narocila/:id/postavke", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = { success: true as const, data: { id: Number(rawId) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const [artikel] = await db.select().from(artikliTable)
    .where(and(eq(artikliTable.id, parsed.data.artikelId), sql`true`, eq(artikliTable.enotaId, tenotaId)));
  if (!artikel) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  const narociloCheck = await getNarociloById(params.data.id, "", tenotaId);
  if (!narociloCheck) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  if (narociloCheck.status !== "odprto") { res.status(409).json({ error: "Naročilo ni odprto" }); return; }

  // Happy Hour cena — preveri ali je HH aktiven in artikel ima HH ceno
  const originalCena = Number(artikel.cena);
  let cenaKos = originalCena;
  let jeHappyHourCena = false;
  if (artikel.happyHourCena != null) {
    const hhRows = await db.select({ kljuc: nastavitveTable.kljuc, vrednost: nastavitveTable.vrednost })
      .from(nastavitveTable).where(and(eq(nastavitveTable.enotaId, tenotaId)));
    const hhMap: Record<string, string> = {};
    for (const r of hhRows) hhMap[r.kljuc] = r.vrednost;
    const hhOd = hhMap["happyHourOd"] ?? "";
    const hhDo = hhMap["happyHourDo"] ?? "";
    const hhRocno = hhMap["happyHourRocnoAktiven"] ?? "auto";
    const isHHActive = (() => {
      if (hhRocno === "on") return true;
      if (hhRocno === "off") return false;
      if (!hhOd || !hhDo) return false;
      const now = new Date();
      const lj = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Ljubljana" }));
      const cur = lj.getHours() * 60 + lj.getMinutes();
      const [oh, om] = hhOd.split(":").map(Number);
      const [dh, dm] = hhDo.split(":").map(Number);
      const start = (oh ?? 0) * 60 + (om ?? 0), end = (dh ?? 0) * 60 + (dm ?? 0);
      return end > start ? cur >= start && cur < end : cur >= start || cur < end;
    })();
    if (isHHActive) { cenaKos = Number(artikel.happyHourCena); jeHappyHourCena = true; }
  }
  const kolicina = parsed.data.kolicina;
  const skupaj = round2(cenaKos * kolicina);
  const gostStevilka = (parsed.data as { gostStevilka?: number | null }).gostStevilka ?? null;
  const parentPostavkaId = (parsed.data as { parentPostavkaId?: number | null }).parentPostavkaId ?? null;

  // DDV zavezanec — ko podjetje ni DDV zavezanec (id_za_ddv ne začne s "SI"), je davek vedno 0.
  const jeDdvZavezanec: boolean = (req as any).jeDdvZavezanec ?? true;

  // DDV dedovanje: ko je postavka child (npr. To Go embalaža pod pico), prevzame DDV stopnjo
  // nadrejene postavke (PZDDV — pomožna dobava sledi DDV stopnji glavne dobave).
  // vrsta_artikla dedovanje: child prevzame vrsto starševskega artikla (blago → blago, material → material).
  let davekZaPostavko = jeDdvZavezanec ? String(artikel.davek) : "0";
  let vrstaArtiklaZaPostavko: string = artikel.vrstaArtikla ?? "material";
  if (parentPostavkaId != null) {
    const [parentPostavka] = await db.select({ davek: postavkeTable.davek, vrstaArtikla: postavkeTable.vrstaArtikla })
      .from(postavkeTable)
      .where(eq(postavkeTable.id, parentPostavkaId));
    if (parentPostavka) {
      davekZaPostavko = jeDdvZavezanec ? String(parentPostavka.davek) : "0";
      if (parentPostavka.vrstaArtikla) vrstaArtiklaZaPostavko = parentPostavka.vrstaArtikla;
    }
  }

  // Pre-transaction: validate modifier selections and resolve authoritative DB values
  const izbranModifikatorjiRaw = (parsed.data as { izbranModifikatorji?: Array<{ modifikatorId: number }> }).izbranModifikatorji ?? [];
  type ResolvedMod = { skupinaId: number; id: number; ime: string; cenaDodatek: number };
  let resolvedMods: ResolvedMod[] = [];

  if (!parentPostavkaId) {
    // Load article's assigned modifier groups (tenant-scoped)
    const vezave = await db
      .select({
        skupinaId: artModSkupineTable.skupinaId,
        obvezna: modSkupineTable.obvezna,
        minIzbir: modSkupineTable.minIzbir,
        maxIzbir: modSkupineTable.maxIzbir})
      .from(artModSkupineTable)
      .innerJoin(modSkupineTable, eq(artModSkupineTable.skupinaId, modSkupineTable.id))
      .where(
        and(
          eq(artModSkupineTable.artikelId, parsed.data.artikelId),
          sql`true`,
          eq(modSkupineTable.enotaId, tenotaId),
        ),
      );

    if (vezave.length > 0 || izbranModifikatorjiRaw.length > 0) {
      const skupinaIds = vezave.map((v) => v.skupinaId);
      const allMods = skupinaIds.length > 0
        ? await db
            .select()
            .from(modifikatorjiTable)
            .where(
              and(
                inArray(modifikatorjiTable.skupinaId, skupinaIds),
                eq(modifikatorjiTable.aktiven, true),
              ),
            )
        : [];
      const modMap = new Map(allMods.map((m) => [m.id, m]));

      // Resolve each requested modifikatorId from DB — reject unknown/foreign/inactive IDs
      for (const req of izbranModifikatorjiRaw) {
        const mod = modMap.get(req.modifikatorId);
        if (!mod) {
          res.status(400).json({ napaka: `Modifikator ${req.modifikatorId} ni veljaven, ni aktiven ali ne pripada temu artiklu` });
          return;
        }
        resolvedMods.push({ skupinaId: mod.skupinaId, id: mod.id, ime: mod.ime, cenaDodatek: Number(mod.cenaDodatek) });
      }

      // Validate group constraints — runs even when izbranModifikatorjiRaw is empty (required groups)
      const selectedBySkupina = new Map<number, number>();
      for (const m of resolvedMods) {
        selectedBySkupina.set(m.skupinaId, (selectedBySkupina.get(m.skupinaId) ?? 0) + 1);
      }
      for (const v of vezave) {
        const count = selectedBySkupina.get(v.skupinaId) ?? 0;
        // obvezna skupin: vsaj max(1, minIzbir)
        const minRequired = v.obvezna ? Math.max(1, v.minIzbir) : v.minIzbir;
        if (count < minRequired) {
          res.status(400).json({ napaka: `Skupina ${v.skupinaId}: obvezno je izbrati vsaj ${minRequired} modifikator(jev), izbrano: ${count}` });
          return;
        }
        if (v.maxIzbir > 0 && count > v.maxIzbir) {
          res.status(400).json({ napaka: `Skupina ${v.skupinaId}: izbrali ste preveč modifikatorjev (maks ${v.maxIzbir}), izbrano: ${count}` });
          return;
        }
      }
    }
  }

  const napravaIdHeader = req.headers["x-naprava-id"];
  const napravaId = typeof napravaIdHeader === "string" ? napravaIdHeader : null;

  await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(postavkeTable).values({
      narociloId: params.data.id,
      artikelId: artikel.id,
      ime: artikel.ime,
      kolicina,
      cenaKos: String(cenaKos),
      cenaKosOriginalna: String(originalCena),
      skupaj: String(skupaj.toFixed(2)),
      davek: davekZaPostavko,
      opomba: parsed.data.opomba ?? null,
      gostStevilka,
      parentPostavkaId,
      vrstaArtikla: vrstaArtiklaZaPostavko,
      napravaId}).returning({ id: postavkeTable.id });

    // Insert modifier child rows using pre-validated authoritative DB values
    for (const mod of resolvedMods) {
      const cenaMod = round2(mod.cenaDodatek);
      await tx.insert(postavkeTable).values({
        narociloId: params.data.id,
        artikelId: null,
        modifikatorId: mod.id,
        ime: mod.ime,
        kolicina: 1,
        cenaKos: String(cenaMod.toFixed(2)),
        cenaKosOriginalna: String(cenaMod.toFixed(2)),
        skupaj: String(cenaMod.toFixed(2)),
        davek: jeDdvZavezanec ? String(artikel.davek) : "0",
        opomba: null,
        gostStevilka,
        vrstaArtikla: vrstaArtiklaZaPostavko,
        parentPostavkaId: inserted.id});
    }

  });

  await updateSkupaj(params.data.id);

  const narocilo = await getNarociloById(params.data.id, "", tenotaId);
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  broadcast("update", { type: "narocilo", id: params.data.id });
  res.status(201).json(narocilo);
});

router.patch("/narocila/:id/postavke/:postavkaId", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawPostavkaId = Array.isArray(req.params.postavkaId) ? req.params.postavkaId[0] : req.params.postavkaId;
  const params = { success: true as const, data: { id: Number(rawId), postavkaId: Number(rawPostavkaId) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const narociloCheck = await getNarociloById(params.data.id, "", tenotaId);
  if (!narociloCheck) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }

  const [postavka] = await db.select().from(postavkeTable)
    .where(and(eq(postavkeTable.id, params.data.postavkaId), eq(postavkeTable.narociloId, params.data.id)));
  if (!postavka) { res.status(404).json({ error: "Postavka ni najdena" }); return; }

  if (postavka.racunId != null) {
    res.status(409).json({ error: "Postavke ni mogoče urejati — že je pokrita z računom." });
    return;
  }

  const staraKolicina = Number(postavka.kolicina);
  const novaKolicina = parsed.data.kolicina;
  const novaCenaKos = parsed.data.cenaKos != null ? parsed.data.cenaKos : Number(postavka.cenaKos);
  const novaSkupaj = round2(novaCenaKos * novaKolicina);

  const updateSet: Partial<typeof postavkeTable.$inferInsert> = {
    kolicina: novaKolicina,
    skupaj: String(novaSkupaj.toFixed(2))};
  if (parsed.data.cenaKos != null) {
    updateSet.cenaKos = String(parsed.data.cenaKos.toFixed(2));
  }
  const parsedGost = (parsed.data as { gostStevilka?: number | null }).gostStevilka;
  if (parsedGost !== undefined) {
    updateSet.gostStevilka = parsedGost;
  }
  const parsedOpomba = (parsed.data as { opomba?: string | null }).opomba;
  if (parsedOpomba !== undefined) {
    updateSet.opomba = parsedOpomba;
  }
  const parsedToGo = (parsed.data as { toGo?: boolean }).toGo;
  if (parsedToGo !== undefined) {
    updateSet.toGo = parsedToGo;
  }

  await db.update(postavkeTable)
    .set(updateSet)
    .where(eq(postavkeTable.id, params.data.postavkaId));

  // Proporcionalno posodobi zaračunljive otroke (npr. med pri čaju)
  // Razmerje otrokove količine se ohrani glede na staro kolicino starša.
  if (staraKolicina !== novaKolicina) {
    const otroci = await db.select({
      id: postavkeTable.id,
      kolicina: postavkeTable.kolicina,
      cenaKos: postavkeTable.cenaKos,
      skupaj: postavkeTable.skupaj,
    }).from(postavkeTable).where(
      and(
        eq(postavkeTable.parentPostavkaId, params.data.postavkaId),
        eq(postavkeTable.narociloId, params.data.id)
      )
    );
    for (const otrok of otroci) {
      const otrokStaraKol = Number(otrok.kolicina);
      // nova kolicina = ohrani razmerje; zaokroži na celo število (min 1 če je bil > 0)
      const novaKolOtrok = staraKolicina > 0
        ? Math.max(1, Math.round(otrokStaraKol / staraKolicina * novaKolicina))
        : novaKolicina;
      const otrokCenaKos = Number(otrok.cenaKos);
      const otrokNovaSkupaj = round2(otrokCenaKos * novaKolOtrok);
      await db.update(postavkeTable)
        .set({ kolicina: novaKolOtrok, skupaj: String(otrokNovaSkupaj.toFixed(2)) })
        .where(eq(postavkeTable.id, otrok.id));
    }
  }

  await updateSkupaj(params.data.id);

  const narocilo = await getNarociloById(params.data.id, "", tenotaId);
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  broadcast("update", { type: "narocilo", id: params.data.id });
  res.json(narocilo);
});

router.delete("/narocila/:id/postavke/:postavkaId", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawPostavkaId = Array.isArray(req.params.postavkaId) ? req.params.postavkaId[0] : req.params.postavkaId;
  const params = { success: true as const, data: { id: Number(rawId), postavkaId: Number(rawPostavkaId) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }

  const narociloCheck = await getNarociloById(params.data.id, "", tenotaId);
  if (!narociloCheck) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }

  const [postavkaCheck] = await db.select().from(postavkeTable)
    .where(and(eq(postavkeTable.id, params.data.postavkaId), eq(postavkeTable.narociloId, params.data.id)));
  if (!postavkaCheck) { res.status(404).json({ error: "Postavka ni najdena" }); return; }

  if (postavkaCheck.racunId != null) {
    res.status(409).json({ error: "Postavke ni mogoče izbrisati — že je pokrita z računom." });
    return;
  }

  // Izbriši modifier otroke pred staršem (kaskada)
  await db.delete(postavkeTable).where(
    and(eq(postavkeTable.parentPostavkaId, params.data.postavkaId), eq(postavkeTable.narociloId, params.data.id))
  );
  await db.delete(postavkeTable).where(
    and(eq(postavkeTable.id, params.data.postavkaId), eq(postavkeTable.narociloId, params.data.id))
  );

  await updateSkupaj(params.data.id);

  const narocilo = await getNarociloById(params.data.id, "", tenotaId);
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  broadcast("update", { type: "narocilo", id: params.data.id });
  res.json(narocilo);
});

router.patch("/narocila/:id/postavke/:postavkaId/pripravljeno", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawPostavkaId = Array.isArray(req.params.postavkaId) ? req.params.postavkaId[0] : req.params.postavkaId;
  const params = { success: true as const, data: { id: Number(rawId), postavkaId: Number(rawPostavkaId) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const [postavka] = await db.select({
    id: postavkeTable.id,
    narociloId: postavkeTable.narociloId,
    ime: postavkeTable.ime,
    kolicina: postavkeTable.kolicina,
    opomba: postavkeTable.opomba,
    mizaId: narocilaTable.mizaId,
    napravaId: postavkeTable.napravaId})
    .from(postavkeTable)
    .leftJoin(narocilaTable, eq(postavkeTable.narociloId, narocilaTable.id))
    .where(and(eq(postavkeTable.id, params.data.postavkaId), eq(postavkeTable.narociloId, params.data.id)));
  if (!postavka) { res.status(404).json({ error: "Postavka ni najdena" }); return; }

  let mizaIme: string | null = null;
  let mizaStevilka: number | null = null;
  if (postavka.mizaId) {
    const [miza] = await db.select({ ime: mizeTable.ime, stevilka: mizeTable.stevilka })
      .from(mizeTable).where(eq(mizeTable.id, postavka.mizaId));
    mizaIme = miza?.ime ?? null;
    mizaStevilka = miza?.stevilka ?? null;
  }

  const novoPripravljeno = parsed.data.pripravljeno ? new Date() : null;
  await db.update(postavkeTable)
    .set({ pripravljeno: novoPripravljeno })
    .where(eq(postavkeTable.id, params.data.postavkaId));

  if (parsed.data.pripravljeno) {
    const payload = {
      postavkaId: postavka.id,
      narociloId: postavka.narociloId,
      ime: postavka.ime,
      kolicina: postavka.kolicina,
      opomba: postavka.opomba ?? null,
      mizaIme,
      mizaStevilka,
      vir: parsed.data.vir ?? null};
    if (postavka.napravaId) {
      broadcastTo(postavka.napravaId, "postavkaPripravljena", payload);
    } else {
      broadcast("postavkaPripravljena", payload);
    }
  }
  broadcast("update", { type: "narocilo", id: params.data.id });
  res.json({ ok: true });
});

router.post("/narocila/:id/postavke/:postavkaId/modifikatorji", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawPostavkaId = Array.isArray(req.params.postavkaId) ? req.params.postavkaId[0] : req.params.postavkaId;
  const params = { success: true as const, data: { id: Number(rawId), postavkaId: Number(rawPostavkaId) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const narociloCheck = await getNarociloById(params.data.id, "", tenotaId);
  if (!narociloCheck) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }

  const [parentPostavka] = await db.select().from(postavkeTable)
    .where(and(eq(postavkeTable.id, params.data.postavkaId), eq(postavkeTable.narociloId, params.data.id)));
  if (!parentPostavka) { res.status(404).json({ error: "Postavka ni najdena" }); return; }
  if (parentPostavka.racunId != null) { res.status(409).json({ error: "Postavke ni mogoče urejati — že je pokrita z računom." }); return; }
  if (parentPostavka.artikelId == null) { res.status(400).json({ error: "Ta postavka ne more imeti modifikatorjev (nima artikla)." }); return; }

  // Resolve modifikatorji — only allow modifikatorji from groups assigned to this artikel
  const skupineVezave = await db
    .select({ skupinaId: artModSkupineTable.skupinaId })
    .from(artModSkupineTable)
    .innerJoin(modSkupineTable, eq(artModSkupineTable.skupinaId, modSkupineTable.id))
    .where(and(
      eq(artModSkupineTable.artikelId, parentPostavka.artikelId),
      sql`true`,
      eq(modSkupineTable.enotaId, tenotaId),
    ));
  const skupinaIds = skupineVezave.map((v) => v.skupinaId);
  if (skupinaIds.length === 0) {
    res.status(400).json({ error: "Ta artikel nima modifikatorskih skupin." });
    return;
  }
  if (parsed.data.modifikatorji.length === 0 && (!parsed.data.skupineIds || parsed.data.skupineIds.length === 0)) {
    res.status(400).json({ error: "Seznam modifikatorjev je prazen in ni podanih skupin za brisanje." });
    return;
  }

  const allMods = await db.select().from(modifikatorjiTable)
    .where(and(inArray(modifikatorjiTable.skupinaId, skupinaIds), eq(modifikatorjiTable.aktiven, true)));
  const modMap = new Map(allMods.map((m) => [m.id, m]));

  // Load skupin details for min/maxIzbir validation
  const skupineDetails = await db.select().from(modSkupineTable).where(inArray(modSkupineTable.id, skupinaIds));
  const skupinaMap = new Map(skupineDetails.map((s) => [s.id, s]));

  // Check for duplicate modifikatorId entries in the request
  const reqIds = parsed.data.modifikatorji.map((r: any) => r.modifikatorId);
  if (new Set(reqIds).size !== reqIds.length) {
    res.status(400).json({ error: "Podvojeni modifikatorji v zahtevku." });
    return;
  }

  // Resolve modifiers and group by skupinaId for min/maxIzbir checks
  type ResolvedMod = { id: number; ime: string; cenaDodatek: number; davek: string };
  const resolvedMods: ResolvedMod[] = [];
  const bySkupina = new Map<number, number>();
  for (const req2 of parsed.data.modifikatorji) {
    const mod = modMap.get(req2.modifikatorId);
    if (!mod) {
      res.status(400).json({ error: `Modifikator ${req2.modifikatorId} ni veljaven, ni aktiven ali ne pripada temu artiklu` });
      return;
    }
    bySkupina.set(mod.skupinaId, (bySkupina.get(mod.skupinaId) ?? 0) + 1);
    resolvedMods.push({ id: mod.id, ime: mod.ime, cenaDodatek: Number(mod.cenaDodatek), davek: parentPostavka.davek });
  }

  // Validate maxIzbir per skupin (within the request payload itself)
  for (const [skupinaId, count] of bySkupina) {
    const sk = skupinaMap.get(skupinaId);
    if (sk && Number(sk.maxIzbir) > 0 && count > Number(sk.maxIzbir)) {
      res.status(400).json({ error: `Preveč modifikatorjev za skupino "${sk.ime}": dovoljeno ${sk.maxIzbir}, posredovano ${count}.` });
      return;
    }
  }

  const gostStevilka = (parentPostavka as typeof parentPostavka & { gostStevilka?: number | null }).gostStevilka ?? null;

  // Replace semantics: for each skupinaId in scope (from skupineIds param or inferred from request),
  // delete existing child modifier rows for that skupinaId, then insert the new selection.
  // skupineIds param allows clearing all selections for a group (empty modifikatorji).
  const requestedSkupineIds = parsed.data.skupineIds?.length
    ? parsed.data.skupineIds.filter((sid: any) => skupinaIds.includes(sid))
    : Array.from(bySkupina.keys());
  const existingChildMods = requestedSkupineIds.length > 0
    ? await db.select({ id: postavkeTable.id, modifikatorId: postavkeTable.modifikatorId })
        .from(postavkeTable)
        .where(and(
          eq(postavkeTable.parentPostavkaId, params.data.postavkaId),
          isNull(postavkeTable.artikelId),
        ))
    : [];
  // Only delete child rows that belong to skupinaIds in scope
  const existingToDelete = existingChildMods
    .filter(r => r.modifikatorId != null && requestedSkupineIds.includes(modMap.get(r.modifikatorId!)?.skupinaId ?? -1))
    .map((r: any) => r.id);

  await db.transaction(async (tx) => {
    if (existingToDelete.length > 0) {
      await tx.delete(postavkeTable).where(inArray(postavkeTable.id, existingToDelete));
    }
    for (const mod of resolvedMods) {
      const cenaMod = round2(mod.cenaDodatek);
      await tx.insert(postavkeTable).values({
        narociloId: params.data.id,
        artikelId: null,
        modifikatorId: mod.id,
        ime: mod.ime,
        kolicina: 1,
        cenaKos: String(cenaMod.toFixed(2)),
        cenaKosOriginalna: String(cenaMod.toFixed(2)),
        skupaj: String(cenaMod.toFixed(2)),
        davek: mod.davek,
        opomba: null,
        gostStevilka,
        parentPostavkaId: params.data.postavkaId});
    }
  });

  await updateSkupaj(params.data.id);
  const narocilo = await getNarociloById(params.data.id, "", tenotaId);
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  broadcast("update", { type: "narocilo", id: params.data.id });
  res.status(201).json(narocilo);
});

export default router;
