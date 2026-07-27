import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { artikliTable, db, zacetneZalogePostavkeTable, zacetneZalogeTable, zalogaGibiTable, zalogeTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { broadcast } from "../../lib/pos-sse";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";

const router: IRouter = Router();

router.get("/zacetne-zaloge", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db
    .select({
      id: zacetneZalogeTable.id,
      leto: zacetneZalogeTable.leto,
      stevilka: zacetneZalogeTable.stevilka,
      datum: zacetneZalogeTable.datum,
      opomba: zacetneZalogeTable.opomba,
      ustvarjeno: zacetneZalogeTable.ustvarjeno,
      steviloPostavk: count(zacetneZalogePostavkeTable.id)})
    .from(zacetneZalogeTable)
    .leftJoin(zacetneZalogePostavkeTable, eq(zacetneZalogePostavkeTable.zacetnaZalogaId, zacetneZalogeTable.id))
    .where(and(eq(zacetneZalogeTable.enotaId, tenotaId)))
    .groupBy(zacetneZalogeTable.id)
    .orderBy(desc(zacetneZalogeTable.leto));

  res.json(rows.map(r => ({ ...r, steviloPostavk: Number(r.steviloPostavk) })));
});

router.post("/zacetne-zaloge", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const { leto, datum, opomba, postavke } = parsed.data;

  const [existing] = await db.select({ id: zacetneZalogeTable.id })
    .from(zacetneZalogeTable)
    .where(and(eq(zacetneZalogeTable.leto, leto), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));
  if (existing) {
    res.status(409).json({ error: `Začetne zaloge za leto ${leto} že obstajajo` }); return;
  }

  const yy = String(leto).slice(-2);
  const stevilka = `${yy}000001`;

  const artikelIds = postavke.map((p: any) => p.artikelId);
  const [currentZaloge, artikliRows] = await Promise.all([
    db.select({ artikelId: zalogeTable.artikelId, kolicina: zalogeTable.kolicina })
      .from(zalogeTable).where(inArray(zalogeTable.artikelId, artikelIds)),
    db.select({ id: artikliTable.id, ime: artikliTable.ime, imeZaNabavo: artikliTable.imeZaNabavo, enotaMere: artikliTable.enotaMere })
      .from(artikliTable).where(and(inArray(artikliTable.id, artikelIds), sql`true`, eq(artikliTable.enotaId, tenotaId))),
  ]);
  const foundZzIds = new Set(artikliRows.map(a => a.id));
  const missingZzIds = artikelIds.filter((id: any) => !foundZzIds.has(id));
  if (missingZzIds.length > 0) {
    res.status(403).json({ error: "Nekateri artikli ne pripadajo temu podjetju" }); return;
  }
  const zalogeMap = new Map(currentZaloge.map(z => [z.artikelId, Number(z.kolicina)]));
  const artikelMap = new Map(artikliRows.map(a => [a.id, a]));

  const { zacetnaZaloga, postavkeResult } = await db.transaction(async (tx) => {
    const [zacetnaZaloga] = await tx.insert(zacetneZalogeTable).values({
      enotaId: tenotaId,
      leto,
      stevilka,
      datum: datum ? new Date(datum) : new Date(),
      opomba: opomba ?? null}).returning();

    const postavkeResult = [];
    for (const p of postavke) {
      const kolicina = p.kolicina;
      const cenaKos = p.cenaKos;
      const steviloPrejsnje = zalogeMap.get(p.artikelId) ?? 0;

      await tx.insert(zacetneZalogePostavkeTable).values({
        zacetnaZalogaId: zacetnaZaloga.id,
        artikelId: p.artikelId,
        kolicina: String(kolicina),
        cenaKos: String(cenaKos),
        steviloPrejsnje: String(steviloPrejsnje)});

      await tx.insert(zalogaGibiTable).values({
        artikelId: p.artikelId,
        tip: "inventura",
        kolicina: String(kolicina),
        cenaKos: String(cenaKos),
        vrednost: String(kolicina * cenaKos),
        opomba: `Začetne zaloge ${leto}`,
        referencaId: zacetnaZaloga.id});

      const art = artikelMap.get(p.artikelId);
      postavkeResult.push({
        id: zacetnaZaloga.id,
        artikelId: p.artikelId,
        artikelIme: art?.ime ?? "–",
        imeZaNabavo: art?.imeZaNabavo ?? null,
        enotaMere: art?.enotaMere ?? null,
        kolicina,
        cenaKos,
        steviloPrejsnje});
    }

    await recomputeZaloge(postavke.map((p: any) => p.artikelId), tx);
    return { zacetnaZaloga, postavkeResult };
  });

  broadcast("update", { type: "zaloge" });

  res.status(201).json({
    id: zacetnaZaloga.id,
    leto: zacetnaZaloga.leto,
    stevilka: zacetnaZaloga.stevilka,
    datum: zacetnaZaloga.datum,
    opomba: zacetnaZaloga.opomba,
    ustvarjeno: zacetnaZaloga.ustvarjeno,
    postavke: postavkeResult});
});

