import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { artikliTable, db, prejemnicePostavkeTable, prejemniceTable, shranjeniKupciTable, uvozSejaTable, zalogaGibiTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { broadcast } from "../../lib/pos-sse";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";
import { syncPosBookingForDay } from "../../lib/posSyncBooking";

const router: IRouter = Router();

async function nextStevilkaPrejemnica(year: number, _davcna: string, tenotaId: number): Promise<string> {
  const yy = String(year).slice(-2);
  const result = await db.execute(
    sql`SELECT COALESCE(MAX(CAST(SUBSTRING(stevilka, 3) AS INTEGER)), 0) + 1 AS next FROM prejemnice WHERE stevilka LIKE ${`${yy}%`} AND LENGTH(stevilka) = 8 AND enota_id = ${tenotaId}`
  );
  const nextSeq = Number((result.rows[0] as { next: string })?.next ?? 1);
  return `${yy}${String(nextSeq).padStart(6, "0")}`;
}

router.get("/prejemnice", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db
    .select({
      id: prejemniceTable.id,
      stevilka: prejemniceTable.stevilka,
      datum: prejemniceTable.datum,
      opomba: prejemniceTable.opomba,
      skupajVrednost: prejemniceTable.skupajVrednost,
      ustvarjeno: prejemniceTable.ustvarjeno,
      dobaviteljId: prejemniceTable.dobaviteljId,
      dobaviteljNaziv: shranjeniKupciTable.naziv,
      steviloPostavk: count(prejemnicePostavkeTable.id)})
    .from(prejemniceTable)
    .leftJoin(prejemnicePostavkeTable, eq(prejemnicePostavkeTable.prejemnicaId, prejemniceTable.id))
    .leftJoin(shranjeniKupciTable, eq(shranjeniKupciTable.id, prejemniceTable.dobaviteljId))
    .where(and(eq(prejemniceTable.enotaId, tenotaId)))
    .groupBy(prejemniceTable.id, shranjeniKupciTable.naziv)
    .orderBy(desc(prejemniceTable.datum));

  res.json(rows.map(r => ({ ...r, skupajVrednost: Number(r.skupajVrednost) })));
});

router.post("/prejemnice", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const companyId = (req as any).companyId as string;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const { datum, opomba, postavke, dobaviteljId, vrstaCen } = parsed.data;
  if (!postavke || postavke.length === 0) {
    res.status(400).json({ error: "Prejemnica mora imeti vsaj eno postavko" }); return;
  }

  const skupajVrednost = postavke.reduce((acc: number, p: any) => acc + (p.kolicina ?? 0) * (p.cenaKos ?? 0), 0);

  const artikelIds = postavke.map((p: any) => p.artikelId);
  const artikliRows = await db.select({ id: artikliTable.id, ime: artikliTable.ime, imeZaNabavo: artikliTable.imeZaNabavo, enotaMere: artikliTable.enotaMere })
    .from(artikliTable)
    .where(and(inArray(artikliTable.id, artikelIds), sql`true`, eq(artikliTable.enotaId, tenotaId)));
  const foundIds = new Set(artikliRows.map(a => a.id));
  const missingIds = artikelIds.filter((id: any) => !foundIds.has(id));
  if (missingIds.length > 0) {
    res.status(403).json({ error: "Nekateri artikli ne pripadajo temu podjetju" }); return;
  }
  const artikelMap = new Map(artikliRows.map(a => [a.id, a]));

  const docDatum = datum ? new Date(datum) : new Date();
  const year = docDatum.getFullYear();
  const stevilka = await nextStevilkaPrejemnica(year, "", tenotaId);

  const { prejemnica, postavkeResult } = await db.transaction(async (tx) => {
    const [prejemnica] = await tx.insert(prejemniceTable).values({
      enotaId: tenotaId,
      dobaviteljId: dobaviteljId ?? null,
      stevilka,
      datum: docDatum,
      opomba: opomba ?? null,
      vrstaCen: (vrstaCen === "bruto" ? "bruto" : "neto") as "neto" | "bruto",
      skupajVrednost: String(skupajVrednost.toFixed(2))}).returning();

    const postavkeResult = [];
    for (const p of postavke) {
      const kolicina = p.kolicina ?? 0;
      const cenaKos = p.cenaKos ?? 0;
      const skupaj = kolicina * cenaKos;

      const enotVPaketu = p.enotVPaketu && Number(p.enotVPaketu) > 1 ? Number(p.enotVPaketu) : 1;
      const [pp] = await tx.insert(prejemnicePostavkeTable).values({
        prejemnicaId: prejemnica.id,
        artikelId: p.artikelId,
        kolicina: String(kolicina),
        cenaKos: String(cenaKos),
        skupaj: String(skupaj.toFixed(2)),
        enotVPaketu: String(enotVPaketu)}).returning();

      await tx.insert(zalogaGibiTable).values({
        artikelId: p.artikelId,
        tip: "prejemnica",
        kolicina: String(kolicina),
        opomba: opomba ?? null,
        referencaId: prejemnica.id});

      const art = artikelMap.get(p.artikelId);
      postavkeResult.push({
        id: pp.id,
        artikelId: p.artikelId,
        artikelIme: art?.ime ?? "–",
        imeZaNabavo: art?.imeZaNabavo ?? null,
        enotaMere: art?.enotaMere ?? null,
        kolicina,
        cenaKos,
        skupaj,
        enotVPaketu});
    }

    await recomputeZaloge(artikelIds, tx);

    return { prejemnica, postavkeResult };
  });
  broadcast("update", { type: "zaloge" });

  res.status(201).json({
    id: prejemnica.id,
    stevilka: prejemnica.stevilka,
    datum: prejemnica.datum,
    opomba: prejemnica.opomba,
    vrstaCen: prejemnica.vrstaCen,
    skupajVrednost,
    ustvarjeno: prejemnica.ustvarjeno,
    postavke: postavkeResult});

  // POS → ERP samodejni knjižni osnutki (fire-and-forget, ne blokira odgovora)
  setImmediate(() => {
    const datum = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Ljubljana" }).format(docDatum);
    syncPosBookingForDay(companyId, datum).catch(err => console.warn("[POS sync]", err));
  });
});

