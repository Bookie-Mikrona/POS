import { pgTable, uuid, integer, text, date, numeric, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { counterpartiesTable } from "./counterparties";
import { enoteTable } from "./pos/enote";
import { racuniTable } from "./pos/racuni";

type MonthlyInvoiceParty = {
  name: string; address: string; taxId: string;
  street?: string | null; postalCode?: string | null; city?: string | null;
  countryCode?: string | null; registrationNumber?: string | null;
  vatId?: string | null; endpointId?: string | null;
};
export type MonthlyInvoiceSnapshot = {
  issuer: MonthlyInvoiceParty & { iban: string; bic: string };
  recipient: MonthlyInvoiceParty;
  unitName: string;
  isTest: boolean;
  totalNet: string;
  totalVat: string;
  totalGross: string;
  vatBuckets: Array<{ rate: string; net: string; vat: string; gross: string }>;
  receipts: Array<{ id: number; number: string; date: string; gross: string }>;
  lines: Array<{ label: string; quantity: string; gross: string; rate: string }>;
};

/** Issued documents, deliberately independent of ERP periods, accounts and journals. */
export const posMonthlyInvoicesTable = pgTable("pos_monthly_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "restrict" }),
  counterpartyId: uuid("counterparty_id").notNull().references(() => counterpartiesTable.id, { onDelete: "restrict" }),
  month: text("month").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  year: integer("year").notNull(),
  sequence: integer("sequence").notNull(),
  grossAmount: numeric("gross_amount", { precision: 18, scale: 2 }).notNull(),
  snapshot: jsonb("snapshot").$type<MonthlyInvoiceSnapshot>().notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  requestHash: text("request_hash").notNull(),
  issuedBy: text("issued_by").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  uniqueIndex("pos_monthly_invoices_company_number_uq").on(t.companyId, t.invoiceNumber),
  uniqueIndex("pos_monthly_invoices_company_year_sequence_uq").on(t.companyId, t.year, t.sequence),
  uniqueIndex("pos_monthly_invoices_unit_partner_month_uq").on(t.enotaId, t.counterpartyId, t.month),
  uniqueIndex("pos_monthly_invoices_company_idempotency_uq").on(t.companyId, t.idempotencyKey),
]);

export const posMonthlyInvoiceReceiptsTable = pgTable("pos_monthly_invoice_receipts", {
  receiptId: integer("receipt_id").primaryKey().references(() => racuniTable.id, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").notNull().references(() => posMonthlyInvoicesTable.id, { onDelete: "restrict" }),
});

export type MonthlyBizboxState = "sending" | "failed" | "unknown" | "submitted" | "processing" | "delivered" | "rejected";
/** Transport reservation survives a lost HTTP response or process restart. No credentials or file bytes. */
export const posMonthlyInvoiceDeliveriesTable = pgTable("pos_monthly_invoice_deliveries", {
  invoiceId: uuid("invoice_id").primaryKey().references(() => posMonthlyInvoicesTable.id, { onDelete: "restrict" }),
  state: text("state").$type<MonthlyBizboxState>().notNull(),
  attemptId: uuid("attempt_id").notNull(),
  attemptCount: integer("attempt_count").notNull().default(1),
  environment: text("environment").$type<"test" | "produkcija">().notNull(),
  accountHash: text("account_hash").notNull(),
  fromAddress: text("from_address").notNull(),
  toAddress: text("to_address").notNull(),
  externalId: text("external_id").notNull(),
  xmlHash: text("xml_hash").notNull(),
  documentId: text("document_id"),
  message: text("message"),
  actorId: text("actor_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});