import { boolean, date, integer, jsonb, pgTable, serial, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { counterpartiesTable } from "../counterparties";
import { malicaGroupsTable, malicaSaleSnapshotsTable } from "./malice";
import { narocilaTable } from "./narocila";
import { invoicesTable } from "../invoices";

export const malicaContractsTable = pgTable("malica_contracts", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  partnerId: uuid("partner_id").notNull().references(() => counterpartiesTable.id, { onDelete: "restrict" }),
  version: integer("version").notNull().default(1),
  mode: text("mode", { enum: ["partner_all", "guest_reduced_price", "partner_fixed_guest_remainder", "split"] }).notNull(),
  splitKind: text("split_kind", { enum: ["fixed", "percent"] }),
  splitValue: integer("split_value").notNull().default(0),
  higherGroupSurchargeCents: integer("higher_group_surcharge_cents").notNull().default(0),
  monthlyCoverageLimitCents: integer("monthly_coverage_limit_cents"),
  validFrom: date("valid_from", { mode: "string" }).notNull(),
  validTo: date("valid_to", { mode: "string" }),
  requiresBeneficiary: boolean("requires_beneficiary").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("malica_contracts_version_uq").on(t.enotaId, t.partnerId, t.version)]);

export const malicaBeneficiariesTable = pgTable("malica_beneficiaries", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  partnerId: uuid("partner_id").notNull().references(() => counterpartiesTable.id, { onDelete: "restrict" }),
  identifierType: text("identifier_type", { enum: ["pin", "barcode", "qr", "nfc"] }).notNull(),
  identifierHash: text("identifier_hash").notNull(),
  maskedSuffix: text("masked_suffix"),
  dailyLimit: integer("daily_limit"),
  monthlyCoverageOverrideCents: integer("monthly_coverage_override_cents"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("malica_beneficiaries_lookup_uq").on(t.enotaId, t.identifierType, t.identifierHash)]);

export const malicaContractUsageTable = pgTable("malica_contract_usage", {
  id: serial("id").primaryKey(),
  contractId: integer("contract_id").notNull().references(() => malicaContractsTable.id, { onDelete: "restrict" }),
  beneficiaryId: integer("beneficiary_id").references(() => malicaBeneficiariesTable.id, { onDelete: "restrict" }),
  saleSnapshotId: integer("sale_snapshot_id").notNull().references(() => malicaSaleSnapshotsTable.id, { onDelete: "restrict" }),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  coveredCents: integer("covered_cents").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const malicaAllocationsTable = pgTable("malica_allocations", {
  id: serial("id").primaryKey(),
  saleSnapshotId: integer("sale_snapshot_id").notNull().references(() => malicaSaleSnapshotsTable.id, { onDelete: "restrict" }),
  narociloId: integer("narocilo_id").notNull().references(() => narocilaTable.id, { onDelete: "restrict" }),
  partnerCents: integer("partner_cents").notNull(),
  guestCents: integer("guest_cents").notNull(),
  surchargeCents: integer("surcharge_cents").notNull().default(0),
  businessDate: date("business_date", { mode: "string" }).notNull().default("1970-01-01"),
  vatRateBps: integer("vat_rate_bps").notNull().default(0),
  vatBaseCents: integer("vat_base_cents").notNull(),
  vatCents: integer("vat_cents").notNull(),
  contractId: integer("contract_id").references(() => malicaContractsTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("malica_allocations_snapshot_uq").on(t.saleSnapshotId)]);

export const malicaAllocationClaimsTable = pgTable("malica_allocation_claims", {
  id: serial("id").primaryKey(),
  allocationId: integer("allocation_id").notNull().references(() => malicaAllocationsTable.id, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("malica_allocation_claims_allocation_uq").on(t.allocationId)]);

export type MalicaContract = typeof malicaContractsTable.$inferSelect;