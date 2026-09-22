import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import type { UnitCapability } from "./pos/enote";

export const POS_PLANS = ["lite", "standard", "extended"] as const;
export type PosPlan = (typeof POS_PLANS)[number];

const LITE_CAPABILITIES = [
  "checkout",
  "shifts",
  "receipts",
  "menu",
  "inventory",
  "statistics",
  "operational_reports",
  "realization",
  "journals",
  "cash_movements",
  "hours",
  "settings",
] as const satisfies readonly UnitCapability[];

const STANDARD_CAPABILITIES = [
  ...LITE_CAPABILITIES,
  "tables",
  "kitchen",
  "bar",
  "prepared_food",
  "plate_waste",
  "phone_orders",
] as const satisfies readonly UnitCapability[];

export const POS_PLAN_CAPABILITIES: Record<PosPlan, readonly UnitCapability[]> = {
  lite: LITE_CAPABILITIES,
  standard: STANDARD_CAPABILITIES,
  extended: [
    ...STANDARD_CAPABILITIES,
    "simulation",
    "reservations",
    "delivery",
    "qr_menu",
    "multi_course",
    "events",
    "stock_transfers",
    "deposits_tokens",
  ],
};

export const DEFAULT_POS_PLAN: PosPlan = "lite";

export function getPosPlanCapabilities(
  plan: PosPlan | null | undefined,
): readonly UnitCapability[] {
  return POS_PLAN_CAPABILITIES[plan ?? DEFAULT_POS_PLAN];
}

export const companyPosPlansTable = pgTable("company_pos_plans", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  plan: text("plan").$type<PosPlan>().notNull().default(DEFAULT_POS_PLAN),
  enabledAt: timestamp("enabled_at", { withTimezone: true }).notNull().defaultNow(),
  enabledBy: text("enabled_by").notNull(),
});

export type CompanyPosPlan = typeof companyPosPlansTable.$inferSelect;