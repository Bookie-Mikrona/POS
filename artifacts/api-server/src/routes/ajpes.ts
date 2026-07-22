/**
 * AJPES Poslovni register Slovenije — sinhronizacija in iskanje.
 *
 * POST /api/ajpes/sync        — prenese in shrani OPSI javni CSV (~127 MB, traja 2–5 min)
 * GET  /api/ajpes/status      — datum zadnjega uvoza in število vnosov
 * GET  /api/ajpes/poisci      — poišče subjekt po matični številki
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, or, sql } from "drizzle-orm";
import { db, ajpesSubjektiTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Javni CSV iz OPSI (Odprti podatki Slovenije) — licenca CC BY 4.0
// Format: UTF-16 LE, vejice, narekovaji
// Stolpci: maticna, naziv, HSEID, pravnaOblika, registrOrgan, ulica, hisnaSt, hisnaDod, naselje, postnaSt, posta, drzava
const AJPES_OPSI_URL =
  "https://podatki.gov.si/dataset/9ee1a9aa-c224-4995-b2ad-3760d7af0748/resource/beb70929-3d0d-41c6-9af2-25d525d906d3/download/opsiprs.csv";

// ── Skupna pomožna funkcija ────────────────────────────────────────────────────

export interface AjpesNajden {
  maticnaSt: string;
  naziv: string;
  ulica: string | null;
  hisnaSt: string | null;
  naselje: string | null;
  postnaStevilka: string | null;
  posta: string | null;
  drzava: string | null;
  email: string | null;
  telefon: string | null;
  www: string | null;
  pravnaOblika: string | null;
}

/**
 * Normalizira matično številko za AJPES iskanje.
 * OPSI shranjuje 10-mestno (npr. "5000018000"), Inetis vrne 7-mestno ("5000018").
 */
function normalizeMaticna(m: string): string {
  return m.trim().replace(/0+$/, "") || m.trim();
}

/** Razčleni eno vrstico CSV (narekovaji, vejica). */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { field += '"'; i++; }
      else { inQuote = !inQuote; }
    } else if (ch === "," && !inQuote) {
      fields.push(field); field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/** Poišče subjekt v AJPES bazi po matični številki (7- ali 10-mestna oblika). */
export async function poisciVAjpes(maticnaSt?: string | null): Promise<AjpesNajden | null> {
  if (!maticnaSt?.trim()) return null;
  const m7 = normalizeMaticna(maticnaSt);      // 7-mestna: "5000018"
  const m10 = m7.padEnd(10, "0");              // 10-mestna: "5000018000"

  const rows = await db
    .select()
    .from(ajpesSubjektiTable)
    .where(or(
      eq(ajpesSubjektiTable.maticnaSt, m7),
      eq(ajpesSubjektiTable.maticnaSt, m10),
      eq(ajpesSubjektiTable.maticnaSt, maticnaSt.trim()),
    ))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    maticnaSt: r.maticnaSt,
    naziv: r.naziv,
    ulica: r.ulica ?? null,
    hisnaSt: r.hisnaSt ?? null,
    naselje: r.naselje ?? null,
    postnaStevilka: r.postnaStevilka ?? null,
    posta: r.posta ?? null,
    drzava: r.drzava ?? null,
    email: r.email ?? null,
    telefon: r.telefon ?? null,
    www: r.www ?? null,
    pravnaOblika: r.pravnaOblika ?? null,
  };
}

// ── POST /api/ajpes/sync ──────────────────────────────────────────────────────

router.post("/ajpes/sync", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  // Prenos datoteke (127 MB — do 5 minut)
  let rawBuffer: Buffer;
  try {
    const r = await fetch(AJPES_OPSI_URL, { signal: AbortSignal.timeout(300_000) });
    if (!r.ok) throw new Error(`AJPES OPSI HTTP ${r.status}`);
    rawBuffer = Buffer.from(await r.arrayBuffer());
  } catch (err) {
    res.status(502).json({ error: `Prenos iz AJPES OPSI ni uspel: ${err instanceof Error ? err.message : err}` });
    return;
  }

  // Dekodiranje UTF-16 LE (z BOM)
  let text = rawBuffer.toString("utf16le");
  if (text.startsWith("\uFEFF")) text = text.slice(1); // odstrani BOM

  const now = new Date();
  const batchSize = 500;
  let uvozenih = 0;

  try {
    // Truncate + vstavi v eni transakciji (atomično)
    await db.transaction(async tx => {
      await tx.delete(ajpesSubjektiTable);

      let lineStart = 0;
      let lineEnd = text.indexOf("\n");
      let isHeader = true;
      const batch: Array<{
        maticnaSt: string; naziv: string; skrajsanoIme: null;
        ulica: string | null; hisnaSt: string | null; naselje: string | null;
        postnaStevilka: string | null; posta: string | null; drzava: string | null;
        email: null; telefon: null; www: null;
        pravnaOblika: string | null; zadnjiUvoz: Date;
      }> = [];

      const flush = async () => {
        if (batch.length === 0) return;
        await tx.insert(ajpesSubjektiTable).values([...batch]);
        uvozenih += batch.length;
        batch.length = 0;
      };

      while (lineStart < text.length) {
        const end = lineEnd === -1 ? text.length : lineEnd;
        const line = text.slice(lineStart, end).replace(/\r$/, "");
        lineStart = end + 1;
        lineEnd = text.indexOf("\n", lineStart);

        if (isHeader) { isHeader = false; continue; }
        if (!line.trim()) continue;

        const f = parseCSVLine(line);
        if (f.length < 10 || !f[0]?.trim() || !f[1]?.trim()) continue;

        batch.push({
          maticnaSt: f[0].trim(),
          naziv: f[1].trim(),
          skrajsanoIme: null,
          ulica: f[5]?.trim() || null,
          hisnaSt: f[6]?.trim() || null,
          naselje: f[8]?.trim() || null,
          postnaStevilka: f[9]?.trim() || null,
          posta: f[10]?.trim() || null,
          drzava: f[11]?.trim() || null,
          email: null,
          telefon: null,
          www: null,
          pravnaOblika: f[3]?.trim() || null,
          zadnjiUvoz: now,
        });

        if (batch.length >= batchSize) await flush();
      }

      await flush();
    });
  } catch (err) {
    res.status(500).json({ error: `Uvoz ni uspel: ${err instanceof Error ? err.message : err}` });
    return;
  }

  res.json({ uvozenih, datum: now.toISOString().slice(0, 10) });
});

// ── GET /api/ajpes/status ─────────────────────────────────────────────────────

router.get("/ajpes/status", requireAuth, async (_req: Request, res: Response): Promise<void> => {
  const [row] = await db
    .select({
      skupaj: sql<number>`count(*)::int`,
      zadnjiUvoz: sql<string>`max(${ajpesSubjektiTable.zadnjiUvoz})`,
    })
    .from(ajpesSubjektiTable);

  res.json({
    skupaj: row?.skupaj ?? 0,
    zadnjiUvoz: row?.zadnjiUvoz ?? null,
  });
});

// ── GET /api/ajpes/poisci?maticna= ────────────────────────────────────────────

router.get("/ajpes/poisci", requireAuth, async (req: Request, res: Response): Promise<void> => {
  const maticna = typeof req.query.maticna === "string" ? req.query.maticna.trim() : null;
  if (!maticna) {
    res.status(400).json({ error: "Podajte matično številko (maticna)." });
    return;
  }
  const najden = await poisciVAjpes(maticna);
  if (!najden) {
    res.json(null);
    return;
  }
  res.json(najden);
});

export default router;
