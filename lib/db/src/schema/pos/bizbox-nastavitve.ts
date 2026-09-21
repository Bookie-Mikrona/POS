import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "../companies";

/**
 * Per-podjetje šifrirane poverilnice za bizBox e-račun omrežje.
 *
 * bizboxPassEnc je AES-256-GCM šifropis v obliki:
 *   base64(iv):base64(authTag):base64(ciphertext)
 *
 * Geslo se dešifrira s funkcijo desifrirajBizboxGeslo() iz kripto-bizbox.ts.
 * NIKOLI se ne vrne v API odgovoru — le indikator `gesloNastavljeno: true`.
 */
export const bizboxNastavitveTable = pgTable("bizbox_nastavitve", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  bizboxUser: text("bizbox_user").notNull(),
  /** AES-256-GCM šifropis: base64(iv):base64(authTag):base64(ciphertext) */
  bizboxPassEnc: text("bizbox_pass_enc").notNull(),
  /** 'test' = demo.zzi.si (privzeto), 'prod' = ws.zzi.si */
  bizboxOkolje: text("bizbox_okolje").notNull().default("test"),
  /** Override pošiljateljevega eDDress-a; NULL → vzame se podjetje_davcna */
  posiljateljDavcna: text("posiljatelj_davcna"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BizboxNastavitev = typeof bizboxNastavitveTable.$inferSelect;
export type InsertBizboxNastavitev = typeof bizboxNastavitveTable.$inferInsert;
