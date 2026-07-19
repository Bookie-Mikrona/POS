import { pgTable, text, serial, integer, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { enoteTable } from "./enote";
import { narocilaTable } from "./narocila";
import { izmeneTable } from "./izmene";

export const racuniTable = pgTable("racuni", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  narociloId: integer("narocilo_id").notNull().references(() => narocilaTable.id),
  izmenaId: integer("izmena_id").references(() => izmeneTable.id),
  stevilkaRacuna: text("stevilka_racuna").notNull(),
  skupaj: numeric("skupaj", { precision: 10, scale: 2 }).notNull(),
  ddv: numeric("ddv", { precision: 10, scale: 2 }).notNull(),
  osnova: numeric("osnova", { precision: 10, scale: 2 }),
  placilnaNacin: text("placilna_nacin", { enum: ["gotovina", "kartica", "bon", "bon_pica", "negotovinsko", "reprezentanca", "lastna_poraba"] }).notNull(),
  status: text("status", { enum: ["poslan", "napaka", "testni", "storniran"] }).notNull().default("testni"),
  zoi: text("zoi"),
  eor: text("eor"),
  fursOdgovor: text("furs_odgovor"),
  natakarIme: text("natakar_ime"),
  natakarDavcna: text("natakar_davcna"),
  datumCas: timestamp("datum_cas", { withTimezone: true }),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  steviloPrintov: integer("stevilo_printov").notNull().default(0),
  opomba: text("opomba"),
  znesekGotovina: numeric("znesek_gotovina", { precision: 10, scale: 2 }),
  znesekKartica: numeric("znesek_kartica", { precision: 10, scale: 2 }),
  znesekBon: numeric("znesek_bon", { precision: 10, scale: 2 }),
  steviloBonov: integer("stevilo_bonov"),
  znesekBonPica: numeric("znesek_bon_pica", { precision: 10, scale: 2 }),
  znesekNegotovinsko: numeric("znesek_negotovinsko", { precision: 10, scale: 2 }),
  dniOdloga: integer("dni_odloga"),
  izdaniKuponi: integer("izdani_kuponi"),
  jeDelni: boolean("je_delni").notNull().default(false),
  jeStorno: boolean("je_storno").notNull().default(false),
  izvorniRacunId: integer("izvorni_racun_id"),
  kupecDavcnaStevilka: text("kupec_davcna_stevilka"),
  kupecNaziv: text("kupec_naziv"),
  kupecNaslov: text("kupec_naslov"),
  kupecZavezanecDdv: boolean("kupec_zavezanec_ddv"),
  sumupCheckoutId: text("sumup_checkout_id"),
  vivaTerminalSessionId: text("viva_terminal_session_id"),
  kupecId: integer("kupec_id"),
});

export const racuniRelations = relations(racuniTable, ({ one }) => ({
  narocilo: one(narocilaTable, { fields: [racuniTable.narociloId], references: [narocilaTable.id] }),
  izmena: one(izmeneTable, { fields: [racuniTable.izmenaId], references: [izmeneTable.id] }),
}));

export type Racun = typeof racuniTable.$inferSelect;
export type InsertRacun = typeof racuniTable.$inferInsert;
