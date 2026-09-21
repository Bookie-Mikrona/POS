import { pgTable, uuid, integer, numeric, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "../companies";
import { enoteTable } from "./enote";
import { narocilaTable } from "./narocila";

/**
 * Trajna idempotentna namera kartičnega plačila pred klicem ponudnika.
 * Referenca ponudnika se zapiše takoj po uspešnem odgovoru; brez nje ostane
 * poskus "unknown" in ga ni dovoljeno samodejno ponovno poslati ponudniku.
 */
export const posKarticnaPlacilaAttemptTable = pgTable("pos_karticna_placila_attempt", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  narociloId: integer("narocilo_id").references(() => narocilaTable.id, { onDelete: "restrict" }),
  purpose: text("purpose", { enum: ["receipt", "gift_voucher"] }).notNull().default("receipt"),
  idempotencyKey: text("idempotency_key").notNull(),
  provider: text("provider", { enum: ["payten", "sumup", "viva_smart", "viva_terminal", "simulacija"] }).notNull(),
  znesek: numeric("znesek", { precision: 14, scale: 2 }).notNull(),
  providerReferenca: text("provider_referenca"),
  /** Provider's unmodified lifecycle/state value; never use this for business decisions. */
  providerRawStatus: text("provider_raw_status"),
  status: text("status", { enum: ["reserved", "pending", "completed", "failed", "unknown"] })
    .notNull()
    .default("reserved"),
  napaka: text("napaka"),
  rezultatJson: text("rezultat_json"),
  actor: text("actor"),
  deviceKey: text("device_key"),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("pos_karticna_placila_attempt_key_unique")
    .on(table.companyId, table.enotaId, table.idempotencyKey),
  uniqueIndex("pos_karticna_placila_attempt_provider_reference_unique")
    .on(table.provider, table.providerReferenca),
  // One unresolved charge per provider/order/amount. Failed attempts are
  // deliberately excluded so the customer can try again.
  uniqueIndex("pos_karticna_placila_attempt_active_payment_unique")
    .on(table.companyId, table.enotaId, table.provider, table.narociloId, table.znesek)
    .where(sql`${table.status} IN ('reserved', 'pending', 'unknown')`),
]);

export type PosKarticnaPlacilaAttempt = typeof posKarticnaPlacilaAttemptTable.$inferSelect;