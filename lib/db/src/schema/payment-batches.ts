import {
  check,
  pgTable,
  text,
  uuid,
  timestamp,
  date,
  numeric,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "./companies";
import { accountsTable } from "./accounts";
import { paymentsTable } from "./payments";

/** Explicit company-owned IBAN/BIC mapping for a ledger bank account. */
export const bankAccountMetadataTable = pgTable("bank_account_metadata", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => accountsTable.id, { onDelete: "cascade" }),
  iban: text("iban").notNull(),
  bic: text("bic"),
  sepaProfile: text("sepa_profile").notNull().default("pain.001.001.03"),
  updatedBy: text("updated_by").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  accountUnique: uniqueIndex("bank_account_metadata_account_uq").on(table.bankAccountId),
  companyIbanUnique: uniqueIndex("bank_account_metadata_company_iban_uq").on(table.companyId, table.iban),
  profileCheck: check("bank_account_metadata_profile_check", sql`${table.sepaProfile} = 'pain.001.001.03'`),
}));

/** A batch is an immutable collection of saved draft payments and instructions. */
export const paymentBatchesTable = pgTable("payment_batches", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => accountsTable.id),
  executionDate: date("execution_date", { mode: "string" }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestFingerprint: text("request_fingerprint"),
  status: text("status").notNull().default("ready"),
  transactionCount: numeric("transaction_count", { precision: 10, scale: 0 }).notNull(),
  controlSum: numeric("control_sum", { precision: 18, scale: 2 }).notNull(),
  xmlSnapshot: text("xml_snapshot"),
  exportedAt: timestamp("exported_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  idempotencyUnique: uniqueIndex("payment_batches_company_idempotency_uq").on(table.companyId, table.idempotencyKey),
  statusCheck: check("payment_batches_status_check", sql`${table.status} IN ('ready', 'exported', 'partially_executed', 'executed', 'rejected', 'cancelled')`),
}));

export const paymentBatchItemsTable = pgTable("payment_batch_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  batchId: uuid("batch_id").notNull().references(() => paymentBatchesTable.id, { onDelete: "restrict" }),
  paymentId: uuid("payment_id").notNull().references(() => paymentsTable.id, { onDelete: "restrict" }),
  instruction: jsonb("instruction").$type<Record<string, unknown>>().notNull(),
  lifecycleStatus: text("lifecycle_status").notNull().default("ready"),
  resolutionReason: text("resolution_reason"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  lifecycleCheck: check("payment_batch_items_lifecycle_check", sql`${table.lifecycleStatus} IN ('ready', 'partially_executed', 'executed', 'rejected', 'cancelled')`),
  activePaymentUnique: uniqueIndex("payment_batch_items_active_payment_uq")
    .on(table.paymentId)
    .where(sql`${table.releasedAt} IS NULL`),
}));

export type BankAccountMetadata = typeof bankAccountMetadataTable.$inferSelect;
export type PaymentBatch = typeof paymentBatchesTable.$inferSelect;
export type PaymentBatchItem = typeof paymentBatchItemsTable.$inferSelect;