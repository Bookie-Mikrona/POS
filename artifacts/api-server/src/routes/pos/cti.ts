import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, desc, eq, gte, isNotNull } from "drizzle-orm";
import { ctiDohodniKliciTable, db, enoteTable, narocnikiTable } from "@workspace/db";
import { z } from "zod";
import { normalizirajTelefon } from "../../lib/narocniki-telefon";
import type { PosRequest } from "../../middlewares/pos";

const incomingRouter: IRouter = Router();
const authenticatedRouter: IRouter = Router();
const incomingSchema = z.object({
  telefon: z.string().trim().min(1).max(40),
});

function idParam(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function novCtiToken(): string {
  // 256 bit entropije, base64url brez znakov, ki bi jih MacroDroid URL-enkodiral.
  return randomBytes(32).toString("base64url");
}

function requireCtiTokenAdmin(req: Request, res: Response, next: NextFunction): void {
  const vloga = (req as PosRequest).vloga;
  if (vloga !== "admin" && vloga !== "admin_enote" && vloga !== "superadmin") {
    res.status(403).json({ napaka: "Upravljanje CTI žetona je dovoljeno samo administratorju enote" });
    return;
  }
  next();
}

/**
 * Žetone preverimo v aplikaciji s timingSafeEqual, namesto z navadno SQL
 * primerjavo. Tako je vsak žeton poverilnica točno ene aktivne enote.
 */
async function poisciEnotoPoCtiTokenu(token: string): Promise<{ id: number } | null> {
  const enote = await db.select({ id: enoteTable.id, ctiToken: enoteTable.ctiToken })
    .from(enoteTable)
    .where(and(eq(enoteTable.aktiven, true), isNotNull(enoteTable.ctiToken)));
  const received = Buffer.from(token, "utf8");
  let najdena: { id: number } | null = null;
  for (const enota of enote) {
    if (enota.ctiToken == null) continue;
    const expected = Buffer.from(enota.ctiToken, "utf8");
    const match = expected.length === received.length && timingSafeEqual(expected, received);
    if (match) najdena = { id: enota.id };
  }
  return najdena;
}

incomingRouter.post("/cti/dohodni-klic", async (req: Request, res: Response): Promise<void> => {
  const token = req.get("X-CTI-Token");
  if (!token) {
    res.status(401).json({ error: "Manjka glava X-CTI-Token" });
    return;
  }

  const enota = await poisciEnotoPoCtiTokenu(token);
  if (!enota) {
    res.status(401).json({ error: "Neveljaven CTI žeton" });
    return;
  }

  const parsed = incomingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Neveljaven CTI klic", details: parsed.error.flatten() });
    return;
  }

  let telefonNormaliziran: string;
  try {
    telefonNormaliziran = normalizirajTelefon(parsed.data.telefon);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Telefonska številka ni veljavna" });
    return;
  }

  const [narocnik] = await db.select({ id: narocnikiTable.id })
    .from(narocnikiTable)
    .where(and(
      eq(narocnikiTable.enotaId, enota.id),
      eq(narocnikiTable.telefonNormaliziran, telefonNormaliziran),
    ))
    .limit(1);

  const [klic] = await db.insert(ctiDohodniKliciTable).values({
    enotaId: enota.id,
    telefon: parsed.data.telefon.trim(),
    telefonNormaliziran,
    narocnikId: narocnik?.id ?? null,
  }).returning({ id: ctiDohodniKliciTable.id, prejeto: ctiDohodniKliciTable.prejeto });

  res.status(200).json({ id: klic.id, prejeto: klic.prejeto, narocnikId: narocnik?.id ?? null });
});

authenticatedRouter.post("/cti/token/generiraj", requireCtiTokenAdmin, async (req: Request, res: Response): Promise<void> => {
  const enotaId = (req as PosRequest).enotaId;
  const [enota] = await db.update(enoteTable)
    .set({ ctiToken: novCtiToken() })
    .where(and(eq(enoteTable.id, enotaId), eq(enoteTable.aktiven, true)))
    .returning({ ctiToken: enoteTable.ctiToken });
  if (!enota) {
    res.status(404).json({ napaka: "Aktivna poslovna enota ni najdena" });
    return;
  }
  res.json({ ctiToken: enota.ctiToken ?? "" });
});

authenticatedRouter.get("/cti/token", requireCtiTokenAdmin, async (req: Request, res: Response): Promise<void> => {
  const enotaId = (req as PosRequest).enotaId;
  const [enota] = await db.select({ ctiToken: enoteTable.ctiToken })
    .from(enoteTable)
    .where(and(eq(enoteTable.id, enotaId), eq(enoteTable.aktiven, true)))
    .limit(1);
  res.json({ ctiToken: enota?.ctiToken ?? "" });
});

authenticatedRouter.get("/cti/aktivni-klici", async (req: Request, res: Response): Promise<void> => {
  const enotaId = (req as PosRequest).enotaId;
  const recentSince = new Date(Date.now() - 2 * 60 * 1000);
  const rows = await db.select({
    id: ctiDohodniKliciTable.id,
    telefon: ctiDohodniKliciTable.telefon,
    prejeto: ctiDohodniKliciTable.prejeto,
    narocnikId: ctiDohodniKliciTable.narocnikId,
    narocnikIme: narocnikiTable.ime,
  }).from(ctiDohodniKliciTable)
    .leftJoin(narocnikiTable, eq(ctiDohodniKliciTable.narocnikId, narocnikiTable.id))
    .where(and(
      eq(ctiDohodniKliciTable.enotaId, enotaId),
      eq(ctiDohodniKliciTable.obravnavano, false),
      gte(ctiDohodniKliciTable.prejeto, recentSince),
    ))
    .orderBy(desc(ctiDohodniKliciTable.prejeto));
  res.json(rows);
});

authenticatedRouter.post("/cti/klici/:id/obravnavano", async (req: Request, res: Response): Promise<void> => {
  const id = idParam(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Neveljaven ID klica" });
    return;
  }
  const enotaId = (req as PosRequest).enotaId;
  const [updated] = await db.update(ctiDohodniKliciTable)
    .set({ obravnavano: true })
    .where(and(eq(ctiDohodniKliciTable.id, id), eq(ctiDohodniKliciTable.enotaId, enotaId)))
    .returning({ id: ctiDohodniKliciTable.id });
  if (!updated) {
    res.status(404).json({ error: "CTI klic ni najden" });
    return;
  }
  res.json({ id: updated.id, obravnavano: true });
});

export { incomingRouter as ctiIncomingRouter };
export default authenticatedRouter;