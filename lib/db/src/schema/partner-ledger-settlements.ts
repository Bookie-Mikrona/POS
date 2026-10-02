import { date, index, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { counterpartiesTable } from "./counterparties";
import { accountsTable } from "./accounts";
import { journalEntryLinesTable } from "./journal-entries";

/** Append-only events: close creates a link; reopen reverses some of that link. */
export const partnerSettlementEventsTable = pgTable("partner_settlement_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
  partnerId: uuid("partner_id").notNull().references(() => counterpartiesTable.id, { onDelete: "restrict" }),
  accountId: uuid("account_id").notNull().references(() => accountsTable.id, { onDelete: "restrict" }),
  sourceLineId: uuid("source_line_id").notNull().references(() => journalEntryLinesTable.id, { onDelete: "restrict" }),
  targetLineId: uuid("target_line_id").references(() => journalEntryLinesTable.id, { onDelete: "restrict" }),
  eventType: text("event_type").$type<"close" | "reopen">().notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  effectiveDate: date("effective_date", { mode: "string" }).notNull(),
  closeEventId: uuid("close_event_id"),
  /** Stable source identity for reopening imported AR/AP or allocation evidence. */
  externalClosingId: text("external_closing_id"),
  idempotencyKey: text("idempotency_key").notNull(),
  reason: text("reason"),
  actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("partner_settlement_events_line_idx").on(t.companyId, t.sourceLineId),
  index("partner_settlement_events_target_idx").on(t.companyId, t.targetLineId),
  index("partner_settlement_events_external_close_idx").on(t.companyId, t.externalClosingId),
  uniqueIndex("partner_settlement_events_idempotency_uq").on(t.companyId, t.idempotencyKey),
]);

export type PartnerSettlementEvent = typeof partnerSettlementEventsTable.$inferSelect;