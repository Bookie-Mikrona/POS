import { Router, type IRouter, type Response } from "express";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db, narocilaTable, narocnikNasloviTable, narocnikiTable, naseljaTable } from "@workspace/db";
import { z } from "zod";
import { normalizirajTelefon } from "../../lib/narocniki-telefon";

const router: IRouter = Router();

const createNarocnikSchema = z.object({
  ime: z.string().trim().min(1).max(160),
  telefon: z.string().trim().min(1).max(40),
  email: z.string().trim().email().max(254).nullable().optional(),
  opombe: z.string().trim().max(2000).nullable().optional(),
});

const updateNarocnikSchema = createNarocnikSchema.partial();

const createNaslovSchema = z.object({
  ulica: z.string().trim().min(1).max(160),
  hisnaStevilka: z.string().trim().min(1).max(40),
  vhod: z.string().trim().max(40).nullable().optional(),
  nadstropje: z.string().trim().max(40).nullable().optional(),
  naseljeId: z.coerce.number().int().positive(),
  navodilo: z.string().trim().max(2000).nullable().optional(),
  privzet: z.boolean().default(false),
});

const updateNaslovSchema = createNaslovSchema.partial();

function idParam(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}

function mapNarocnik(row: typeof narocnikiTable.$inferSelect, naslovi?: ReturnType<typeof mapNaslov>[]) {
  return {
    ...row,
    naslovi: naslovi ?? [],
  };
}

function mapNaslov(row: {
  id: number;
  narocnikId: number;
  ulica: string;
  hisnaStevilka: string;
  vhod: string | null;
  nadstropje: string | null;
  naseljeId: number;
  navodilo: string | null;
  privzet: boolean;
  ustvarjeno: Date;
  posodobljeno: Date;
  naseljeNaziv: string | null;
  naseljeAktivno: boolean | null;
}) {
  return {
    id: row.id,
    narocnikId: row.narocnikId,
    ulica: row.ulica,
    hisnaStevilka: row.hisnaStevilka,
    vhod: row.vhod,
    nadstropje: row.nadstropje,
    naseljeId: row.naseljeId,
    navodilo: row.navodilo,
    privzet: row.privzet,
    ustvarjeno: row.ustvarjeno,
    posodobljeno: row.posodobljeno,
    naselje: row.naseljeNaziv == null ? null : {
      id: row.naseljeId,
      naziv: row.naseljeNaziv,
      aktivno: row.naseljeAktivno,
    },
  };
}

export async function getNaslovi(narocnikId: number, enotaId: number) {
  const rows = await db.select({
    id: narocnikNasloviTable.id,
    narocnikId: narocnikNasloviTable.narocnikId,
    ulica: narocnikNasloviTable.ulica,
    hisnaStevilka: narocnikNasloviTable.hisnaStevilka,
    vhod: narocnikNasloviTable.vhod,
    nadstropje: narocnikNasloviTable.nadstropje,
    naseljeId: narocnikNasloviTable.naseljeId,
    navodilo: narocnikNasloviTable.navodilo,
    privzet: narocnikNasloviTable.privzet,
    ustvarjeno: narocnikNasloviTable.ustvarjeno,
    posodobljeno: narocnikNasloviTable.posodobljeno,
    naseljeNaziv: naseljaTable.naziv,
    naseljeAktivno: naseljaTable.aktivno,
  }).from(narocnikNasloviTable)
    .innerJoin(narocnikiTable, eq(narocnikNasloviTable.narocnikId, narocnikiTable.id))
    .leftJoin(naseljaTable, eq(narocnikNasloviTable.naseljeId, naseljaTable.id))
    .where(and(
      eq(narocnikNasloviTable.narocnikId, narocnikId),
      eq(narocnikiTable.enotaId, enotaId),
    ))
    .orderBy(desc(narocnikNasloviTable.privzet), asc(narocnikNasloviTable.id));
  return rows.map(mapNaslov);
}

async function getNarocnik(narocnikId: number, enotaId: number) {
  const [row] = await db.select().from(narocnikiTable).where(and(
    eq(narocnikiTable.id, narocnikId),
    eq(narocnikiTable.enotaId, enotaId),
  ));
  return row ?? null;
}

