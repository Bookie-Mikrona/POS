/**
 * Test-only re-export za resolveEncodingFromSettings.
 * Ne uvozite v produkcijsko kodo.
 *
 * Mora ostati v sinhronizaciji z resolveEncodingFromSettings v racuni.ts.
 */
import { db } from "@workspace/db";
import { napraveTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";

type TiskalnikEncoding = "cp1250" | "wpc1250" | "cp852" | "ascii-translit" | "bitmap";

export async function resolveEncodingForTest(
  enotaId: number,
  napravaId?: number,
): Promise<{ encoding: TiskalnikEncoding; cols: number }> {
  let cols = 32;
  let encoding: TiskalnikEncoding = "cp1250";

  if (napravaId != null) {
    // ── Per-naprava pot ────────────────────────────────────────────────────
    const rows = await db
      .select({ nastavitveJson: napraveTable.nastavitveJson })
      .from(napraveTable)
      .where(and(eq(napraveTable.id, napravaId), eq(napraveTable.enotaId, enotaId)))
      .limit(1);
    const row = rows[0];
    if (row?.nastavitveJson) {
      try {
        const cfg = JSON.parse(row.nastavitveJson) as Record<string, unknown>;
        if (Number(cfg.tiskalnikSirina) === 80) cols = 40;
        else if (Number(cfg.tiskalnikSirina) === 30) cols = 30;
        if (cfg.tiskalnikCodePage === "cp852") encoding = "cp852";
        else if (cfg.tiskalnikCodePage === "wpc1250") encoding = "wpc1250";
        else if (cfg.tiskalnikCodePage === "ascii-translit") encoding = "ascii-translit";
        else if (cfg.tiskalnikCodePage === "bitmap") encoding = "bitmap";
        else if (cfg.tiskalnikCodePage === "cp1250") encoding = "cp1250";
      } catch { /* pokvarjen JSON → privzetki */ }
    }
    return { encoding, cols };
  }

  // ── Brez napravaId: stara logika ──────────────────────────────────────
  let fallbackEncoding: TiskalnikEncoding | null = null;
  const vseNaprave = await db
    .select({ nastavitveJson: napraveTable.nastavitveJson })
    .from(napraveTable)
    .where(eq(napraveTable.enotaId, enotaId));
  for (const row of vseNaprave) {
    if (!row.nastavitveJson) continue;
    try {
      const cfg = JSON.parse(row.nastavitveJson) as Record<string, unknown>;
      if (cfg.agentTiskalnikIme) {
        if (Number(cfg.tiskalnikSirina) === 80) cols = 40;
        if (cfg.tiskalnikCodePage === "cp852") encoding = "cp852";
        else if (cfg.tiskalnikCodePage === "wpc1250") encoding = "wpc1250";
        else if (cfg.tiskalnikCodePage === "ascii-translit") encoding = "ascii-translit";
        else if (cfg.tiskalnikCodePage === "bitmap") encoding = "bitmap";
        return { encoding, cols };
      }
      if (fallbackEncoding === null && cfg.tiskalnikCodePage) {
        const cp = cfg.tiskalnikCodePage as string;
        if (cp === "cp852" || cp === "wpc1250" || cp === "ascii-translit" || cp === "bitmap") fallbackEncoding = cp as TiskalnikEncoding;
        else if (cp === "cp1250") fallbackEncoding = "cp1250";
      }
    } catch { /* preskoči */ }
  }
  if (fallbackEncoding !== null) encoding = fallbackEncoding;
  return { encoding, cols };
}
