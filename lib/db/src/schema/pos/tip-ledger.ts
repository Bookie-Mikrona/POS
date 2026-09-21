import { relations, sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "../companies";
import { enoteTable } from "./enote";
import { natakariTable } from "./natakari";
import { racuniTable } from "./racuni";

export const tipPoliciesTable = pgTable("tip_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id").references(() => enoteTable.id, { onDelete: "restrict" }),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
  mode: text("mode", { enum: ["direct_employee", "independent_pool", "employer_controlled"] }).notNull(),
  evidenceType: text("evidence_type", { enum: ["employment_contract", "collective_agreement", "internal_rule", "other"] }).notNull(),
  evidenceReference: text("evidence_reference").notNull(),
  agreementConfirmed: boolean("agreement_confirmed").notNull().default(false),
  cardFeeTreatment: text("card_fee_treatment", { enum: ["employer_expense", "deduct_from_tip"] }).notNull(),
  cardFeeKind: text("card_fee_kind", { enum: ["none", "percentage", "flat"] }).notNull().default("none"),
  cardFeePercent: numeric("card_fee_percent", { precision: 7, scale: 4 }),
  cardFeeFlatAmount: numeric("card_fee_flat_amount", { precision: 10, scale: 2 }),
  notes: text("notes"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  // Scope-aware uniqueness and range exclusion use COALESCE(enota_id,-1) and
  // are installed in migration 110 (Drizzle cannot model expression exclusion).
  index("tip_policies_company_scope_effective_from_idx").on(table.companyId, table.enotaId, table.effectiveFrom),
  index("tip_policies_company_effective_range_idx").on(table.companyId, table.effectiveFrom, table.effectiveTo),
]);

export const tipPoolsTable = pgTable("tip_pools", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  tipPolicyId: uuid("tip_policy_id").notNull().references(() => tipPoliciesTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  decisionType: text("decision_type", { enum: ["employee_agreement", "collective_agreement"] }).notNull(),
  decisionDate: date("decision_date", { mode: "string" }).notNull(),
  ruleReference: text("rule_reference").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
  evidenceReference: text("evidence_reference").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("tip_pools_company_effective_idx").on(table.companyId, table.effectiveFrom, table.effectiveTo)]);

/** Immutable-at-use distribution rules for a POS unit. */
export const tipDistributionProfilesTable = pgTable("tip_distribution_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("tip_distribution_profiles_unit_effective_idx").on(table.companyId, table.enotaId, table.effectiveFrom),
]);

