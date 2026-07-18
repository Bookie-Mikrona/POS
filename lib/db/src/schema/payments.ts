import {
  pgTable,
  text,
  uuid,
  timestamp,
  pgEnum,
  numeric,
  date,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { counterpartiesTable } from "./counterparties";
import { accountingPeriodsTable } from "./accounting-periods";
import { accountsTable } from "./accounts";
import { journalEntriesTable } from "./journal-entries";
import { invoicesTable } from "./invoices";

export const paymentDirectionEnum = pgEnum("payment_direction", [
  "inbound",  // prejet (kupec plača nam)
  "outbound", // izplačan (mi plačamo dobavitelju)
]);

export const paymentStatusEnum = pgEnum("payment_status", [
  "draft",
  "posted",
  "void",
]);

/**
 * Plačila (prejeta in izplačana).
 * - inbound  = prejeto plačilo od kupca
 * - outbound = izplačano plačilo dobavitelju
 *
 * bankAccountId: konto bančnega računa / blagajne (breme za inbound, dobro za outbound)
 * arApAccountId: konto terjatev (inbound) ali obveznosti (outbound) — za temeljnico
 * linkedEntryId: avtomatično ustvarjena temeljnica ob knjiženju
 */
export const paymentsTable = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  counterpartyId: uuid("counterparty_id")
    .notNull()
    .references(() => counterpartiesTable.id),
  periodId: uuid("period_id")
    .notNull()
    .references(() => accountingPeriodsTable.id),
  direction: paymentDirectionEnum("direction").notNull(),
  paymentDate: date("payment_date", { mode: "string" }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  reference: text("reference"),
  /** Konto bančnega računa ali blagajne */
  bankAccountId: uuid("bank_account_id")
    .notNull()
    .references(() => accountsTable.id),
  /** Konto terjatev (inbound) ali obveznosti (outbound) */
  arApAccountId: uuid("ar_ap_account_id")
    .notNull()
    .references(() => accountsTable.id),
  status: paymentStatusEnum("status").notNull().default("draft"),
  linkedEntryId: uuid("linked_entry_id").references(() => journalEntriesTable.id),
  notes: text("notes"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Poravnave plačil z računi.
 * En naslov plačila se lahko razdeli na več računov (delne poravnave).
 * Vsota allocatedAmount vseh poravnav ne sme presegati payments.amount.
 */
export const paymentAllocationsTable = pgTable("payment_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id")
    .notNull()
    .references(() => paymentsTable.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoicesTable.id),
  allocatedAmount: numeric("allocated_amount", { precision: 18, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Payment = typeof paymentsTable.$inferSelect;
export type PaymentAllocation = typeof paymentAllocationsTable.$inferSelect;