async function preveriNaselje(naseljeId: number, enotaId: number) {
  const [row] = await db.select().from(naseljaTable).where(and(
    eq(naseljaTable.id, naseljeId),
    eq(naseljaTable.enotaId, enotaId),
    eq(naseljaTable.aktivno, true),
  ));
  return row ?? null;
}

async function vrniNarocnika(res: Response, row: typeof narocnikiTable.$inferSelect, enotaId: number) {
  res.json(mapNarocnik(row, await getNaslovi(row.id, enotaId)));
}

// Ta pot mora biti pred /narocniki/:id, sicer bi "po-telefonu" postalo ID.
router.get("/narocniki/po-telefonu", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const telefon = typeof req.query.telefon === "string" ? req.query.telefon : "";
  let telefonNormaliziran: string;
  try {
    telefonNormaliziran = normalizirajTelefon(telefon);
  } catch {
    res.status(400).json({ error: "Telefonska številka ni veljavna" });
    return;
  }
  const [row] = await db.select().from(narocnikiTable).where(and(
    eq(narocnikiTable.enotaId, enotaId),
    eq(narocnikiTable.telefonNormaliziran, telefonNormaliziran),
  ));
  if (!row) {
    res.status(404).json({ error: "Naročnik ni najden" });
    return;
  }
  await vrniNarocnika(res, row, enotaId);
});

router.get("/narocniki", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const rows = await db.select().from(narocnikiTable)
    .where(eq(narocnikiTable.enotaId, enotaId))
    .orderBy(asc(narocnikiTable.ime), asc(narocnikiTable.id));
  res.json(rows.map((row) => mapNarocnik(row)));
});

router.get("/narocniki/:id", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const id = idParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Neveljaven ID naročnika" });
    return;
  }
  const row = await getNarocnik(id, enotaId);
  if (!row) {
    res.status(404).json({ error: "Naročnik ni najden" });
    return;
  }
  await vrniNarocnika(res, row, enotaId);
});

router.get("/narocniki/:id/narocila", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const narocnikId = idParam(req.params.id);
  if (!narocnikId) {
    res.status(400).json({ error: "Neveljaven ID naročnika" });
    return;
  }
  if (!await getNarocnik(narocnikId, enotaId)) {
    res.status(404).json({ error: "Naročnik ni najden" });
    return;
  }

  const rows = await db.select({
    id: narocilaTable.id,
    stevilkaNarocila: narocilaTable.stevilkaNarocila,
    status: narocilaTable.status,
    skupaj: narocilaTable.skupaj,
    nacin: narocilaTable.nacin,
    nacinIzpolnitve: narocilaTable.nacinIzpolnitve,
    strankaIme: narocilaTable.strankaIme,
    strankaTelefon: narocilaTable.strankaTelefon,
    predvidenPrevzem: narocilaTable.predvidenPrevzem,
    predvidenaDostava: narocilaTable.predvidenaDostava,
    ustvarjeno: narocilaTable.ustvarjeno,
  }).from(narocilaTable)
    .where(and(
      eq(narocilaTable.narocnikId, narocnikId),
      eq(narocilaTable.enotaId, enotaId),
    ))
    .orderBy(desc(narocilaTable.ustvarjeno), desc(narocilaTable.id));

  res.json(rows.map((row) => ({
    ...row,
    skupaj: Number(row.skupaj),
    predvidenPrevzem: row.predvidenPrevzem?.toISOString() ?? null,
    predvidenaDostava: row.predvidenaDostava?.toISOString() ?? null,
    ustvarjeno: row.ustvarjeno.toISOString(),
  })));
});

