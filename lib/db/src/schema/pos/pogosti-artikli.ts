import { pgTable, serial, integer, text, unique } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { artikliTable } from "./artikli";

/**
 * Ročna prilagoditev seznama »Pogosto« za enoto.
 * Samodejni izračun iz zgodovine naročil ostane privzet; »pripni« artikel vedno vključi,
 * »skrij« ga izključi.
 */
export const pogostiArtikliRocnoTable = pgTable("pogosti_artikli_rocno", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "cascade" }),
  akcija: text("akcija", { enum: ["pripni", "skrij"] }).notNull(),
}, (t) => [unique("pogosti_artikli_rocno_enota_artikel_unique").on(t.enotaId, t.artikelId)]);
