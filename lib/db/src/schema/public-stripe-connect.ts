import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export const publicCompanyStripeConnectTable = pgTable("public_company_stripe_connect", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  accountId: text("account_id").unique(),
  livemode: boolean("livemode"),
  detailsSubmitted: boolean("details_submitted").notNull().default(false),
  chargesEnabled: boolean("charges_enabled").notNull().default(false),
  payoutsEnabled: boolean("payouts_enabled").notNull().default(false),
  oauthStateHash: text("oauth_state_hash"),
  oauthStateExpiresAt: timestamp("oauth_state_expires_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PublicCompanyStripeConnect =
  typeof publicCompanyStripeConnectTable.$inferSelect;