router.get("/zacetne-zaloge/check-leto/:leto", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const leto = parseInt(req.params.leto);
  if (isNaN(leto)) { res.status(400).json({ error: "Neveljaven ID" }); return; }
  const [row] = await db.select({ id: zacetneZalogeTable.id })
    .from(zacetneZalogeTable)
    .where(and(eq(zacetneZalogeTable.leto, leto), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));
  res.json({ exists: !!row, id: row?.id ?? null });
});

router.get("/zacetne-zaloge/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [zz] = await db.select().from(zacetneZalogeTable)
    .where(and(eq(zacetneZalogeTable.id, id), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));
  if (!zz) { res.status(404).json({ error: "Začetne zaloge niso najdene" }); return; }

  const postavke = await db
    .select({
      id: zacetneZalogePostavkeTable.id,
      artikelId: zacetneZalogePostavkeTable.artikelId,
      artikelIme: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      kolicina: zacetneZalogePostavkeTable.kolicina,
      cenaKos: zacetneZalogePostavkeTable.cenaKos,
      steviloPrejsnje: zacetneZalogePostavkeTable.steviloPrejsnje})
    .from(zacetneZalogePostavkeTable)
    .leftJoin(artikliTable, eq(zacetneZalogePostavkeTable.artikelId, artikliTable.id))
    .where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, id));

  res.json({
    id: zz.id,
    leto: zz.leto,
    stevilka: zz.stevilka,
    datum: zz.datum,
    opomba: zz.opomba,
    ustvarjeno: zz.ustvarjeno,
    postavke: postavke.map((p: any) => ({
      ...p,
      artikelIme: p.artikelIme ?? "–",
      kolicina: Number(p.kolicina),
      cenaKos: Number(p.cenaKos),
      steviloPrejsnje: Number(p.steviloPrejsnje)}))});
});