router.post("/narocniki", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const parsed = createNarocnikSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Napačni podatki naročnika", details: parsed.error.flatten() });
    return;
  }
  let telefonNormaliziran: string;
  try {
    telefonNormaliziran = normalizirajTelefon(parsed.data.telefon);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Telefonska številka ni veljavna" });
    return;
  }
  const [existing] = await db.select({ id: narocnikiTable.id }).from(narocnikiTable).where(and(
    eq(narocnikiTable.enotaId, enotaId),
    eq(narocnikiTable.telefonNormaliziran, telefonNormaliziran),
  ));
  if (existing) {
    res.status(409).json({ error: "Naročnik s to telefonsko številko že obstaja" });
    return;
  }
  try {
    const [row] = await db.insert(narocnikiTable).values({
      enotaId,
      ime: parsed.data.ime,
      telefon: parsed.data.telefon.trim(),
      telefonNormaliziran,
      email: parsed.data.email ?? null,
      opombe: parsed.data.opombe ?? null,
    }).returning();
    res.status(201);
    await vrniNarocnika(res, row, enotaId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "Naročnik s to telefonsko številko že obstaja" });
      return;
    }
    throw error;
  }
});

router.put("/narocniki/:id", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const id = idParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Neveljaven ID naročnika" });
    return;
  }
  const parsed = updateNarocnikSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Napačni podatki naročnika", details: parsed.error.flatten() });
    return;
  }
  const existing = await getNarocnik(id, enotaId);
  if (!existing) {
    res.status(404).json({ error: "Naročnik ni najden" });
    return;
  }
  const updates: Partial<typeof narocnikiTable.$inferInsert> = {};
  if (parsed.data.ime !== undefined) updates.ime = parsed.data.ime;
  if (parsed.data.email !== undefined) updates.email = parsed.data.email;
  if (parsed.data.opombe !== undefined) updates.opombe = parsed.data.opombe;
  if (parsed.data.telefon !== undefined) {
    try {
      updates.telefonNormaliziran = normalizirajTelefon(parsed.data.telefon);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Telefonska številka ni veljavna" });
      return;
    }
    updates.telefon = parsed.data.telefon.trim();
  }
  try {
    const [row] = await db.update(narocnikiTable).set(updates).where(and(
      eq(narocnikiTable.id, id),
      eq(narocnikiTable.enotaId, enotaId),
    )).returning();
    if (!row) {
      res.status(404).json({ error: "Naročnik ni najden" });
      return;
    }
    await vrniNarocnika(res, row, enotaId);
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({ error: "Naročnik s to telefonsko številko že obstaja" });
      return;
    }
    throw error;
  }
});

router.delete("/narocniki/:id", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const id = idParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Neveljaven ID naročnika" });
    return;
  }
  const [row] = await db.delete(narocnikiTable).where(and(
    eq(narocnikiTable.id, id),
    eq(narocnikiTable.enotaId, enotaId),
  )).returning({ id: narocnikiTable.id });
  if (!row) {
    res.status(404).json({ error: "Naročnik ni najden" });
    return;
  }
  res.sendStatus(204);
});

router.get("/narocniki/:id/naslovi", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const narocnikId = idParam(req.params.id);
  if (!narocnikId) {
    res.status(400).json({ error: "Neveljaven ID naročnika" });
    return;
  }
  if (!await getNarocnik(narocnikId, enotaId)) {
    res.status(404).json({ error: "Naročnik ni najden" });
    return;
  }
  res.json(await getNaslovi(narocnikId, enotaId));
});

router.post("/narocniki/:id/naslovi", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const narocnikId = idParam(req.params.id);
  if (!narocnikId) {
    res.status(400).json({ error: "Neveljaven ID naročnika" });
    return;
  }
  if (!await getNarocnik(narocnikId, enotaId)) {
    res.status(404).json({ error: "Naročnik ni najden" });
    return;
  }
  const parsed = createNaslovSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Napačni podatki dostavnega naslova", details: parsed.error.flatten() });
    return;
  }
  if (!await preveriNaselje(parsed.data.naseljeId, enotaId)) {
    res.status(404).json({ error: "Naselje ni najdeno ali ni aktivno v izbrani enoti" });
    return;
  }
  const row = await db.transaction(async (tx) => {
    if (parsed.data.privzet) {
      await tx.update(narocnikNasloviTable).set({ privzet: false })
        .where(eq(narocnikNasloviTable.narocnikId, narocnikId));
    }
    const [inserted] = await tx.insert(narocnikNasloviTable).values({
      narocnikId,
      ulica: parsed.data.ulica,
      hisnaStevilka: parsed.data.hisnaStevilka,
      vhod: parsed.data.vhod ?? null,
      nadstropje: parsed.data.nadstropje ?? null,
      naseljeId: parsed.data.naseljeId,
      navodilo: parsed.data.navodilo ?? null,
      privzet: parsed.data.privzet,
    }).returning();
    return inserted;
  });
  const mapped = (await getNaslovi(narocnikId, enotaId)).find((naslov) => naslov.id === row.id);
  if (!mapped) throw new Error("Dodanega dostavnega naslova ni mogoče prebrati");
  res.status(201).json(mapped);
});