router.get("/prejemnice/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [prejemnica] = await db
    .select({
      id: prejemniceTable.id,
      stevilka: prejemniceTable.stevilka,
      datum: prejemniceTable.datum,
      opomba: prejemniceTable.opomba,
      vrstaCen: prejemniceTable.vrstaCen,
      skupajVrednost: prejemniceTable.skupajVrednost,
      ustvarjeno: prejemniceTable.ustvarjeno,
      dobaviteljId: prejemniceTable.dobaviteljId,
      dobaviteljNaziv: shranjeniKupciTable.naziv,
    })
    .from(prejemniceTable)
    .leftJoin(shranjeniKupciTable, eq(shranjeniKupciTable.id, prejemniceTable.dobaviteljId))
    .where(and(eq(prejemniceTable.id, id), sql`true`, eq(prejemniceTable.enotaId, tenotaId)));
  if (!prejemnica) { res.status(404).json({ error: "Prejemnica ni najdena" }); return; }

  const postavke = await db
    .select({
      id: prejemnicePostavkeTable.id,
      artikelId: prejemnicePostavkeTable.artikelId,
      artikelIme: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      kolicina: prejemnicePostavkeTable.kolicina,
      cenaKos: prejemnicePostavkeTable.cenaKos,
      skupaj: prejemnicePostavkeTable.skupaj,
      enotVPaketu: prejemnicePostavkeTable.enotVPaketu})
    .from(prejemnicePostavkeTable)
    .leftJoin(artikliTable, eq(prejemnicePostavkeTable.artikelId, artikliTable.id))
    .where(eq(prejemnicePostavkeTable.prejemnicaId, id));

  res.json({
    id: prejemnica.id,
    stevilka: prejemnica.stevilka,
    datum: prejemnica.datum,
    opomba: prejemnica.opomba,
    vrstaCen: prejemnica.vrstaCen ?? "neto",
    skupajVrednost: Number(prejemnica.skupajVrednost),
    ustvarjeno: prejemnica.ustvarjeno,
    dobaviteljId: prejemnica.dobaviteljId ?? null,
    dobaviteljNaziv: prejemnica.dobaviteljNaziv ?? null,
    postavke: postavke.map((p: any) => ({
      ...p,
      artikelIme: p.artikelIme ?? "–",
      kolicina: Number(p.kolicina),
      cenaKos: Number(p.cenaKos),
      skupaj: Number(p.skupaj),
      enotVPaketu: Number(p.enotVPaketu ?? 1)}))});
});

