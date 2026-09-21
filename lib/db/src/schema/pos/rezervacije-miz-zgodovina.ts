import { index, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/** Append-only audit trail; application code never updates or deletes rows. */
export const rezervacijeMizZgodovinaTable = pgTable("rezervacije_miz_zgodovina", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull(),
  rezervacijaId: integer("rezervacija_id"),
  mizaId: integer("miza_id").notNull(),
  dogodek: text("dogodek", { enum: ["ustvarjena", "posodobljena", "preklicana", "miza_arhivirana"] }).notNull(),
  actorClerkUserId: text("actor_clerk_user_id"),
  podatki: jsonb("podatki").notNull().default({}),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ix_rezervacije_miz_zgodovina_rezervacija").on(t.rezervacijaId, t.ustvarjeno),
  index("ix_rezervacije_miz_zgodovina_miza").on(t.enotaId, t.mizaId, t.ustvarjeno),
]);

export type RezervacijaMizeZgodovina = typeof rezervacijeMizZgodovinaTable.$inferSelect;