import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { accountsTable, accountTypeEnum } from "./accounts";

/** Historical snapshots only; never used to authorize a later save. */
export const accountTypeConfirmationsTable = pgTable("account_type_confirmations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id),
  accountId: uuid("account_id").notNull().references(() => accountsTable.id),
  actorId: text("actor_id").notNull(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }).notNull().defaultNow(),
  code: text("code").notNull(),
  selectedType: accountTypeEnum("selected_type").notNull(),
  expectedType: accountTypeEnum("expected_type").notNull(),
  source: text("source", { enum: ["create", "update", "import"] }).notNull(),
}, t => [index("account_type_confirmations_lookup").on(t.companyId, t.accountId, t.confirmedAt)]);

export const insertAccountTypeConfirmationSchema = createInsertSchema(accountTypeConfirmationsTable).omit({
  id: true, confirmedAt: true,
});
export type InsertAccountTypeConfirmation = z.infer<typeof insertAccountTypeConfirmationSchema>;
export type AccountTypeConfirmation = typeof accountTypeConfirmationsTable.$inferSelect;