router.put("/prejemnice/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const [existing] = await db.select().from(prejemniceTable)
    .where(and(eq(prejemniceTable.id, id), sql`true`, eq(prejemniceTable.enotaId, tenotaId)));
  if (!existing) { res.status(404).json({ error: "Prejemnica ni najdena" }); return; }

  let artikelMap: Map<number, { id: number; ime: string; imeZaNabavo: string | null; enotaMere: string | null }> | undefined;
  if (parsed.data.postavke !== undefined) {
    const novaPostavke = parsed.data.postavke;
    if (!novaPostavke.length) { res.status(400).json({ error: "Prejemnica mora imeti vsaj eno postavko" }); return; }

    const artikelIds = novaPostavke.map((p: any) => p.artikelId);
    const artikliRows = await db.select({ id: artikliTable.id, ime: artikliTable.ime, imeZaNabavo: artikliTable.imeZaNabavo, enotaMere: artikliTable.enotaMere })
      .from(artikliTable)
      .where(and(inArray(artikliTable.id, artikelIds), sql`true`, eq(artikliTable.enotaId, tenotaId)));
    const putFoundIds = new Set(artikliRows.map(a => a.id));
    const putMissingIds = artikelIds.filter((id: any) => !putFoundIds.has(id));
    if (putMissingIds.length > 0) {
      res.status(403).json({ error: "Nekateri artikli ne pripadajo temu podjetju" }); return;
    }
    artikelMap = new Map(artikliRows.map(a => [a.id, a]));
  }

  let didUpdatePostavke = false;

  const [updated] = await db.transaction(async (tx) => {
    const txUpdates: Partial<typeof existing> = {};
    if (parsed.data.datum !== undefined) txUpdates.datum = new Date(parsed.data.datum);
    if (parsed.data.opomba !== undefined) txUpdates.opomba = parsed.data.opomba;
    if (parsed.data.dobaviteljId !== undefined) txUpdates.dobaviteljId = parsed.data.dobaviteljId ?? null;
    if (parsed.data.vrstaCen !== undefined) txUpdates.vrstaCen = parsed.data.vrstaCen === "bruto" ? "bruto" : "neto";

    if (parsed.data.postavke !== undefined) {
      const novaPostavke = parsed.data.postavke;
      const newArtikleIds: number[] = [];

      const oldPostavke = await tx.select().from(prejemnicePostavkeTable).where(eq(prejemnicePostavkeTable.prejemnicaId, id));
      const oldArtikleIds = oldPostavke.map((p: any) => p.artikelId);

      await tx.delete(zalogaGibiTable).where(sql`${zalogaGibiTable.referencaId} = ${id} AND ${zalogaGibiTable.tip} = 'prejemnica'`);
      await tx.delete(prejemnicePostavkeTable).where(eq(prejemnicePostavkeTable.prejemnicaId, id));

      let skupajVrednost = 0;
      for (const p of novaPostavke) {
        const kolicina = p.kolicina ?? 0;
        const cenaKos = p.cenaKos ?? 0;
        skupajVrednost += kolicina * cenaKos;

        const enotVPaketu = p.enotVPaketu && Number(p.enotVPaketu) > 1 ? Number(p.enotVPaketu) : 1;
        await tx.insert(prejemnicePostavkeTable).values({
          prejemnicaId: id,
          artikelId: p.artikelId,
          kolicina: String(kolicina),
          cenaKos: String(cenaKos),
          skupaj: String((kolicina * cenaKos).toFixed(2)),
          enotVPaketu: String(enotVPaketu)});

        await tx.insert(zalogaGibiTable).values({
          artikelId: p.artikelId,
          tip: "prejemnica",
          kolicina: String(kolicina),
          opomba: parsed.data.opomba ?? existing.opomba ?? null,
          referencaId: id});

        newArtikleIds.push(p.artikelId);
      }

      const allAffectedIds = [...new Set([...oldArtikleIds, ...newArtikleIds])];
      await recomputeZaloge(allAffectedIds, tx);

      txUpdates.skupajVrednost = String(skupajVrednost.toFixed(2));
      didUpdatePostavke = true;
    }

    return tx.update(prejemniceTable).set(txUpdates)
      .where(and(eq(prejemniceTable.id, id), sql`true`, eq(prejemniceTable.enotaId, tenotaId)))
      .returning();
  });

  if (didUpdatePostavke) broadcast("update", { type: "zaloge" });

  const postavke = await db
    .select({
      id: prejemnicePostavkeTable.id,
      artikelId: prejemnicePostavkeTable.artikelId,
      artikelIme: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      kolicina: prejemnicePostavkeTable.kolicina,
      cenaKos: prejemnicePostavkeTable.cenaKos,
      skupaj: prejemnicePostavkeTable.skupaj,
      enotVPaketu: prejemnicePostavkeTable.enotVPaketu})
    .from(prejemnicePostavkeTable)
    .leftJoin(artikliTable, eq(prejemnicePostavkeTable.artikelId, artikliTable.id))
    .where(eq(prejemnicePostavkeTable.prejemnicaId, id));

  void artikelMap;
  res.json({
    id: updated.id,
    stevilka: updated.stevilka,
    datum: updated.datum,
    opomba: updated.opomba,
    vrstaCen: updated.vrstaCen ?? "neto",
    skupajVrednost: Number(updated.skupajVrednost),
    ustvarjeno: updated.ustvarjeno,
    postavke: postavke.map((p: any) => ({
      ...p,
      artikelIme: p.artikelIme ?? "–",
      kolicina: Number(p.kolicina),
      cenaKos: Number(p.cenaKos),
      skupaj: Number(p.skupaj),
      enotVPaketu: Number(p.enotVPaketu ?? 1)}))});
});

