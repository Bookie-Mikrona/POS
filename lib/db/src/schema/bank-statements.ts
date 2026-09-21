import {
  pgTable,
  text,
  uuid,
  timestamp,
  numeric,
  date,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { accountsTable } from "./accounts";

export const bankStatementsTable = pgTable("bank_statements", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  bankAccountId: uuid("bank_account_id").notNull().references(() => accountsTable.id),
  sourceIban: text("source_iban"),
  statementNumber: text("statement_number"),
  statementDate: date("statement_date", { mode: "string" }).notNull(),
  periodFrom: date("period_from", { mode: "string" }),
  periodTo: date("period_to", { mode: "string" }),
  openingBalance: numeric("opening_balance", { precision: 18, scale: 2 }),
  closingBalance: numeric("closing_balance", { precision: 18, scale: 2 }),
  currency: text("currency").notNull().default("EUR"),
  sourceFilename: text("source_filename").notNull(),
  sourceSha256: text("source_sha256").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  companySourceHashUnique: uniqueIndex("bank_statements_company_source_sha256_uq")
    .on(table.companyId, table.sourceSha256),
}));

export const bankStatementLinesTable = pgTable("bank_statement_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  statementId: uuid("statement_id").notNull().references(() => bankStatementsTable.id, { onDelete: "cascade" }),
  transactionKey: text("transaction_key").notNull(),
  lineNumber: integer("line_number").notNull(),
  bookingDate: date("booking_date", { mode: "string" }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("EUR"),
  reference: text("reference"),
  counterpartyName: text("counterparty_name"),
  counterpartyIban: text("counterparty_iban"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  statementTransactionUnique: uniqueIndex("bank_statement_lines_statement_tx_uq")
    .on(table.statementId, table.transactionKey),
}));

export type BankStatement = typeof bankStatementsTable.$inferSelect;
export type BankStatementLine = typeof bankStatementLinesTable.$inferSelect;