import { pgTable, text, serial, integer, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { racuniTable } from "./racuni";

export const vivaVracilaTable = pgTable("viva_vracila", {
  id: serial("id").primaryKey(),
  racunId: integer("racun_id").notNull().references(() => racuniTable.id),
  enotaId: integer("enota_id").notNull(),
  refundSessionId: text("refund_session_id").notNull(),
  znesek: numeric("znesek", { precision: 10, scale: 2 }).notNull(),
  status: text("status", { enum: ["pending", "unknown", "awaiting_approval", "paid", "failed"] }).notNull().default("pending"),
  predlaganiStatus: text("predlagani_status", { enum: ["paid", "failed"] }),
  prviOdobriteljClerkUserId: text("prvi_odobritelj_clerk_user_id"),
  napaka: text("napaka"),
  actorClerkUserId: text("actor_clerk_user_id"),
  actorNatakarId: integer("actor_natakar_id"),
  napravaKljuc: text("naprava_kljuc"),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  zakljucenoAt: timestamp("zakljuceno_at", { withTimezone: true }),
});

export const vivaVraciloStatusPrehodiTable = pgTable("viva_vracilo_status_prehodi", {
  id: serial("id").primaryKey(),
  vivaVraciloId: integer("viva_vracilo_id").notNull().references(() => vivaVracilaTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id").notNull(),
  prejsnjiStatus: text("prejsnji_status", { enum: ["pending", "unknown", "awaiting_approval", "paid", "failed"] }),
  noviStatus: text("novi_status", { enum: ["pending", "unknown", "awaiting_approval", "paid", "failed"] }).notNull(),
  predlaganiStatus: text("predlagani_status", { enum: ["paid", "failed"] }),
  napaka: text("napaka"),
  actorClerkUserId: text("actor_clerk_user_id"),
  actorNatakarId: integer("actor_natakar_id"),
  napravaKljuc: text("naprava_kljuc"),
  providerReferenca: text("provider_referenca").notNull(),
  vir: text("vir", { enum: ["reservation", "provider", "provider_error", "manual", "legacy"] }).notNull().default("legacy"),
  razlog: text("razlog"),
  dokazReferenca: text("dokaz_referenca"),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("viva_vracilo_status_prehodi_refund_created_idx").on(t.vivaVraciloId, t.ustvarjeno),
  index("viva_vracilo_status_prehodi_enota_created_idx").on(t.enotaId, t.ustvarjeno),
]);

export const vivaVracilaRelations = relations(vivaVracilaTable, ({ one, many }) => ({
  racun: one(racuniTable, { fields: [vivaVracilaTable.racunId], references: [racuniTable.id] }),
  statusPrehodi: many(vivaVraciloStatusPrehodiTable),
}));

export const vivaVraciloStatusPrehodiRelations = relations(vivaVraciloStatusPrehodiTable, ({ one }) => ({
  vivaVracilo: one(vivaVracilaTable, {
    fields: [vivaVraciloStatusPrehodiTable.vivaVraciloId],
    references: [vivaVracilaTable.id],
  }),
}));

export type VivaVracilo = typeof vivaVracilaTable.$inferSelect;
export type VivaVraciloStatusPrehod = typeof vivaVraciloStatusPrehodiTable.$inferSelect;
