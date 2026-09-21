import { boolean, bigserial, index, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";

export const dostavniKurirjiTable = pgTable("dostavni_kurirji", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  ime: text("ime").notNull(),
  telefon: text("telefon"),
  aktiven: boolean("aktiven").notNull().default(true),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("dostavni_kurirji_enota_ime_unique").on(t.enotaId, t.ime)]);

export const dostavaStatusZgodovinaTable = pgTable("dostava_status_zgodovina", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  // The FK is declared in SQL migration 105. Avoid a circular schema
  // initializer: narocila itself references the courier table.
  narociloId: integer("narocilo_id").notNull(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["prejeto", "potrjeno", "v_pripravi", "pripravljeno", "prevzel_kurir", "dostavljeno", "preklicano"] }).notNull(),
  kurirId: integer("kurir_id").references(() => dostavniKurirjiTable.id, { onDelete: "set null" }),
  idempotencyKey: text("idempotency_key").notNull(),
  actorId: integer("actor_id"),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("dostava_status_zgodovina_narocilo_idempotency_key_unique").on(t.narociloId, t.idempotencyKey),
  index("ix_dostava_status_zgodovina_narocilo").on(t.narociloId, t.id),
]);