router.put("/narocniki/:id/naslovi/:naslovId", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const narocnikId = idParam(req.params.id);
  const naslovId = idParam(req.params.naslovId);
  if (!narocnikId || !naslovId) {
    res.status(400).json({ error: "Neveljaven ID naročnika ali naslova" });
    return;
  }
  if (!await getNarocnik(narocnikId, enotaId)) {
    res.status(404).json({ error: "Naročnik ni najden" });
    return;
  }
  const parsed = updateNaslovSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Napačni podatki dostavnega naslova", details: parsed.error.flatten() });
    return;
  }
  const [existing] = await db.select().from(narocnikNasloviTable)
    .where(and(
      eq(narocnikNasloviTable.id, naslovId),
      eq(narocnikNasloviTable.narocnikId, narocnikId),
    ));
  if (!existing) {
    res.status(404).json({ error: "Dostavni naslov ni najden" });
    return;
  }
  if (parsed.data.naseljeId !== undefined && !await preveriNaselje(parsed.data.naseljeId, enotaId)) {
    res.status(404).json({ error: "Naselje ni najdeno ali ni aktivno v izbrani enoti" });
    return;
  }
  const updates: Partial<typeof narocnikNasloviTable.$inferInsert> = {};
  if (parsed.data.ulica !== undefined) updates.ulica = parsed.data.ulica;
  if (parsed.data.hisnaStevilka !== undefined) updates.hisnaStevilka = parsed.data.hisnaStevilka;
  if (parsed.data.vhod !== undefined) updates.vhod = parsed.data.vhod;
  if (parsed.data.nadstropje !== undefined) updates.nadstropje = parsed.data.nadstropje;
  if (parsed.data.naseljeId !== undefined) updates.naseljeId = parsed.data.naseljeId;
  if (parsed.data.navodilo !== undefined) updates.navodilo = parsed.data.navodilo;
  if (parsed.data.privzet !== undefined) updates.privzet = parsed.data.privzet;

  await db.transaction(async (tx) => {
    if (parsed.data.privzet) {
      await tx.update(narocnikNasloviTable).set({ privzet: false }).where(and(
        eq(narocnikNasloviTable.narocnikId, narocnikId),
        ne(narocnikNasloviTable.id, naslovId),
      ));
    }
    await tx.update(narocnikNasloviTable).set(updates).where(and(
      eq(narocnikNasloviTable.id, naslovId),
      eq(narocnikNasloviTable.narocnikId, narocnikId),
    ));
  });
  const updated = (await getNaslovi(narocnikId, enotaId)).find((row) => row.id === naslovId);
  res.json(updated);
});

router.delete("/narocniki/:id/naslovi/:naslovId", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const narocnikId = idParam(req.params.id);
  const naslovId = idParam(req.params.naslovId);
  if (!narocnikId || !naslovId) {
    res.status(400).json({ error: "Neveljaven ID naročnika ali naslova" });
    return;
  }
  if (!await getNarocnik(narocnikId, enotaId)) {
    res.status(404).json({ error: "Naročnik ni najden" });
    return;
  }
  const [row] = await db.delete(narocnikNasloviTable).where(and(
    eq(narocnikNasloviTable.id, naslovId),
    eq(narocnikNasloviTable.narocnikId, narocnikId),
  )).returning({ id: narocnikNasloviTable.id });
  if (!row) {
    res.status(404).json({ error: "Dostavni naslov ni najden" });
    return;
  }
  res.sendStatus(204);
});

export default router;