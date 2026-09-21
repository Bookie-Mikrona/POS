import { bigint, integer, numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Historical IDs intentionally have no FKs: audit facts survive source-row deletion. */
export const posNormativeChangeAuditTable = pgTable("pos_normative_change_audit", {
  id: bigint("id", { mode: "number" }).primaryKey().default(sql`nextval('pos_normative_change_audit_id_seq')`),
  enotaId: integer("enota_id").notNull(),
  artikelId: integer("artikel_id").notNull(),
  normativRowId: integer("normativ_row_id").notNull(),
  ingredientId: integer("ingredient_id").notNull(),
  actorClerkUserId: text("actor_clerk_user_id").notNull(),
  actorNatakarId: integer("actor_natakar_id"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  oldQuantity: numeric("old_quantity", { precision: 10, scale: 4 }).notNull(),
  newQuantity: numeric("new_quantity", { precision: 10, scale: 4 }).notNull(),
  unit: text("unit").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceTitle: text("source_title").notNull(),
  comparisonGeneratedAt: timestamp("comparison_generated_at", { withTimezone: true }).notNull(),
});