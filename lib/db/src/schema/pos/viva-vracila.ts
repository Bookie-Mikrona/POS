import { pgTable, text, serial, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { racuniTable } from "./racuni";

export const vivaVracilaTable = pgTable("viva_vracila", {
  id: serial("id").primaryKey(),
  racunId: integer("racun_id").notNull().references(() => racuniTable.id),
  enotaId: integer("enota_id").notNull(),
  refundSessionId: text("refund_session_id").notNull(),
  znesek: numeric("znesek", { precision: 10, scale: 2 }).notNull(),
  status: text("status", { enum: ["pending", "paid", "failed"] }).notNull().default("pending"),
  napaka: text("napaka"),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  zakljucenoAt: timestamp("zakljuceno_at", { withTimezone: true }),
});

export const vivaVracilaRelations = relations(vivaVracilaTable, ({ one }) => ({
  racun: one(racuniTable, { fields: [vivaVracilaTable.racunId], references: [racuniTable.id] }),
}));

export type VivaVracilo = typeof vivaVracilaTable.$inferSelect;
