import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { artikliTable, db, inventurePostavkeTable, inventureTable, prejemnicePostavkeTable, prejemniceTable, zalogaGibiTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { broadcast } from "../../lib/pos-sse";
import { recomputeZaloge, getZalogeObDatumu } from "../../lib/pos-zaloge-utils";

const router: IRouter = Router();

async function nextStevilkaInventura(year: number, tenotaId: number): Promise<string> {
  const yy = String(year).slice(-2);
  const result = await db.execute(
    sql`SELECT COALESCE(MAX(CAST(SUBSTRING(stevilka, 3) AS INTEGER)), 0) + 1 AS next FROM inventure WHERE stevilka LIKE ${`${yy}%`} AND LENGTH(stevilka) = 8 AND enota_id = ${tenotaId}`
  );
  const nextSeq = Number((result.rows[0] as { next: string })?.next ?? 1);
  return `${yy}${String(nextSeq).padStart(6, "0")}`;
}

async function fetchZadnjeCene(artikelIds: number[], beforeDate?: Date): Promise<Map<number, number>> {
  if (!artikelIds.length) return new Map();
  const rows = await db
    .select({
      artikelId: prejemnicePostavkeTable.artikelId,
      cenaKos: prejemnicePostavkeTable.cenaKos})
    .from(prejemnicePostavkeTable)
    .innerJoin(prejemniceTable, eq(prejemnicePostavkeTable.prejemnicaId, prejemniceTable.id))
    .where(beforeDate
      ? and(inArray(prejemnicePostavkeTable.artikelId, artikelIds), lte(prejemniceTable.datum, beforeDate))
      : inArray(prejemnicePostavkeTable.artikelId, artikelIds))
    .orderBy(desc(prejemniceTable.datum), desc(prejemniceTable.id));
  const map = new Map<number, number>();
  for (const r of rows) {
    if (!map.has(r.artikelId)) map.set(r.artikelId, Number(r.cenaKos));
  }
  return map;
}

router.get("/inventure", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db
    .select({
      id: inventureTable.id,
      stevilka: inventureTable.stevilka,
      datum: inventureTable.datum,
      opomba: inventureTable.opomba,
      ustvarjeno: inventureTable.ustvarjeno,
      steviloPostavk: count(inventurePostavkeTable.id)})
    .from(inventureTable)
    .leftJoin(inventurePostavkeTable, eq(inventurePostavkeTable.inventuraId, inventureTable.id))
    .where(and(eq(inventureTable.enotaId, tenotaId)))
    .groupBy(inventureTable.id)
    .orderBy(desc(inventureTable.datum));

  res.json(rows);
});

router.post("/inventure", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const { datum, opomba, postavke } = parsed.data;
  if (!postavke || postavke.length === 0) {
    res.status(400).json({ error: "Inventura mora imeti vsaj eno postavko" }); return;
  }

  const artikelIds = postavke.map((p: any) => p.artikelId);

  // Inventura se vedno beleži ob 23:59:59 — izvaja se na koncu dneva
  const docDatum = datum ? new Date(datum) : new Date();
  docDatum.setHours(23, 59, 59, 0);
  const cutoff = new Date(docDatum);

  const [zalogaObDatumu, zadnjeCene, artikliRows] = await Promise.all([
    getZalogeObDatumu(artikelIds, cutoff),
    fetchZadnjeCene(artikelIds, cutoff),
    db.select({ id: artikliTable.id, ime: artikliTable.ime, imeZaNabavo: artikliTable.imeZaNabavo, enotaMere: artikliTable.enotaMere })
      .from(artikliTable)
      .where(and(inArray(artikliTable.id, artikelIds), sql`true`, eq(artikliTable.enotaId, tenotaId))),
  ]);
  const foundInvIds = new Set(artikliRows.map(a => a.id));
  const missingInvIds = artikelIds.filter((id: any) => !foundInvIds.has(id));
  if (missingInvIds.length > 0) {
    res.status(403).json({ error: "Nekateri artikli ne pripadajo temu podjetju" }); return;
  }
  const zalogeMap = new Map(Array.from(zalogaObDatumu.entries()).map(([id, v]) => [id, v.kolicina]));
  const artikelMap = new Map(artikliRows.map(a => [a.id, a]));
  const year = docDatum.getFullYear();
  const stevilka = await nextStevilkaInventura(year, tenotaId);

  const { inventura, postavkeResult } = await db.transaction(async (tx) => {
    const [inventura] = await tx.insert(inventureTable).values({
      enotaId: tenotaId,
      stevilka,
      datum: docDatum,
      opomba: opomba ?? null}).returning();

    const postavkeResult = [];
    for (const p of postavke) {
      const steviloNajdeno = p.steviloNajdeno ?? 0;
      const steviloPrejsnje = zalogeMap.get(p.artikelId) ?? 0;
      const razlika = steviloNajdeno - steviloPrejsnje;
      const cenaKos = zalogaObDatumu.get(p.artikelId)?.cenaKos || (zadnjeCene.get(p.artikelId) ?? 0);

      await tx.insert(inventurePostavkeTable).values({
        inventuraId: inventura.id,
        artikelId: p.artikelId,
        steviloNajdeno: String(steviloNajdeno),
        steviloPrejsnje: String(steviloPrejsnje),
        razlika: String(razlika),
        cenaKos: String(cenaKos)});

      await tx.insert(zalogaGibiTable).values({
        artikelId: p.artikelId,
        tip: "inventura",
        kolicina: String(razlika),
        opomba: opomba ?? `Inventura #${inventura.id}`,
        referencaId: inventura.id});

      const art = artikelMap.get(p.artikelId);
      postavkeResult.push({
        id: inventura.id,
        artikelId: p.artikelId,
        artikelIme: art?.ime ?? "–",
        imeZaNabavo: art?.imeZaNabavo ?? null,
        enotaMere: art?.enotaMere ?? null,
        steviloNajdeno,
        steviloPrejsnje,
        razlika,
        cenaKos});
    }

    await recomputeZaloge(artikelIds, tx);

    return { inventura, postavkeResult };
  });
  broadcast("update", { type: "zaloge" });

  res.status(201).json({
    id: inventura.id,
    stevilka: inventura.stevilka,
    datum: inventura.datum,
    opomba: inventura.opomba,
    ustvarjeno: inventura.ustvarjeno,
    postavke: postavkeResult});
});

