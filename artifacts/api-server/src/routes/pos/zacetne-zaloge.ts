import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { artikliTable, db, zacetneZalogePostavkeTable, zacetneZalogeTable, zalogaGibiTable, zalogeTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import type { PosRequest } from "../../middlewares/pos";
import { broadcastToUnit } from "../../lib/pos-sse";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";
import { bookZacetnaZaloga } from "../../lib/posSyncBooking";
import { appendStockMovementReversals } from "../../lib/stockMovementHistory";
import { openingStockEffectiveAt } from "../../lib/pos-opening-stock-time";

const router: IRouter = Router();

router.get("/zacetne-zaloge", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
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
  const tenotaId = (req as any).enotaId;
  const actorSnapshot = (req as PosRequest).clerkUserId;
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
    db.select({ id: artikliTable.id, ime: artikliTable.ime, imeZaNabavo: artikliTable.imeZaNabavo, enotaMere: artikliTable.enotaMere, vrstaArtikla: artikliTable.vrstaArtikla, drobniInventar: artikliTable.drobniInventar })
      .from(artikliTable).where(and(inArray(artikliTable.id, artikelIds), sql`true`, eq(artikliTable.enotaId, tenotaId))),
  ]);
  const foundZzIds = new Set(artikliRows.map(a => a.id));
  const missingZzIds = artikelIds.filter((id: any) => !foundZzIds.has(id));
  if (missingZzIds.length > 0) {
    res.status(403).json({ error: "Nekateri artikli ne pripadajo temu podjetju" }); return;
  }
  const zalogeMap = new Map(currentZaloge.map(z => [z.artikelId, Number(z.kolicina)]));
  const artikelMap = new Map(artikliRows.map(a => [a.id, a]));
  const docDatum = datum ? new Date(datum) : new Date();
  const effectiveAt = await openingStockEffectiveAt(tenotaId, leto, docDatum);
  if (docDatum.toISOString().slice(0, 10) === `${leto}-01-01` && effectiveAt.getTime() > Date.now()) {
    res.status(409).json({ error: "Začetne zaloge lahko prenesete šele po začetni uri poslovnega dne novega leta." }); return;
  }

  const { zacetnaZaloga, postavkeResult } = await db.transaction(async (tx) => {
    const [zacetnaZaloga] = await tx.insert(zacetneZalogeTable).values({
      enotaId: tenotaId,
      leto,
      stevilka,
      datum: docDatum,
      opomba: opomba ?? null}).returning();

    const postavkeResult = [];
    for (const p of postavke) {
      const kolicina = p.kolicina;
      const art = artikelMap.get(p.artikelId);
      const cenaKos = art?.drobniInventar ? 0 : p.cenaKos;
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
        referencaId: zacetnaZaloga.id,
        actorSnapshot,
        effectiveAtSnapshot: effectiveAt,
        sourceSnapshot: "zacetne-zaloge"});

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

  broadcastToUnit(tenotaId, "update", { type: "zaloge" });

  // Poknjižiti v ERP — počakamo na rezultat in vrnemo skupaj z odgovorom
  const companyId = (req as PosRequest).companyId;
  const zzDatum = zacetnaZaloga.datum instanceof Date
    ? zacetnaZaloga.datum.toISOString().slice(0, 10)
    : String(zacetnaZaloga.datum).slice(0, 10);
  const bookingResult = await bookZacetnaZaloga(
    companyId,
    tenotaId,
    zacetnaZaloga.leto,
    zzDatum,
    postavke.map((p: any) => ({
      vrstaArtikla: artikelMap.get(p.artikelId)?.vrstaArtikla ?? null,
      drobniInventar: artikelMap.get(p.artikelId)?.drobniInventar ?? false,
      kolicina: p.kolicina,
      cenaKos: p.cenaKos,
    })),
  ).catch(err => { console.warn("[ZZ booking]", err); return null; });

  res.status(201).json({
    id: zacetnaZaloga.id,
    leto: zacetnaZaloga.leto,
    stevilka: zacetnaZaloga.stevilka,
    datum: zacetnaZaloga.datum,
    opomba: zacetnaZaloga.opomba,
    ustvarjeno: zacetnaZaloga.ustvarjeno,
    postavke: postavkeResult,
    bookingRef: bookingResult?.created ?? null,
    bookingSkipped: bookingResult?.skipped?.reason ?? null});
});

