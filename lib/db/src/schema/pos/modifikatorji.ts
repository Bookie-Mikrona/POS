import { pgTable, text, serial, integer, numeric, boolean, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { enoteTable } from "./enote";
import { artikliTable } from "./artikli";

export const modSkupineTable = pgTable("modifikatorske_skupine", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  ime: text("ime").notNull(),
  obvezna: boolean("obvezna").notNull().default(false),
  minIzbir: integer("min_izbir").notNull().default(0),
  maxIzbir: integer("max_izbir").notNull().default(1),
  vrstniRed: integer("vrstni_red").notNull().default(0),
});

export const modifikatorjiTable = pgTable("modifikatorji", {
  id: serial("id").primaryKey(),
  skupinaId: integer("skupina_id").notNull().references(() => modSkupineTable.id, { onDelete: "cascade" }),
  ime: text("ime").notNull(),
  cenaDodatek: numeric("cena_dodatek", { precision: 10, scale: 2 }).notNull().default("0"),
  aktiven: boolean("aktiven").notNull().default(true),
  vrstniRed: integer("vrstni_red").notNull().default(0),
  /** Ali modifikator vsebuje dodan sladkor (vpliva na DDV topele pijače za s seboj) */
  addedSugar: boolean("added_sugar").notNull().default(false),
});

export const modNormativiTable = pgTable("modifikator_normativi", {
  id: serial("id").primaryKey(),
  modifikatorId: integer("modifikator_id").notNull().references(() => modifikatorjiTable.id, { onDelete: "cascade" }),
  vhodniArtikelId: integer("vhodni_artikel_id").notNull().references(() => artikliTable.id, { onDelete: "restrict" }),
  kolicina: numeric("kolicina", { precision: 10, scale: 4 }).notNull(),
  vrstniRed: integer("vrstni_red").notNull().default(0),
});

export const artModSkupineTable = pgTable(
  "artikli_modifikatorske_skupine",
  {
    artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "cascade" }),
    skupinaId: integer("skupina_id").notNull().references(() => modSkupineTable.id, { onDelete: "cascade" }),
    vrstniRed: integer("vrstni_red").notNull().default(0),
  },
  (t) => [uniqueIndex("artikli_mod_skupina_unique").on(t.artikelId, t.skupinaId)]
);

export const modSkupineRelations = relations(modSkupineTable, ({ many }) => ({
  modifikatorji: many(modifikatorjiTable),
  artikliVezave: many(artModSkupineTable),
}));

export const modifikatorjiRelations = relations(modifikatorjiTable, ({ one, many }) => ({
  skupina: one(modSkupineTable, { fields: [modifikatorjiTable.skupinaId], references: [modSkupineTable.id] }),
  normativi: many(modNormativiTable),
}));

export const modNormativiRelations = relations(modNormativiTable, ({ one }) => ({
  modifikator: one(modifikatorjiTable, { fields: [modNormativiTable.modifikatorId], references: [modifikatorjiTable.id] }),
  vhodniArtikel: one(artikliTable, { fields: [modNormativiTable.vhodniArtikelId], references: [artikliTable.id] }),
}));

export const artModSkupineRelations = relations(artModSkupineTable, ({ one }) => ({
  artikel: one(artikliTable, { fields: [artModSkupineTable.artikelId], references: [artikliTable.id] }),
  skupina: one(modSkupineTable, { fields: [artModSkupineTable.skupinaId], references: [modSkupineTable.id] }),
}));

export type ModSkupina = typeof modSkupineTable.$inferSelect;
export type Modifikator = typeof modifikatorjiTable.$inferSelect;
export type ModNormativ = typeof modNormativiTable.$inferSelect;
export type ArtModSkupina = typeof artModSkupineTable.$inferSelect;