router.get("/inventure/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [inventura] = await db.select().from(inventureTable)
    .where(and(eq(inventureTable.id, id), sql`true`, eq(inventureTable.enotaId, tenotaId)));
  if (!inventura) { res.status(404).json({ error: "Inventura ni najdena" }); return; }

  const postavke = await db
    .select({
      id: inventurePostavkeTable.id,
      artikelId: inventurePostavkeTable.artikelId,
      artikelIme: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      steviloNajdeno: inventurePostavkeTable.steviloNajdeno,
      steviloPrejsnje: inventurePostavkeTable.steviloPrejsnje,
      razlika: inventurePostavkeTable.razlika,
      cenaKos: inventurePostavkeTable.cenaKos})
    .from(inventurePostavkeTable)
    .leftJoin(artikliTable, eq(inventurePostavkeTable.artikelId, artikliTable.id))
    .where(eq(inventurePostavkeTable.inventuraId, id));

  res.json({
    id: inventura.id,
    stevilka: inventura.stevilka,
    datum: inventura.datum,
    opomba: inventura.opomba,
    ustvarjeno: inventura.ustvarjeno,
    postavke: postavke.map((p: any) => ({
      ...p,
      artikelIme: p.artikelIme ?? "–",
      steviloNajdeno: Number(p.steviloNajdeno),
      steviloPrejsnje: Number(p.steviloPrejsnje),
      razlika: Number(p.razlika),
      cenaKos: Number(p.cenaKos)}))});
});

