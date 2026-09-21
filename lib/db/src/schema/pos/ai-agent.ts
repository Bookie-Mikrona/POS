import { pgTable, bigserial, integer, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { napraveTable } from "./naprave";

/** Append-only, deliberately transcript-free record of POS AI agent effects. */
export const posAiAgentAuditTable = pgTable("pos_ai_agent_audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  napravaId: integer("naprava_id").references(() => napraveTable.id, { onDelete: "set null" }),
  actorNatakarId: integer("actor_natakar_id").notNull(),
  action: text("action").notNull(),
  outcome: text("outcome").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Small, explicit preferences only; commands and customer/order data are never stored. */
export const posAiAgentMemoryTable = pgTable("pos_ai_agent_memory", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  actorNatakarId: integer("actor_natakar_id").notNull(),
  preferenceKey: text("preference_key").notNull(),
  preferenceValue: text("preference_value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("pos_ai_agent_memory_actor_key").on(table.enotaId, table.actorNatakarId, table.preferenceKey)]);