router.get("/zacetne-zaloge/check-leto/:leto", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const leto = parseInt(req.params.leto);
  if (isNaN(leto)) { res.status(400).json({ error: "Neveljaven ID" }); return; }
  const [row] = await db.select({ id: zacetneZalogeTable.id })
    .from(zacetneZalogeTable)
    .where(and(eq(zacetneZalogeTable.leto, leto), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));
  res.json({ exists: !!row, id: row?.id ?? null });
});

router.get("/zacetne-zaloge/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
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
  const tenotaId = (req as any).enotaId;
  const actorSnapshot = (req as PosRequest).clerkUserId;
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
  const effectiveAt = await openingStockEffectiveAt(tenotaId, existing.leto, updates.datum ?? existing.datum);
  if ((updates.datum ?? existing.datum).toISOString().slice(0, 10) === `${existing.leto}-01-01` && effectiveAt.getTime() > Date.now()) {
    res.status(409).json({ error: "Začetne zaloge lahko prenesete šele po začetni uri poslovnega dne novega leta." }); return;
  }

  let putBookingResult: { created: string | null; skipped: { reason: string } | null } | null = null;

  if (parsed.data.postavke !== undefined) {
    const novaPostavke = parsed.data.postavke;
    if (!novaPostavke.length) { res.status(400).json({ error: "Začetne zaloge morajo imeti vsaj eno postavko" }); return; }

    const artikelIds = novaPostavke.map((p: any) => p.artikelId);
    const putArtikliRows = await db.select({ id: artikliTable.id, drobniInventar: artikliTable.drobniInventar })
      .from(artikliTable)
      .where(and(inArray(artikliTable.id, artikelIds), sql`true`, eq(artikliTable.enotaId, tenotaId)));
    const putFoundIds = new Set(putArtikliRows.map(a => a.id));
    const putArticleMap = new Map(putArtikliRows.map(a => [a.id, a]));
    const putMissingIds = artikelIds.filter((id: any) => !putFoundIds.has(id));
    if (putMissingIds.length > 0) {
      res.status(403).json({ error: "Nekateri artikli ne pripadajo temu podjetju" }); return;
    }

    await db.transaction(async (tx) => {
      const oldPostavke = await tx.select().from(zacetneZalogePostavkeTable)
        .where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, id));

      // Stare gibe ohrani in jih razveljavi z nasprotnimi knjižbami.
      const reversedArtikelIds = await appendStockMovementReversals(tx, {
        referenceId: id,
        sourceSnapshots: ["zacetne-zaloge"],
        actorSnapshot: actorSnapshot ?? null,
        reversalSourceSnapshot: "zacetne-zaloge_reversal",
        note: `Storno začetnih zalog ${existing.leto}`,
        legacyKind: "zacetne-zaloge",
      });
      await tx.delete(zacetneZalogePostavkeTable).where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, id));

      // Vstavi nove postavke in gibi
      for (const p of novaPostavke) {
        const kolicina = p.kolicina;
        const cenaKos = putArticleMap.get(p.artikelId)?.drobniInventar ? 0 : p.cenaKos;

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
          referencaId: id,
          actorSnapshot,
          effectiveAtSnapshot: effectiveAt,
          sourceSnapshot: "zacetne-zaloge"});
      }

      // Posodobi vse zaloge, ki so jih prizadele stare ali nove postavke.
      const affectedArtikelIds = [...new Set([
        ...oldPostavke.map((p) => p.artikelId),
        ...reversedArtikelIds,
        ...artikelIds,
      ])];
      await recomputeZaloge(affectedArtikelIds, tx);

      await tx.update(zacetneZalogeTable).set(updates)
        .where(and(eq(zacetneZalogeTable.id, id), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));
    });

    broadcastToUnit(tenotaId, "update", { type: "zaloge" });

    // Re-booking v ERP — počakamo na rezultat
    const putCompanyId = (req as PosRequest).companyId;
    const putDatum = existing.datum instanceof Date
      ? existing.datum.toISOString().slice(0, 10)
      : String(existing.datum).slice(0, 10);
    const novePutPostavke = await db
      .select({ vrstaArtikla: artikliTable.vrstaArtikla, drobniInventar: artikliTable.drobniInventar, kolicina: zacetneZalogePostavkeTable.kolicina, cenaKos: zacetneZalogePostavkeTable.cenaKos })
      .from(zacetneZalogePostavkeTable)
      .leftJoin(artikliTable, eq(artikliTable.id, zacetneZalogePostavkeTable.artikelId))
      .where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, id));
    putBookingResult = await bookZacetnaZaloga(
      putCompanyId,
      tenotaId,
      existing.leto,
      putDatum,
      novePutPostavke.map(p => ({ vrstaArtikla: p.vrstaArtikla ?? null, drobniInventar: p.drobniInventar === true, kolicina: Number(p.kolicina), cenaKos: Number(p.cenaKos) })),
    ).catch(err => { console.warn("[ZZ booking PUT]", err); return null; });
  } else if (parsed.data.datum !== undefined && updates.datum!.getTime() !== existing.datum.getTime()) {
    await db.transaction(async (tx) => {
      const existingPostavke = await tx.select({
        id: zacetneZalogePostavkeTable.id,
        artikelId: zacetneZalogePostavkeTable.artikelId,
        kolicina: zacetneZalogePostavkeTable.kolicina,
        cenaKos: zacetneZalogePostavkeTable.cenaKos,
        drobniInventar: artikliTable.drobniInventar,
      }).from(zacetneZalogePostavkeTable)
        .leftJoin(artikliTable, eq(artikliTable.id, zacetneZalogePostavkeTable.artikelId))
        .where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, id));
      const artikelIds = existingPostavke.flatMap((p) => p.artikelId == null ? [] : [p.artikelId]);
      const reversedArtikelIds = await appendStockMovementReversals(tx, {
        referenceId: id,
        sourceSnapshots: ["zacetne-zaloge"],
        actorSnapshot: actorSnapshot ?? null,
        reversalSourceSnapshot: "zacetne-zaloge_reversal",
        note: `Storno začetnih zalog ${existing.leto} zaradi spremembe datuma`,
        legacyKind: "zacetne-zaloge",
      });
      for (const p of existingPostavke) {
        if (p.artikelId == null) continue;
        await tx.insert(zalogaGibiTable).values({
          artikelId: p.artikelId,
          tip: "inventura",
          kolicina: p.kolicina,
          cenaKos: p.drobniInventar ? "0" : p.cenaKos,
          vrednost: p.drobniInventar ? "0" : String(Number(p.kolicina) * Number(p.cenaKos)),
          opomba: `Začetne zaloge ${existing.leto}`,
          referencaId: id,
          actorSnapshot,
          effectiveAtSnapshot: effectiveAt,
          sourceSnapshot: "zacetne-zaloge",
        });
      }
      await recomputeZaloge([...new Set([...artikelIds, ...reversedArtikelIds])], tx);
      await tx.update(zacetneZalogeTable).set(updates)
        .where(and(eq(zacetneZalogeTable.id, id), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));
    });
    broadcastToUnit(tenotaId, "update", { type: "zaloge" });
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
      steviloPrejsnje: Number(p.steviloPrejsnje)})),
    bookingRef: putBookingResult?.created ?? null,
    bookingSkipped: putBookingResult?.skipped?.reason ?? null});
});