router.put("/inventure/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const [existing] = await db.select().from(inventureTable)
    .where(and(eq(inventureTable.id, id), sql`true`, eq(inventureTable.enotaId, tenotaId)));
  if (!existing) { res.status(404).json({ error: "Inventura ni najdena" }); return; }

  let zadnjeCeneMap: Map<number, number> | undefined;
  if (parsed.data.postavke !== undefined) {
    const novaPostavke = parsed.data.postavke;
    if (!novaPostavke.length) { res.status(400).json({ error: "Inventura mora imeti vsaj eno postavko" }); return; }

    const artikelIds = novaPostavke.map((p: any) => p.artikelId);
    const putArtikliRows = await db.select({ id: artikliTable.id })
      .from(artikliTable)
      .where(and(inArray(artikliTable.id, artikelIds), sql`true`, eq(artikliTable.enotaId, tenotaId)));
    const putFoundIds = new Set(putArtikliRows.map(a => a.id));
    const putMissingIds = artikelIds.filter((id: any) => !putFoundIds.has(id));
    if (putMissingIds.length > 0) {
      res.status(403).json({ error: "Nekateri artikli ne pripadajo temu podjetju" }); return;
    }

    const putInventuraDatum = parsed.data.datum ? new Date(parsed.data.datum) : existing.datum;
    const putCutoff = new Date(putInventuraDatum);
    putCutoff.setHours(23, 59, 59, 999);
    zadnjeCeneMap = await fetchZadnjeCene(artikelIds, putCutoff);
  }

  let didUpdatePostavke = false;

  const [updated] = await db.transaction(async (tx) => {
    const txUpdates: Partial<typeof existing> = {};
    if (parsed.data.datum !== undefined) {
      const d = new Date(parsed.data.datum);
      d.setHours(23, 59, 59, 0);
      txUpdates.datum = d;
    }
    if (parsed.data.opomba !== undefined) txUpdates.opomba = parsed.data.opomba;

    if (parsed.data.postavke !== undefined) {
      const novaPostavke = parsed.data.postavke;
      const artikelIds2 = novaPostavke.map((p: any) => p.artikelId);

      const oldPostavke = await tx.select().from(inventurePostavkeTable).where(eq(inventurePostavkeTable.inventuraId, id));
      const oldArtikleIds = oldPostavke.map((p: any) => p.artikelId);

      await tx.delete(zalogaGibiTable).where(sql`${zalogaGibiTable.referencaId} = ${id} AND ${zalogaGibiTable.tip} = 'inventura' AND (${zalogaGibiTable.opomba} IS NULL OR ${zalogaGibiTable.opomba} NOT LIKE ${'Začetne zaloge%'})`);
      await tx.delete(inventurePostavkeTable).where(eq(inventurePostavkeTable.inventuraId, id));
      await recomputeZaloge(oldArtikleIds, tx);

      // Stanje zalog ob koncu inventurnega dne (brez te inventure, ker smo jo ravno izbrisali)
      const putInventuraDatum2 = parsed.data.datum ? new Date(parsed.data.datum) : existing.datum;
      const putCutoff2 = new Date(putInventuraDatum2);
      putCutoff2.setHours(23, 59, 59, 999);
      const zalogaObDatumu = await getZalogeObDatumu(artikelIds2, putCutoff2, tx);
      const zalogeMap = new Map(Array.from(zalogaObDatumu.entries()).map(([id2, v]) => [id2, v.kolicina]));

      for (const p of novaPostavke) {
        const steviloNajdeno = p.steviloNajdeno ?? 0;
        const steviloPrejsnje = zalogeMap.get(p.artikelId) ?? 0;
        const razlika = steviloNajdeno - steviloPrejsnje;
        const cenaKos = zalogaObDatumu.get(p.artikelId)?.cenaKos || (zadnjeCeneMap!.get(p.artikelId) ?? 0);

        await tx.insert(inventurePostavkeTable).values({
          inventuraId: id,
          artikelId: p.artikelId,
          steviloNajdeno: String(steviloNajdeno),
          steviloPrejsnje: String(steviloPrejsnje),
          razlika: String(razlika),
          cenaKos: String(cenaKos)});

        await tx.insert(zalogaGibiTable).values({
          artikelId: p.artikelId,
          tip: "inventura",
          kolicina: String(razlika),
          opomba: parsed.data.opomba ?? existing.opomba ?? `Inventura #${id}`,
          referencaId: id});
      }

      const allAffectedIds = [...new Set([...oldArtikleIds, ...artikelIds2])];
      await recomputeZaloge(allAffectedIds, tx);

      didUpdatePostavke = true;
    }

    return tx.update(inventureTable).set(txUpdates)
      .where(and(eq(inventureTable.id, id), sql`true`, eq(inventureTable.enotaId, tenotaId)))
      .returning();
  });

  if (didUpdatePostavke) broadcast("update", { type: "zaloge" });

  const postavke = await db
    .select({
      id: inventurePostavkeTable.id,
      artikelId: inventurePostavkeTable.artikelId,
      artikelIme: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      steviloNajdeno: inventurePostavkeTable.steviloNajdeno,
      steviloPrejsnje: inventurePostavkeTable.steviloPrejsnje,
      razlika: inventurePostavkeTable.razlika,
      cenaKos: inventurePostavkeTable.cenaKos})
    .from(inventurePostavkeTable)
    .leftJoin(artikliTable, eq(inventurePostavkeTable.artikelId, artikliTable.id))
    .where(eq(inventurePostavkeTable.inventuraId, id));

  res.json({
    id: updated.id,
    stevilka: updated.stevilka,
    datum: updated.datum,
    opomba: updated.opomba,
    ustvarjeno: updated.ustvarjeno,
    postavke: postavke.map((p: any) => ({
      ...p,
      artikelIme: p.artikelIme ?? "–",
      steviloNajdeno: Number(p.steviloNajdeno),
      steviloPrejsnje: Number(p.steviloPrejsnje),
      razlika: Number(p.razlika),
      cenaKos: Number(p.cenaKos)}))});
});

router.delete("/inventure/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [existing] = await db.select().from(inventureTable)
    .where(and(eq(inventureTable.id, id), sql`true`, eq(inventureTable.enotaId, tenotaId)));
  if (!existing) { res.status(404).json({ error: "Inventura ni najdena" }); return; }

  const postavke = await db.select().from(inventurePostavkeTable).where(eq(inventurePostavkeTable.inventuraId, id));
  const artikelIds = postavke.map((p: any) => p.artikelId);

  await db.transaction(async (tx) => {
    await tx.delete(zalogaGibiTable).where(
      sql`${zalogaGibiTable.referencaId} = ${id} AND ${zalogaGibiTable.tip} = 'inventura' AND (${zalogaGibiTable.opomba} IS NULL OR ${zalogaGibiTable.opomba} NOT LIKE ${'Začetne zaloge%'})`
    );
    await tx.delete(inventurePostavkeTable).where(eq(inventurePostavkeTable.inventuraId, id));
    await tx.delete(inventureTable).where(and(eq(inventureTable.id, id), sql`true`, eq(inventureTable.enotaId, tenotaId)));

    await recomputeZaloge(artikelIds, tx);
  });

  broadcast("update", { type: "zaloge" });
  res.status(204).send();
});

export default router;