router.delete("/prejemnice/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [existing] = await db.select().from(prejemniceTable)
    .where(and(eq(prejemniceTable.id, id), sql`true`, eq(prejemniceTable.enotaId, tenotaId)));
  if (!existing) { res.status(404).json({ error: "Prejemnica ni najdena" }); return; }

  const postavke = await db.select().from(prejemnicePostavkeTable).where(eq(prejemnicePostavkeTable.prejemnicaId, id));
  const artikelIds = postavke.map((p: any) => p.artikelId).filter((aid: any) => aid != null) as number[];

  if (artikelIds.length > 0) {
    const negativni: { artikelId: number; artikelIme: string | null; projiciranKolicina: number }[] = [];

    for (const p of postavke) {
      const [totalRow] = await db
        .select({ vsota: sql<string>`COALESCE(SUM(${zalogaGibiTable.kolicina}), '0')` })
        .from(zalogaGibiTable)
        .where(eq(zalogaGibiTable.artikelId, p.artikelId));

      const [prejRow] = await db
        .select({ vsota: sql<string>`COALESCE(SUM(${zalogaGibiTable.kolicina}), '0')` })
        .from(zalogaGibiTable)
        .where(sql`${zalogaGibiTable.artikelId} = ${p.artikelId} AND ${zalogaGibiTable.referencaId} = ${id} AND ${zalogaGibiTable.tip} = 'prejemnica'`);

      const projicirana = Number(totalRow?.vsota ?? 0) - Number(prejRow?.vsota ?? 0);

      if (projicirana < 0) {
        const [art] = await db.select({ ime: artikliTable.ime }).from(artikliTable).where(eq(artikliTable.id, p.artikelId));
        negativni.push({ artikelId: p.artikelId, artikelIme: art?.ime ?? null, projiciranKolicina: projicirana });
      }
    }

    if (negativni.length > 0) {
      res.status(409).json({
        error: "Brisanje bi povzročilo negativne zaloge",
        prizadeti: negativni});
      return;
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(zalogaGibiTable).where(
      sql`${zalogaGibiTable.referencaId} = ${id} AND ${zalogaGibiTable.tip} = 'prejemnica'`
    );
    await tx.delete(prejemnicePostavkeTable).where(eq(prejemnicePostavkeTable.prejemnicaId, id));
    await tx.delete(uvozSejaTable).where(eq(uvozSejaTable.prejemnicaId, id));
    await tx.delete(prejemniceTable).where(and(eq(prejemniceTable.id, id), sql`true`, eq(prejemniceTable.enotaId, tenotaId)));

    await recomputeZaloge(artikelIds, tx);
  });

  broadcast("update", { type: "zaloge" });
  res.status(204).send();
});

export default router;