/**
 * POST /zacetne-zaloge/:id/poknjizi
 * Ročno (re)knjiženje začetne zaloge v ERP — ustvari ali osveži temeljnico
 * svoje enote, označeno s stroškovnim mestom.
 */
router.post("/zacetne-zaloge/:id/poknjizi", requireEnota, async (req, res): Promise<void> => {
  const companyId = (req as PosRequest).companyId;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [zz] = await db.select().from(zacetneZalogeTable)
    .where(and(eq(zacetneZalogeTable.id, id), sql`true`, eq(zacetneZalogeTable.enotaId, (req as any).enotaId)));
  if (!zz) { res.status(404).json({ error: "Začetne zaloge niso najdene" }); return; }

  const postavke = await db
    .select({
      vrstaArtikla: artikliTable.vrstaArtikla,
      drobniInventar: artikliTable.drobniInventar,
      kolicina: zacetneZalogePostavkeTable.kolicina,
      cenaKos: zacetneZalogePostavkeTable.cenaKos,
    })
    .from(zacetneZalogePostavkeTable)
    .leftJoin(artikliTable, eq(artikliTable.id, zacetneZalogePostavkeTable.artikelId))
    .where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, id));

  const datum = zz.datum instanceof Date
    ? zz.datum.toISOString().slice(0, 10)
    : String(zz.datum).slice(0, 10);

  const result = await bookZacetnaZaloga(
    companyId,
    (req as any).enotaId,
    zz.leto,
    datum,
    postavke.map(p => ({ vrstaArtikla: p.vrstaArtikla ?? null, drobniInventar: p.drobniInventar === true, kolicina: Number(p.kolicina), cenaKos: Number(p.cenaKos) })),
  );

  if (result.skipped) {
    res.status(422).json({ error: result.skipped.reason });
    return;
  }

  res.json({ ref: result.created ?? null });
});

