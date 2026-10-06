/**
 * Explicit, idempotent migration of only Mikrona SMTP host/port settings.
 * Default: read-only preview. Run with --apply to commit. Never reads credentials.
 */
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

async function migrate() {
  const apply = process.argv.includes("--apply");
  return db.transaction(async tx => {
    if (apply) await tx.execute(sql`LOCK TABLE nastavitve IN SHARE ROW EXCLUSIVE MODE`);
    const matched = await tx.execute<{
      id: number; enotaId: number; host: string; port: string | null;
    } & Record<string, unknown>>(sql`
      SELECT h.id, h.enota_id AS "enotaId", h.vrednost AS host, p.vrednost AS port
      FROM nastavitve h
      LEFT JOIN nastavitve p ON p.enota_id=h.enota_id AND p.kljuc='smtpPort'
      WHERE h.kljuc='smtpHost'
        AND lower(btrim(h.vrednost)) IN ('195.206.229.180','195.206.229.181','mail.mikrona.si','mikrona.si')
    `);
    const summary = {
      mode: apply ? "apply" : "preview",
      matchedConfigurations: matched.rows.length,
      changedConfigurations: matched.rows.filter(r => r.host !== "mail.mikrona.si" || r.port !== "465").length,
      hostRowsChanged: 0,
      portRowsWritten: 0,
      rowsChanged: 0,
    };
    if (!apply || !matched.rows.length) return summary;
    const hosts = await tx.execute(sql`
      UPDATE nastavitve SET vrednost='mail.mikrona.si', posodobljeno=now()
      WHERE kljuc='smtpHost'
        AND lower(btrim(vrednost)) IN ('195.206.229.180','195.206.229.181','mail.mikrona.si','mikrona.si')
        AND vrednost IS DISTINCT FROM 'mail.mikrona.si'
      RETURNING id
    `);
    const ports = await tx.execute(sql`
      INSERT INTO nastavitve (enota_id, kljuc, vrednost, posodobljeno)
      SELECT enota_id, 'smtpPort', '465', now() FROM nastavitve
      WHERE kljuc='smtpHost' AND lower(btrim(vrednost)) IN
        ('195.206.229.180','195.206.229.181','mail.mikrona.si','mikrona.si')
      ON CONFLICT (enota_id, kljuc) DO UPDATE SET vrednost='465', posodobljeno=now()
      WHERE nastavitve.vrednost IS DISTINCT FROM '465'
      RETURNING id
    `);
    summary.hostRowsChanged = hosts.rows.length;
    summary.portRowsWritten = ports.rows.length;
    summary.rowsChanged = hosts.rows.length + ports.rows.length;
    const invalid = await tx.execute(sql`
      SELECT h.id FROM nastavitve h LEFT JOIN nastavitve p
        ON p.enota_id=h.enota_id AND p.kljuc='smtpPort'
      WHERE h.kljuc='smtpHost' AND lower(btrim(h.vrednost)) IN
        ('195.206.229.180','195.206.229.181','mail.mikrona.si','mikrona.si')
        AND (h.vrednost<>'mail.mikrona.si' OR p.vrednost IS DISTINCT FROM '465')
    `);
    if (invalid.rows.length) throw new Error("Mikrona SMTP migration verification failed; transaction rolled back.");
    return summary;
  }, process.argv.includes("--apply") ? undefined : { accessMode: "read only" });
}

try {
  console.log(JSON.stringify(await migrate()));
} finally {
  await pool.end();
}
