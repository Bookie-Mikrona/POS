import { pgTable, text, serial, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const tiskalneNalogeTable = pgTable("tiskalne_naloge", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull(),
  racunId: integer("racun_id"),
  bajti: text("bajti").notNull(),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  purpose: text("purpose", { enum: ["receipt", "kds_ticket"] }).notNull().default("receipt"),
  destination: text("destination", { enum: ["agent", "network", "kds"] }).notNull().default("agent"),
  printerKey: text("printer_key"),
  /** Stable caller operation key, unique per POS unit when supplied. */
  idempotencyKey: text("idempotency_key"),
  status: text("status", { enum: ["queued", "running", "printed", "failed", "needs_review"] }).notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  claimedBy: text("claimed_by"),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  lastError: text("last_error"),
  ackAt: timestamp("ack_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  payloadHash: text("payload_hash"),
});

export type TiskalnaNaloga = typeof tiskalneNalogeTable.$inferSelect;

export const posPrinterHeartbeatsTable = pgTable("pos_printer_heartbeats", {
  enotaId: integer("enota_id").notNull(),
  printerKey: text("printer_key").notNull(),
  agentId: text("agent_id").notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").notNull().default({}),
});
