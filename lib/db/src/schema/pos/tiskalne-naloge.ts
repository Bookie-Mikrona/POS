import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const tiskalneNalogeTable = pgTable("tiskalne_naloge", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull(),
  racunId: integer("racun_id"),
  bajti: text("bajti").notNull(),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
});

export type TiskalnaNaloga = typeof tiskalneNalogeTable.$inferSelect;
