import { index, integer, numeric, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { prejemniceTable } from "./prejemnice";
import { posSupplierOrderLinesTable } from "./narocila-dobaviteljem";

export const posSupplierPackageChangeReviewsTable = pgTable(
  "pos_supplier_package_change_reviews",
  {
    id: serial("id").primaryKey(),
    enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "restrict" }),
    prejemnicaId: integer("prejemnica_id").notNull().references(() => prejemniceTable.id, { onDelete: "restrict" }),
    supplierOrderLineId: integer("supplier_order_line_id").notNull()
      .references(() => posSupplierOrderLinesTable.id, { onDelete: "restrict" }),
    articleName: text("article_name").notNull(),
    orderPackageName: text("order_package_name"),
    orderFactor: numeric("order_factor", { precision: 18, scale: 6 }),
    orderBaseUnit: text("order_base_unit"),
    currentPackageName: text("current_package_name"),
    currentFactor: numeric("current_factor", { precision: 18, scale: 6 }),
    currentBaseUnit: text("current_base_unit"),
    actorClerkUserId: text("actor_clerk_user_id").notNull(),
    actorNatakarId: integer("actor_natakar_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("pos_supplier_package_change_reviews_receipt_line_uq").on(t.prejemnicaId, t.supplierOrderLineId),
    index("pos_supplier_package_change_reviews_unit_receipt_time_idx")
      .on(t.enotaId, t.prejemnicaId, t.reviewedAt),
  ],
);

export type PosSupplierPackageChangeReview = typeof posSupplierPackageChangeReviewsTable.$inferSelect;