router.delete("/zacetne-zaloge/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const actorSnapshot = (req as PosRequest).clerkUserId;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [existing] = await db.select().from(zacetneZalogeTable)
    .where(and(eq(zacetneZalogeTable.id, id), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));
  if (!existing) { res.status(404).json({ error: "Začetne zaloge niso najdene" }); return; }

  await db.transaction(async (tx) => {
    const postavke = await tx.select().from(zacetneZalogePostavkeTable)
      .where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, id));
    const reversedArtikelIds = await appendStockMovementReversals(tx, {
      referenceId: id,
      sourceSnapshots: ["zacetne-zaloge"],
      actorSnapshot: actorSnapshot ?? null,
      reversalSourceSnapshot: "zacetne-zaloge_reversal",
      note: `Storno začetnih zalog ${existing.leto}`,
      legacyKind: "zacetne-zaloge",
    });

    await tx.delete(zacetneZalogePostavkeTable).where(eq(zacetneZalogePostavkeTable.zacetnaZalogaId, id));
    await tx.delete(zacetneZalogeTable).where(and(eq(zacetneZalogeTable.id, id), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));

    const affectedArtikelIds = [...new Set([
      ...postavke.map((p) => p.artikelId),
      ...reversedArtikelIds,
    ])];
    await recomputeZaloge(affectedArtikelIds, tx);
  });

  // Pobriši osnutek ERP temeljnice svoje enote — [] sproži čiščenje osnutka.
  const delCompanyId = (req as PosRequest).companyId;
  const delDatum = existing.datum instanceof Date ? existing.datum.toISOString().slice(0, 10) : String(existing.datum).slice(0, 10);
  bookZacetnaZaloga(delCompanyId, tenotaId, existing.leto, delDatum, [])
    .catch(err => console.warn("[ZZ booking DEL]", err));

  broadcastToUnit(tenotaId, "update", { type: "zaloge" });
  res.status(204).send();
});

export default router;
