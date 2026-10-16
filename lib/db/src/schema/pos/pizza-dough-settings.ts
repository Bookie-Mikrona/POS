import { foreignKey, integer, pgTable } from "drizzle-orm/pg-core";
import { artikliTable } from "./artikli";
import { enoteTable } from "./enote";

/**
 * Unit-owned mapping from pizza size to its single prepared dough portion.
 * The composite foreign keys ensure both articles belong to this unit.
 */
export const pizzaDoughSettingsTable = pgTable("pizza_dough_settings", {
  enotaId: integer("enota_id")
    .primaryKey()
    .references(() => enoteTable.id, { onDelete: "cascade" }),
  normalDoughArticleId: integer("normal_dough_article_id").notNull(),
  smallDoughArticleId: integer("small_dough_article_id").notNull(),
  familyDoughArticleId: integer("family_dough_article_id").notNull(),
}, (t) => [
  foreignKey({
    columns: [t.normalDoughArticleId, t.enotaId],
    foreignColumns: [artikliTable.id, artikliTable.enotaId],
    name: "pizza_dough_settings_normal_article_unit_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [t.smallDoughArticleId, t.enotaId],
    foreignColumns: [artikliTable.id, artikliTable.enotaId],
    name: "pizza_dough_settings_small_article_unit_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [t.familyDoughArticleId, t.enotaId],
    foreignColumns: [artikliTable.id, artikliTable.enotaId],
    name: "pizza_dough_settings_family_article_unit_fk",
  }).onDelete("restrict"),
]);

export type PizzaDoughSettings = typeof pizzaDoughSettingsTable.$inferSelect;
export type InsertPizzaDoughSettings = typeof pizzaDoughSettingsTable.$inferInsert;