export const tipDistributionProfileEntriesTable = pgTable("tip_distribution_profile_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id").notNull().references(() => tipDistributionProfilesTable.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  groupName: text("group_name").notNull(),
  recipientNatakarId: integer("recipient_natakar_id").notNull().references(() => natakariTable.id, { onDelete: "restrict" }),
  recipientSnapshot: text("recipient_snapshot").notNull(),
  sharePercent: numeric("share_percent", { precision: 7, scale: 4 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("tip_distribution_profile_entries_profile_idx").on(table.profileId),
]);

export const tipAllocationsTable = pgTable("tip_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "restrict" }),
  racunId: integer("racun_id").notNull().references(() => racuniTable.id, { onDelete: "restrict" }),
  tipPolicyId: uuid("tip_policy_id").notNull().references(() => tipPoliciesTable.id, { onDelete: "restrict" }),
  tipPoolId: uuid("tip_pool_id").references(() => tipPoolsTable.id, { onDelete: "restrict" }),
  natakarId: integer("natakar_id").references(() => natakariTable.id, { onDelete: "restrict" }),
  recipientNatakarId: integer("recipient_natakar_id").references(() => natakariTable.id, { onDelete: "restrict" }),
  recipientSnapshot: text("recipient_snapshot").notNull(),
  allocationKind: text("allocation_kind", { enum: ["auto", "manual"] }).notNull().default("manual"),
  distributionProfileId: uuid("distribution_profile_id").references(() => tipDistributionProfilesTable.id, { onDelete: "restrict" }),
  distributionProfileEntryId: uuid("distribution_profile_entry_id").references(() => tipDistributionProfileEntriesTable.id, { onDelete: "restrict" }),
  distributionGroup: text("distribution_group"),
  distributionSharePercent: numeric("distribution_share_percent", { precision: 7, scale: 4 }),
  distributionProfileSnapshot: jsonb("distribution_profile_snapshot").$type<{
    profileId: string;
    profileName: string;
    groupName: string;
    sharePercent: string;
    recipientSnapshot: string;
  } | null>(),
  grossAmount: numeric("gross_amount", { precision: 12, scale: 2 }).notNull(),
  feeAmount: numeric("fee_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  netAmount: numeric("net_amount", { precision: 12, scale: 2 }).notNull(),
  status: text("status", { enum: ["open", "settled", "cancelled"] }).notNull().default("open"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("tip_allocations_company_receipt_idx").on(table.companyId, table.racunId),
  index("tip_allocations_open_recipient_idx").on(table.companyId, table.status, table.recipientNatakarId),
  uniqueIndex("tip_allocations_auto_receipt_recipient_unique")
    .on(table.racunId, table.tipPolicyId, table.recipientNatakarId)
    .where(sql`allocation_kind = 'auto'`),
  uniqueIndex("tip_allocations_auto_profile_entry_unique")
    .on(table.racunId, table.distributionProfileId, table.distributionProfileEntryId)
    .where(sql`allocation_kind = 'auto' AND distribution_profile_entry_id IS NOT NULL`),
]);

export const tipPoolEntriesTable = pgTable("tip_pool_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  poolId: uuid("pool_id").notNull().references(() => tipPoolsTable.id, { onDelete: "restrict" }),
  allocationId: uuid("allocation_id").references(() => tipAllocationsTable.id, { onDelete: "restrict" }),
  recipientNatakarId: integer("recipient_natakar_id").references(() => natakariTable.id, { onDelete: "restrict" }),
  recipientSnapshot: text("recipient_snapshot"),
  entryType: text("entry_type", { enum: ["allocation", "distribution", "reversal"] }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  reversalOfId: uuid("reversal_of_id").references((): any => tipPoolEntriesTable.id, { onDelete: "restrict" }),
  evidenceReference: text("evidence_reference").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("tip_pool_entries_company_pool_created_idx").on(table.companyId, table.poolId, table.createdAt),
  uniqueIndex("tip_pool_entries_one_allocation").on(table.allocationId).where(sql`entry_type = 'allocation'`),
]);

export const tipHistoricalReviewsTable = pgTable("tip_historical_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  racunId: integer("racun_id").notNull().unique().references(() => racuniTable.id, { onDelete: "restrict" }),
  state: text("state", { enum: ["pending", "confirmed"] }).notNull().default("pending"),
  note: text("note"),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tipSettlementsTable = pgTable("tip_settlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  allocationId: uuid("allocation_id").notNull().unique().references(() => tipAllocationsTable.id, { onDelete: "restrict" }),
  settlementMethod: text("settlement_method", { enum: ["cash", "bank", "payroll", "student_service"] }).notNull(),
  settlementReference: text("settlement_reference").notNull(),
  evidenceReference: text("evidence_reference").notNull(),
  employerDocumentType: text("employer_document_type", { enum: ["payroll", "other_income", "student_referral"] }),
  employerDocumentReference: text("employer_document_reference"),
  settledAt: timestamp("settled_at", { withTimezone: true }).notNull(),
  settledBy: text("settled_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tipSettlementRecoveriesTable = pgTable("tip_settlement_recoveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  allocationId: uuid("allocation_id").notNull().references(() => tipAllocationsTable.id, { onDelete: "restrict" }),
  settlementId: uuid("settlement_id").notNull().unique().references(() => tipSettlementsTable.id, { onDelete: "restrict" }),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  evidenceReference: text("evidence_reference").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tipPoliciesRelations = relations(tipPoliciesTable, ({ many }) => ({
  allocations: many(tipAllocationsTable),
}));
export const tipDistributionProfilesRelations = relations(tipDistributionProfilesTable, ({ many }) => ({
  entries: many(tipDistributionProfileEntriesTable),
}));
export const tipDistributionProfileEntriesRelations = relations(tipDistributionProfileEntriesTable, ({ one }) => ({
  profile: one(tipDistributionProfilesTable, { fields: [tipDistributionProfileEntriesTable.profileId], references: [tipDistributionProfilesTable.id] }),
}));
export const tipAllocationsRelations = relations(tipAllocationsTable, ({ one, many }) => ({
  policy: one(tipPoliciesTable, { fields: [tipAllocationsTable.tipPolicyId], references: [tipPoliciesTable.id] }),
  receipt: one(racuniTable, { fields: [tipAllocationsTable.racunId], references: [racuniTable.id] }),
  settlements: many(tipSettlementsTable),
}));

export const insertTipPolicySchema = createInsertSchema(tipPoliciesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTipAllocationSchema = createInsertSchema(tipAllocationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTipSettlementSchema = createInsertSchema(tipSettlementsTable).omit({ id: true, createdAt: true });
export const insertTipPoolSchema = createInsertSchema(tipPoolsTable).omit({ id: true, createdAt: true });
export const insertTipPoolEntrySchema = createInsertSchema(tipPoolEntriesTable).omit({ id: true, createdAt: true });
export const insertTipDistributionProfileSchema = createInsertSchema(tipDistributionProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTipDistributionProfileEntrySchema = createInsertSchema(tipDistributionProfileEntriesTable).omit({ id: true, createdAt: true });
export type TipPolicy = typeof tipPoliciesTable.$inferSelect;
export type TipAllocation = typeof tipAllocationsTable.$inferSelect;
export type TipSettlement = typeof tipSettlementsTable.$inferSelect;
export type TipPool = typeof tipPoolsTable.$inferSelect;
export type TipPoolEntry = typeof tipPoolEntriesTable.$inferSelect;
export type TipDistributionProfile = typeof tipDistributionProfilesTable.$inferSelect;
export type TipDistributionProfileEntry = typeof tipDistributionProfileEntriesTable.$inferSelect;
export type InsertTipPolicy = z.infer<typeof insertTipPolicySchema>;
export type InsertTipAllocation = z.infer<typeof insertTipAllocationSchema>;
export type InsertTipSettlement = z.infer<typeof insertTipSettlementSchema>;
export type InsertTipDistributionProfile = z.infer<typeof insertTipDistributionProfileSchema>;
export type InsertTipDistributionProfileEntry = z.infer<typeof insertTipDistributionProfileEntrySchema>;