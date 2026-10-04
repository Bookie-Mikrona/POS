import { foreignKey, integer, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { artikliTable } from "./artikli";

/** Insert-triggered outbox: includes transactional imports and generated ingredients. */
export const allergenResearchJobsTable = pgTable("pos_allergen_research_jobs", {
  id: serial("id").primaryKey(),
  artikelId: integer("artikel_id").notNull().unique(),
  enotaId: integer("enota_id").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  leaseToken: uuid("lease_token"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    columns: [t.artikelId, t.enotaId],
    foreignColumns: [artikliTable.id, artikliTable.enotaId],
  }).onDelete("cascade"),
]);