router.put("/zacetne-zaloge/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const [existing] = await db.select().from(zacetneZalogeTable)
    .where(and(eq(zacetneZalogeTable.id, id), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));
  if (!existing) { res.status(404).json({ error: "Začetne zaloge niso najdene" }); return; }

  const updates: Partial<typeof existing> = {};
  if (parsed.data.datum !== undefined) updates.datum = new Date(parsed.data.datum);
  if (parsed.data.opomba !== undefined) updates.opomba = parsed.data.opomba;

  if (parsed.data.postavke !== undefined) {
    const novaPostavke = parsed.data.postavke;
    if (!novaPostavke.length) { res.status(400).json({ error: "Začetne zaloge morajo imeti vsaj eno postavko" }); return; }

    const artikelIds = novaPostavke.map((p: any) => p.artikelId);
    const putArtikliRows = await db.select({ id: artikliTable.id })
      .from(artikliTable)
      .where(and(inArray(artikliTable.id, artikelIds), sql`true`, eq(artikliTable.enotaId, tenotaId)));
    const putFoundIds = new Set(putArtikliRows.map(a => a.id));
    const putMissingIds = artikelIds.filter((id: any) => !putFoundIds.has(id));
    if (putMissingIds.length > 0) {
      res.status(403).json({ error: "Nekateri artikli ne pripadajo temu podjetju" }); return;
    }

    await db.transaction(async (tx) => {
      const oldPostavke = await tx.select().from(zacetneZalogePostavkeTable)
        .where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, id));

      // Pobriši stare gibi in postavke (zaloge bomo recompute-ali na koncu)
      await tx.delete(zalogaGibiTable).where(
        sql`${zalogaGibiTable.referencaId} = ${id} AND ${zalogaGibiTable.opomba} LIKE ${'Začetne zaloge%'}`
      );
      await tx.delete(zacetneZalogePostavkeTable).where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, id));

      // Vstavi nove postavke in gibi
      for (const p of novaPostavke) {
        const kolicina = p.kolicina;
        const cenaKos = p.cenaKos;

        await tx.insert(zacetneZalogePostavkeTable).values({
          zacetnaZalogaId: id,
          artikelId: p.artikelId,
          kolicina: String(kolicina),
          cenaKos: String(cenaKos),
          steviloPrejsnje: "0"});

        await tx.insert(zalogaGibiTable).values({
          artikelId: p.artikelId,
          tip: "inventura",
          kolicina: String(kolicina),
          cenaKos: String(cenaKos),
          vrednost: String(kolicina * cenaKos),
          opomba: `Začetne zaloge ${existing.leto}`,
          referencaId: id});
      }

      // Posodobi zaloge z WAC recomputom
      await recomputeZaloge(artikelIds, tx);

      await tx.update(zacetneZalogeTable).set(updates)
        .where(and(eq(zacetneZalogeTable.id, id), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));
    });

    broadcast("update", { type: "zaloge" });
  } else {
    await db.update(zacetneZalogeTable).set(updates)
      .where(and(eq(zacetneZalogeTable.id, id), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));
  }

  const [updated] = await db.select().from(zacetneZalogeTable)
    .where(and(eq(zacetneZalogeTable.id, id), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));

  const postavke = await db
    .select({
      id: zacetneZalogePostavkeTable.id,
      artikelId: zacetneZalogePostavkeTable.artikelId,
      artikelIme: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      kolicina: zacetneZalogePostavkeTable.kolicina,
      cenaKos: zacetneZalogePostavkeTable.cenaKos,
      steviloPrejsnje: zacetneZalogePostavkeTable.steviloPrejsnje})
    .from(zacetneZalogePostavkeTable)
    .leftJoin(artikliTable, eq(zacetneZalogePostavkeTable.artikelId, artikliTable.id))
    .where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, id));

  res.json({
    id: updated!.id,
    leto: updated!.leto,
    stevilka: updated!.stevilka,
    datum: updated!.datum,
    opomba: updated!.opomba,
    ustvarjeno: updated!.ustvarjeno,
    postavke: postavke.map((p: any) => ({
      ...p,
      artikelIme: p.artikelIme ?? "–",
      kolicina: Number(p.kolicina),
      cenaKos: Number(p.cenaKos),
      steviloPrejsnje: Number(p.steviloPrejsnje)}))});
});

router.delete("/zacetne-zaloge/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [existing] = await db.select().from(zacetneZalogeTable)
    .where(and(eq(zacetneZalogeTable.id, id), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));
  if (!existing) { res.status(404).json({ error: "Začetne zaloge niso najdene" }); return; }

  const postavke = await db.select().from(zacetneZalogePostavkeTable)
    .where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, id));

  for (const p of postavke) {
    await db.update(zalogeTable).set({
      kolicina: String(Number(p.steviloPrejsnje)),
      zadnjaPosodobitev: new Date()}).where(eq(zalogeTable.artikelId, p.artikelId));
  }

  await db.delete(zalogaGibiTable).where(
    sql`${zalogaGibiTable.referencaId} = ${id} AND ${zalogaGibiTable.opomba} LIKE ${'Začetne zaloge%'}`
  );
  await db.delete(zacetneZalogePostavkeTable).where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, id));
  await db.delete(zacetneZalogeTable).where(and(eq(zacetneZalogeTable.id, id), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));

  broadcast("update", { type: "zaloge" });
  res.status(204).send();
});

export default router;
