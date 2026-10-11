import { Router, type IRouter } from "express";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { artikliTable, db, hitreOpombeTable, kategorijeTable } from "@workspace/db";
import { requirePosAdminRole } from "../../middlewares/pos";

const router: IRouter = Router();

const MAX_DOLZINA = 80;
const novaSchema = z.object({
  besedilo: z.string().trim().min(1).max(MAX_DOLZINA),
  kategorijaId: z.number().int().positive().nullable().optional(),
  artikelId: z.number().int().positive().nullable().optional(),
});

async function najdiArtikel(enotaId: number, artikelId: number) {
  const [artikel] = await db
    .select({ id: artikliTable.id, ime: artikliTable.ime, kategorijaId: artikliTable.kategorijaId, kategorijaIme: kategorijeTable.ime })
    .from(artikliTable)
    .leftJoin(kategorijeTable, eq(kategorijeTable.id, artikliTable.kategorijaId))
    .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)));
  return artikel ?? null;
}

/** Hitre opombe, ki veljajo za artikel (njegova kategorija ali vse kategorije). */
router.get("/hitre-opombe", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const artikelId = Number(req.query.artikelId);
  let pogoj = eq(hitreOpombeTable.enotaId, enotaId);
  if (Number.isInteger(artikelId) && artikelId > 0) {
    const artikel = await najdiArtikel(enotaId, artikelId);
    if (!artikel) { res.status(404).json({ error: "Artikel ni najden" }); return; }
    // Opomba je vezana na artikel (ali na izrecno izbrano kategorijo); zastareli splošni zapisi se ne ponujajo.
    pogoj = and(
      pogoj,
      artikel.kategorijaId == null
        ? eq(hitreOpombeTable.artikelId, artikelId)
        : or(
          eq(hitreOpombeTable.artikelId, artikelId),
          and(isNull(hitreOpombeTable.artikelId), eq(hitreOpombeTable.kategorijaId, artikel.kategorijaId)),
        ),
    )!;
  }
  const rows = await db.select().from(hitreOpombeTable).where(pogoj).orderBy(asc(hitreOpombeTable.id));
  res.json(rows.map(r => ({ id: r.id, besedilo: r.besedilo, kategorijaId: r.kategorijaId, artikelId: r.artikelId })));
});

router.post("/hitre-opombe", requirePosAdminRole, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const parsed = novaSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Neveljavna opomba" }); return; }
  const { besedilo, kategorijaId = null, artikelId = null } = parsed.data;
  if (artikelId != null && !(await najdiArtikel(enotaId, artikelId))) { res.status(404).json({ error: "Artikel ni najden" }); return; }
  if (kategorijaId != null) {
    const [kat] = await db.select({ id: kategorijeTable.id }).from(kategorijeTable)
      .where(and(eq(kategorijeTable.id, kategorijaId), eq(kategorijeTable.enotaId, enotaId)));
    if (!kat) { res.status(404).json({ error: "Kategorija ni najdena" }); return; }
  }
  const obstojece = await db.select().from(hitreOpombeTable).where(eq(hitreOpombeTable.enotaId, enotaId));
  const duplikat = obstojece.find(o => o.kategorijaId === kategorijaId && o.artikelId === artikelId && o.besedilo.toLowerCase() === besedilo.toLowerCase());
  if (duplikat) { res.json({ id: duplikat.id, besedilo: duplikat.besedilo, kategorijaId: duplikat.kategorijaId, artikelId: duplikat.artikelId }); return; }
  const [row] = await db.insert(hitreOpombeTable).values({ enotaId, besedilo, kategorijaId, artikelId }).returning();
  res.status(201).json({ id: row.id, besedilo: row.besedilo, kategorijaId: row.kategorijaId, artikelId: row.artikelId });
});

router.delete("/hitre-opombe/:id", requirePosAdminRole, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }
  const izbrisano = await db.delete(hitreOpombeTable)
    .where(and(eq(hitreOpombeTable.id, id), eq(hitreOpombeTable.enotaId, enotaId)))
    .returning({ id: hitreOpombeTable.id });
  if (!izbrisano.length) { res.status(404).json({ error: "Opomba ni najdena" }); return; }
  res.status(204).end();
});

/**
 * Predlogi opomb z AI. Rezultat je samo seznam besedil; nič se ne shrani, uporabnik vsak predlog potrdi.
 * Opombe o alergijah in zdravju model ne sme predlagati — alergeni ostanejo deterministični v artiklu.
 */
router.post("/hitre-opombe/predlogi", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const artikelId = Number(req.body?.artikelId);
  if (!Number.isInteger(artikelId) || artikelId <= 0) { res.status(400).json({ error: "Manjka artikel" }); return; }
  const artikel = await najdiArtikel(enotaId, artikelId);
  if (!artikel) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  const obstojece = await db.select({ besedilo: hitreOpombeTable.besedilo }).from(hitreOpombeTable)
    .where(eq(hitreOpombeTable.enotaId, enotaId));
  const izKosarice = Array.isArray(req.body?.zeVneseno) ? req.body.zeVneseno.filter((x: unknown) => typeof x === "string").slice(0, 10) : [];

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      system: [
        "Predlagaj do 6 kratkih slovenskih opomb za natakarja pri naročilu gostinskega artikla (npr. 'z ledom', 'brez sladkorja', 'srednje pečen').",
        "Vsaka opomba ima največ 40 znakov in opisuje pripravo ali postrežbo.",
        "Ne predlagaj opomb o alergijah, intoleranci, zdravju ali sestavinah, ki zagotavljajo varnost.",
        "Ne ponavljaj že obstoječih opomb. Če ne veš, vrni prazen seznam.",
      ].join(" "),
      messages: [{
        role: "user",
        content: JSON.stringify({
          artikel: artikel.ime,
          kategorija: artikel.kategorijaIme,
          obstojeceOpombe: obstojece.map(o => o.besedilo).slice(0, 40),
          zeVneseno: izKosarice,
        }),
      }],
      tools: [{
        name: "predlagaj_opombe",
        description: "Vrne seznam predlaganih opomb.",
        input_schema: {
          type: "object",
          properties: { opombe: { type: "array", items: { type: "string" }, maxItems: 6 } },
          required: ["opombe"],
        },
      }],
      tool_choice: { type: "tool", name: "predlagaj_opombe" },
    });
    const tool = response.content.find(c => c.type === "tool_use");
    const surove = tool && tool.type === "tool_use" ? (tool.input as { opombe?: unknown }).opombe : [];
    const zavrni = /alerg|intoler|celiak|gluten|laktoz|orešč|zdravj/i;
    const prepoved = new Set([...obstojece.map(o => o.besedilo), ...izKosarice].map((s: string) => s.toLowerCase()));
    const predlogi = (Array.isArray(surove) ? surove : [])
      .filter((s): s is string => typeof s === "string")
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.length <= 40 && !zavrni.test(s) && !prepoved.has(s.toLowerCase()))
      .slice(0, 6);
    res.json({ predlogi });
  } catch {
    res.status(502).json({ error: "Predlogov AI trenutno ni mogoče pridobiti" });
  }
});

export default router;
